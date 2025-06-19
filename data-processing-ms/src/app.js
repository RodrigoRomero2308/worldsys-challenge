const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage(); 

  const formatMemory = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  const metrics = {
    timestamp: new Date().toISOString(),
    memory: {
      rss: formatMemory(memoryUsage.rss),
      heapTotal: formatMemory(memoryUsage.heapTotal),
      heapUsed: formatMemory(memoryUsage.heapUsed),
      external: formatMemory(memoryUsage.external),
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    }
  };

  res.status(200).json(metrics);
});

const apiRoutes = require('./api/routes');
app.use('/api/v1', apiRoutes);

module.exports = app;