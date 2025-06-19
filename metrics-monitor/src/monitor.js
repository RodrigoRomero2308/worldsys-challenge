const axios = require('axios');
const fs = require('fs');
const path = require('path');

const METRICS_URL = 'http://localhost:3000/metrics';
const POLLING_INTERVAL_MS = 1000;

const collectedData = [];
let lastCpuUsage = { user: 0, system: 0 };

console.log('Iniciando monitor de métricas...');
console.log(`Consultando ${METRICS_URL} cada ${POLLING_INTERVAL_MS}ms.`);
console.log('Presiona Ctrl+C para detener y generar el reporte.');

const intervalId = setInterval(async () => {
  try {
    const response = await axios.get(METRICS_URL);
    const { memory, cpu, timestamp } = response.data;

    const heapUsed = parseFloat(memory.heapUsed);
    const rss = parseFloat(memory.rss);

    const cpuDeltaUser = cpu.user - lastCpuUsage.user;
    const cpuDeltaSystem = cpu.system - lastCpuUsage.system;
    lastCpuUsage = cpu;
    
    const cpuUsagePercent = ((cpuDeltaUser + cpuDeltaSystem) / (POLLING_INTERVAL_MS * 1000)) * 100;

    const dataPoint = {
      timestamp,
      heapUsed,
      rss,
      cpuPercent: Math.max(0, cpuUsagePercent),
    };

    collectedData.push(dataPoint);
    process.stdout.write(`.`);

  } catch (error) {
    process.stdout.write('x');
  }
}, POLLING_INTERVAL_MS);

process.on('SIGINT', () => {
  console.log('\n\nDeteniendo monitor...');
  clearInterval(intervalId);

  if (collectedData.length === 0) {
    console.log('No se recolectaron datos. No se generará el reporte.');
    process.exit(0);
  }

  console.log(`Se recolectaron ${collectedData.length} puntos de datos. Generando reporte...`);
  generateReport(collectedData);
  process.exit(0);
});

function generateReport(data) {
  const reportPath = path.resolve(__dirname, 'report.html');

  const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString());
  const heapData = data.map(d => d.heapUsed.toFixed(2));
  const rssData = data.map(d => d.rss.toFixed(2));
  const cpuData = data.map(d => d.cpuPercent.toFixed(2));

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte de Métricas del Proceso</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        .chart-container { width: 90%; max-width: 1200px; margin: 40px auto; }
    </style>
</head>
<body>
    <h1>Reporte de Métricas</h1>
    <div class="chart-container">
        <h2>Uso de Memoria (MB)</h2>
        <canvas id="memoryChart"></canvas>
    </div>
    <div class="chart-container">
        <h2>Uso de CPU (%)</h2>
        <canvas id="cpuChart"></canvas>
    </div>

    <script>
        const labels = ${JSON.stringify(labels)};
        
        // Gráfico de Memoria
        const memoryCtx = document.getElementById('memoryChart').getContext('2d');
        new Chart(memoryCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Heap Used (MB)',
                        data: ${JSON.stringify(heapData)},
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1
                    },
                    {
                        label: 'RSS (MB)',
                        data: ${JSON.stringify(rssData)},
                        borderColor: 'rgb(255, 99, 132)',
                        tension: 0.1
                    }
                ]
            }
        });

        // Gráfico de CPU
        const cpuCtx = document.getElementById('cpuChart').getContext('2d');
        new Chart(cpuCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'CPU Usage (%)',
                    data: ${JSON.stringify(cpuData)},
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    fill: true,
                    tension: 0.1
                }]
            }
        });
    </script>
</body>
</html>
  `;

  fs.writeFileSync(reportPath, htmlContent);
  console.log(`Reporte generado: ${reportPath}`);
  console.log('Abre el archivo en tu navegador para ver los gráficos.');
}
