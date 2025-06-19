const express = require('express');
const uploadController = require('./upload.controller');

const router = express.Router();

router.post('/clients/upload', uploadController.uploadFile);

router.get('/clients/status/:requestId', uploadController.getUploadStatus);

module.exports = router;