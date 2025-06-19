const express = require('express');
const uploadController = require('./upload.controller');

const router = express.Router();

// Definimos la ruta para la subida de archivos de clientes
router.post('/clients/upload', uploadController.uploadFile);

// Aquí podríamos agregar más rutas en el futuro
// router.get('/clients/status/:jobId', ...);

module.exports = router;