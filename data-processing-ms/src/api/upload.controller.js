const busboy = require('busboy');
const { Worker } = require('worker_threads');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

const processingStatus = {};
const STATUS_TTL_MS = 60 * 1000;

function clearStatusEntry(requestId) {
  logger.info(
    `[Controller][${requestId}] Expiró el estado para la solicitud. Limpiando entrada.`
  );
  delete processingStatus[requestId];
}

const uploadFile = (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  logger.info(
    `[Controller][${requestId}] Iniciando subida y procesamiento del archivo con ID: ${requestId}`
  );

  processingStatus[requestId] = {
    status: 'pending_upload',
    filename: null,
    startTime: new Date().toISOString(),
    progress: null,
    error: null,
  };

  if (
    !req.headers['content-type'] ||
    !req.headers['content-type'].includes('multipart/form-data')
  ) {
    logger.warn(
      `[Controller][${requestId}] Content-Type incorrecto: ${req.headers['content-type']}`
    );
    return res
      .status(400)
      .json({ message: 'Content-Type must be multipart/form-data' });
  }

  const bb = busboy({ headers: req.headers });
  let worker;

  bb.on('file', (name, fileStream, info) => {
    const { filename } = info;
    logger.info(
      `[Controller][${requestId}] Iniciando subida y procesamiento del archivo: ${filename}`
    );
    processingStatus[requestId].filename = filename;
    processingStatus[requestId].status = 'streaming_to_worker';

    const workerPath = path.resolve(
      __dirname,
      '../services/fileProcessor.worker.js'
    );
    worker = new Worker(workerPath, { workerData: { requestId, filename } });

    worker.on('message', (message) => {
      const currentStatus = processingStatus[requestId];
      if (!currentStatus) return; // No deberia pasar

      logger.info(`[Controller][${requestId}] Mensaje del worker:`, {
        message,
      });

      if (message.status === 'completed') {
        logger.info(
          `[Controller][${requestId}] Worker ha completado el procesamiento. Resumen:`, message.summary
        );
        currentStatus.status = 'completed';
        currentStatus.progress = message.summary; // Guardamos el resumen final en el campo progress
        currentStatus.endTime = new Date().toISOString();
        setTimeout(() => clearStatusEntry(requestId), STATUS_TTL_MS);
      } else if (message.status === 'ready') {
        currentStatus.status = 'processing_started';
        logger.info(
          `[Controller][${requestId}] Worker listo. Enviando datos del stream...`
        );
        fileStream.on('data', (chunk) => {
          worker.postMessage({
            type: 'PROCESS_CHUNK',
            data: chunk.toString('utf-8'),
          });
        });

        fileStream.on('end', () => {
          logger.info(
            `[Controller][${requestId}] Fin del stream del archivo ${filename}. Notificando al worker.`
          );
          worker.postMessage({ type: 'STREAM_END' });
        });
      } else if (message.type === 'LINE_ERROR') {
        logger.warn(
          `[Controller][${requestId}] Error de línea reportado por el worker para ${filename}`,
          {
            line: message.data.lineNumber,
            error: message.data.error,
            content: message.data.lineContent,
          }
        );
        currentStatus.status = 'processing_with_errors';
      } else if (message.type === 'DB_INSERT_SUCCESS') {
        logger.info(
          `[Controller][${requestId}] Lote insertado en BD para ${filename}. Filas afectadas: ${message.data.inserted} (Tamaño lote: ${message.data.batchSize})`
        );
        currentStatus.status = 'processing';
      } else if (message.type === 'DB_INSERT_ERROR') {
        logger.error(
          `[Controller][${requestId}] Error de inserción en BD para ${filename}`,
          {
            error: message.data.error,
            code: message.data.code,
            batchSize: message.data.failed_batch_size,
          }
        );
        currentStatus.status = 'processing_with_db_errors';
        currentStatus.error = message.data.error;
      } else if (message.type === 'PROGRESS_UPDATE') {
        logger.info(
          `[Controller][${requestId}] Progreso del worker para ${filename}:`,
          message.data // message.data ahora contiene la estructura anidada { processing: {...}, database: {...} }
        );
        currentStatus.status = 'processing';
        currentStatus.progress = message.data; // La nueva estructura anidada se guarda directamente
      } else if (message.type === 'PAUSE_STREAM') {
        logger.warn(`[Controller][${requestId}] Pausando el stream de entrada (back-pressure).`);
        req.pause();
      } else if (message.type === 'RESUME_STREAM') {
        logger.info(`[Controller][${requestId}] Reanudando el stream de entrada.`);
        req.resume();
      }
    });

    worker.on('error', (error) => {
      logger.error(`[Controller][${requestId}] Error en el worker:`, error);
      if (processingStatus[requestId]) {
        processingStatus[requestId].status = 'failed_worker_error';
        processingStatus[requestId].error = error.message;
        processingStatus[requestId].endTime = new Date().toISOString();
        setTimeout(() => clearStatusEntry(requestId), STATUS_TTL_MS);
      }
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.error(
          `[Controller][${requestId}] Worker se detuvo con código de salida ${code}`
        );
        if (
          processingStatus[requestId] &&
          processingStatus[requestId].status !== 'completed' &&
          processingStatus[requestId].status !== 'failed_worker_error'
        ) {
          processingStatus[requestId].status = 'failed_worker_exit';
          processingStatus[requestId].error = `Worker exited with code ${code}`;
          processingStatus[requestId].endTime = new Date().toISOString();
          setTimeout(() => clearStatusEntry(requestId), STATUS_TTL_MS);
        }
      } else {
        logger.info(`[Controller][${requestId}] Worker finalizó exitosamente.`);
      }
    });

    fileStream.on('error', (err) => {
      logger.error(
        `[Controller][${requestId}] Error en el stream del archivo ${filename}:`,
        err
      );
      if (processingStatus[requestId]) {
        processingStatus[requestId].status = 'failed_stream_error';
        processingStatus[requestId].error = err.message;
        processingStatus[requestId].endTime = new Date().toISOString();
        setTimeout(() => clearStatusEntry(requestId), STATUS_TTL_MS);
      }
      if (worker) worker.terminate();
    });
  });

  bb.on('close', () => {
    logger.info(
      `[Controller][${requestId}] Busboy ha terminado de parsear el formulario.`
    );
    res.status(202).json({
      message: `El archivo ha sido recibido y su procesamiento ha comenzado.`,
      requestId: requestId,
      statusEndpoint: `/api/v1/clients/status/${requestId}`,
    });
  });

  bb.on('error', (err) => {
    logger.error(`[Controller][${requestId}] Error de Busboy:`, err);
    if (processingStatus[requestId]) {
      processingStatus[requestId].status = 'failed_busboy_error';
      processingStatus[requestId].error = err.message;
      processingStatus[requestId].endTime = new Date().toISOString();
      setTimeout(() => clearStatusEntry(requestId), STATUS_TTL_MS);
    }

    if (worker) worker.terminate();

    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: 'Ocurrió un error durante la subida del archivo.' });
    }
  });

  req.pipe(bb);
};

const getUploadStatus = (req, res) => {
  const { requestId } = req.params;
  const statusInfo = processingStatus[requestId];

  if (statusInfo) {
    res.status(200).json(statusInfo);
  } else {
    res
      .status(404)
      .json({
        message: `No se encontró estado para la solicitud ${requestId}. Puede que haya expirado o no exista.`,
      });
  }
};

module.exports = {
  uploadFile,
  getUploadStatus,
};
