const { parentPort, workerData } = require('worker_threads');
const readline = require('readline');
const { Readable } = require('stream');
const sql = require('mssql');
const dbConfig = require('../config/db.config');
const logger = require('../utils/logger');

const { requestId, filename } = workerData;

logger.info(`[Worker][${requestId}] Iniciado y listo para procesar stream.`);

const EXPECTED_COLUMNS = 10;
const BATCH_SIZE = process.env.DB_BATCH_SIZE || 1000;
const DB_MAX_QUEUE_SIZE = process.env.DB_MAX_QUEUE_SIZE || 5;

let totalLinesStreamed = 0; // Renombrado desde lineNumber para claridad
let validLinesCount = 0;    // Renombrado desde processedLinesCount
let errorLinesCount = 0;    // Mantenido
let batch = [];

// Contadores para la BD
let rowsSentToDb = 0;
let rowsSuccessfullyInserted = 0;
let batchesSentToDb = 0; // Ya existía como batchesSentCount, ahora es parte del objeto 'database'
let batchesFailedInDb = 0;
let lastDbError = null;

let isDbWriting = false;
let streamFinished = false;
let batchQueue = [];

let pool;

async function insertBatch(records) {
  if (!pool) {
    try {
      pool = await sql.connect(dbConfig);
      logger.info(`[Worker][${requestId}] Conexión a la base de datos establecida.`);
    } catch (err) {
      logger.error(`[Worker][${requestId}] Error al conectar a la base de datos:`, err);
      parentPort.postMessage({ type: 'DB_CONNECTION_ERROR', data: { error: err.message } });
      throw err;
    }
  }

  const table = new sql.Table('Clients');
  table.create = false;
  table.columns.add('ID_Cliente', sql.Int, { nullable: false, primary: true });
  table.columns.add('Nombre', sql.NVarChar(100), { nullable: false });
  table.columns.add('Apellido', sql.NVarChar(100), { nullable: false });
  table.columns.add('Email', sql.NVarChar(255), { nullable: false });
  table.columns.add('FechaNacimiento', sql.Date, { nullable: true });
  table.columns.add('DireccionCompleta', sql.NVarChar(500), { nullable: true });
  table.columns.add('Ciudad', sql.NVarChar(100), { nullable: true });
  table.columns.add('Pais', sql.NVarChar(100), { nullable: true });
  table.columns.add('Telefono', sql.NVarChar(50), { nullable: true });
  table.columns.add('FechaRegistro', sql.DateTime2, { nullable: true });

  records.forEach(rec => table.rows.add(...Object.values(rec)));

  try {
    const request = pool.request();
    const result = await request.bulk(table);
    
    batchesSentToDb++;
    rowsSuccessfullyInserted += result.rowsAffected;
    rowsSentToDb += records.length; // Asumimos que todos los 'records' se intentaron enviar

    logger.info(`[Worker][${requestId}] Lote de ${records.length} registros insertado. Filas afectadas: ${result.rowsAffected}. Total lotes BD: ${batchesSentToDb}`);
    
    parentPort.postMessage({ 
      type: 'DB_INSERT_SUCCESS', 
      data: { 
        insertedInBatch: result.rowsAffected, 
        batchSize: records.length,
        totalRowsSuccessfullyInserted: rowsSuccessfullyInserted,
        totalBatchesSentToDb: batchesSentToDb
      } 
    });
    
    parentPort.postMessage({
      type: 'PROGRESS_UPDATE',
      data: {
        processing: {
          totalLinesStreamed,
          validLinesCount,
          errorLinesCount,
        },
        database: {
          rowsSentToDb,
          rowsSuccessfullyInserted,
          batchesSentToDb,
          batchesFailedInDb,
          lastDbError,
          batchesInQueue: batchQueue.length,
        }
      }
    });

    return result.rowsAffected;
  } catch (err) {
    logger.error(`[Worker][${requestId}] Error durante la inserción masiva del lote de ${records.length} registros:`, { message: err.message, code: err.code });
    batchesFailedInDb++;
    lastDbError = err.message;
    rowsSentToDb += records.length; // Se intentaron enviar estas filas

    parentPort.postMessage({ 
      type: 'DB_INSERT_ERROR', 
      data: { 
        error: err.message, 
        code: err.code, 
        failedBatchSize: records.length,
        totalBatchesFailedInDb: batchesFailedInDb,
        lastDbError 
      } 
    });

    // Re-enviar progreso con el error actualizado
    parentPort.postMessage({
      type: 'PROGRESS_UPDATE',
      data: {
        processing: {
          totalLinesStreamed,
          validLinesCount,
          errorLinesCount,
        },
        database: {
          rowsSentToDb,
          rowsSuccessfullyInserted,
          batchesSentToDb,
          batchesFailedInDb,
          lastDbError,
          batchesInQueue: batchQueue.length,
        }
      }
    });
    // Sin reintentos
    return 0;
  }
}

async function processBatchQueue() {
  if (isDbWriting || batchQueue.length === 0) return;
  isDbWriting = true;

  const wasQueueFull = batchQueue.length >= DB_MAX_QUEUE_SIZE;

  const currentBatch = batchQueue.shift();
  logger.debug(`[Worker][${requestId}] Procesando lote de ${currentBatch.length} registros. Cola restante: ${batchQueue.length}`);
  await insertBatch(currentBatch);

  // Si la cola estaba llena y ahora tiene espacio, avisamos para reanudar el stream
  if (wasQueueFull && batchQueue.length < DB_MAX_QUEUE_SIZE) {
    logger.info(`[Worker][${requestId}] Cola de lotes con espacio (${batchQueue.length}). Reanudando stream.`);
    parentPort.postMessage({ type: 'RESUME_STREAM' });
  }

  isDbWriting = false;
  // Comprobar si hay más lotes o si el stream ha terminado
  if (batchQueue.length > 0) {
    process.nextTick(processBatchQueue);
  } else if (streamFinished) {
    finishProcessing();
  }
}

function finishProcessing() {
  logger.info(`[Worker][${requestId}] Fin del procesamiento.`);
  if (pool) pool.close();
  parentPort.postMessage({
      status: 'completed',
      summary: {
        processing: {
          totalLinesStreamed,
          validLinesCount,
          errorLinesCount,
        },
        database: {
          rowsSentToDb,
          rowsSuccessfullyInserted,
          batchesSentToDb,
          batchesFailedInDb,
          lastDbError,
        }
      }
    });
  parentPort.close();
}

function parseCsvLikeLine(line) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && (i === 0 || line[i - 1] === ',')) {
      inQuotes = true;
    } else if (char === '"' && (i === line.length - 1 || line[i + 1] === ',')) {
      inQuotes = false;
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField);
  logger.debug(`[Worker][${requestId}] Línea parseada: ${fields.join(', ')}`);
  return fields;
}

function validateAndMapRecord(recordArray) {
  if (recordArray.length !== EXPECTED_COLUMNS) {
    logger.debug(`[Worker][${requestId}] Línea inválida: ${recordArray.join(', ')}`);
    throw new Error(`Número de columnas incorrecto. Se esperaban ${EXPECTED_COLUMNS} pero se recibieron ${recordArray.length}.`);
  }

  const [idCliente, nombre, apellido, email, fechaNacimiento, direccion, ciudad, pais, telefono, fechaRegistro] = recordArray;

  const id = parseInt(idCliente, 10);
  if (isNaN(id)) throw new Error(`ID no numérico: ${idCliente}`);
  if (!nombre || !apellido) throw new Error('Nombre o Apellido vacíos.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Email inválido: ${email}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento) || isNaN(new Date(fechaNacimiento))) throw new Error(`Fecha de Nacimiento inválida: ${fechaNacimiento}`);

  return { ID_Cliente: id, Nombre: nombre, Apellido: apellido, Email: email, FechaNacimiento: fechaNacimiento, DireccionCompleta: direccion, Ciudad: ciudad, Pais: pais, Telefono: telefono, FechaRegistro: fechaRegistro };
}

const inputStream = new Readable({
  read() {}
});

const rl = readline.createInterface({
  input: inputStream,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  totalLinesStreamed++;
  if (line.trim() === '') {
    logger.debug(`[Worker][${requestId}] Línea ${lineNumber} vacía, omitiendo.`);
    return;
  }
  try {
    const recordArray = parseCsvLikeLine(line);
    const clientRecord = validateAndMapRecord(recordArray);
    batch.push(clientRecord);
    validLinesCount++;

    if (batch.length >= BATCH_SIZE) {
      logger.debug(`[Worker][${requestId}] Lote de ${batch.length} registros listo, añadiendo a la cola.`);
      batchQueue.push(batch);
      batch = [];
      process.nextTick(processBatchQueue);

      // Si la cola de lotes está llena, pausar el stream de entrada
      if (batchQueue.length >= DB_MAX_QUEUE_SIZE) {
        logger.warn(`[Worker][${requestId}] Cola de lotes llena (${batchQueue.length}). Pausando stream de entrada.`);
        parentPort.postMessage({ type: 'PAUSE_STREAM' });
      }
    }
  } catch (error) {
    errorLinesCount++;
    logger.error(`[Worker][${requestId}] Error al procesar línea ${totalLinesStreamed}:`, { error: error.message });
    parentPort.postMessage({
      type: 'LINE_ERROR',
      data: { lineNumber: totalLinesStreamed, lineContent: line.substring(0, 100), error: error.message },
    });
  }
});

rl.on('close', () => {
  streamFinished = true;
  logger.info(`[Worker][${requestId}] Fin del stream de entrada (readline closed). Líneas leídas: ${totalLinesStreamed}`);
  if (batch.length > 0) {
    logger.debug(`[Worker][${requestId}] Añadiendo lote final de ${batch.length} registros a la cola.`);
    batchQueue.push(batch);
    batch = [];
  }
  if (!isDbWriting) {
    process.nextTick(processBatchQueue);
  }
  if (batchQueue.length === 0 && !isDbWriting) {
    finishProcessing();
  }
});

parentPort.on('message', (message) => {
  if (message.type === 'PROCESS_CHUNK') {
    inputStream.push(message.data);
  } else if (message.type === 'STREAM_END') {
    inputStream.push(null);
    logger.info(`[Worker][${requestId}] Señal de STREAM_END recibida, inputStream finalizado.`);
  }
});

parentPort.postMessage({ status: 'ready' });
