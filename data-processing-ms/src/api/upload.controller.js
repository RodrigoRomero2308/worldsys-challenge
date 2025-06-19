const busboy = require('busboy');
const { Worker } = require('worker_threads');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

const uploadFile = (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  logger.info(`[Controller][${requestId}] Iniciando subida y procesamiento del archivo con ID: ${requestId}`);
  if (
    !req.headers['content-type'] ||
    !req.headers['content-type'].includes('multipart/form-data')
  ) {
    logger.warn(`[Controller][${requestId}] Content-Type incorrecto: ${req.headers['content-type']}`);
    return res
      .status(400)
      .json({ message: 'Content-Type must be multipart/form-data' });
  }

  const bb = busboy({ headers: req.headers });
  let worker;

  bb.on('file', (name, fileStream, info) => {
    const { filename } = info;
    logger.info(`[Controller][${requestId}] Iniciando subida y procesamiento del archivo: ${filename}`);
    const workerPath = path.resolve(
      __dirname,
      '../services/fileProcessor.worker.js'
    );
    worker = new Worker(workerPath, { workerData: { requestId, filename } });

    worker.on('message', (message) => {
      logger.info(`[Controller][${requestId}] Mensaje del worker:`, { message });
      if (message.status === 'completed') {
        logger.info(`[Controller][${requestId}] Worker ha completado el procesamiento. Líneas: ${message.summary?.processedLines}`);
      }
    });

    worker.on('error', (error) => {
      logger.error(`[Controller][${requestId}] Error en el worker:`, error);
      // Considerar cómo manejar errores del worker aquí.
      // Podríamos necesitar enviar una respuesta de error al cliente si aún no se ha respondido.
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.error(`[Controller][${requestId}] Worker se detuvo con código de salida ${code}`);
      } else {
        logger.info(`[Controller][${requestId}] Worker finalizó exitosamente.`);
      }
    });

    worker.on('message', (msg) => {
      if (msg.status === 'ready') {
        logger.info(`[Controller][${requestId}] Worker listo. Enviando datos del stream...`);
        fileStream.on('data', (chunk) => {
          worker.postMessage({
            type: 'PROCESS_CHUNK',
            data: chunk.toString('utf-8'),
          });
        });

        fileStream.on('end', () => {
          logger.info(`[Controller][${requestId}] Fin del stream del archivo ${filename}. Notificando al worker.`);
          worker.postMessage({ type: 'STREAM_END' });
        });
      }
    });

    fileStream.on('error', (err) => {
      logger.error(`[Controller][${requestId}] Error en el stream del archivo ${filename}:`, err);
      if (worker) worker.terminate();
    });
  });

  bb.on('close', () => {
    logger.info(`[Controller][${requestId}] Busboy ha terminado de parsear el formulario.`);
    // Respondemos 202 Accepted para indicar que la petición fue recibida
    // y el procesamiento (que será asíncrono) ha comenzado.
    res
      .status(202)
      .json({
        message: `El archivo ha sido recibido y su procesamiento ha comenzado.`,
      });
  });

  bb.on('error', (err) => {
    logger.error(`[Controller][${requestId}] Error de Busboy:`, err);
    if (worker) worker.terminate();
    
    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: 'Ocurrió un error durante la subida del archivo.' });
    }
  });

  req.pipe(bb);
};

module.exports = {
  uploadFile,
};
