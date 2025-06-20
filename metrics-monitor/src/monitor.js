const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS, 10) || 2000;

const STATUS_ENDPOINT = "/api/v1/clients/status/";
const METRICS_ENDPOINT = "/metrics";

const collectedData = [];
let lastCpuUsage = { user: 0, system: 0 };
let pollingIntervalId = null;
let isStopping = false;
let storedRequestId = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function pollData(requestId) {
  if (isStopping) return;

  storedRequestId = requestId;

  try {
    const statusUrl = `${API_BASE_URL}${STATUS_ENDPOINT}${requestId}`;
    const metricsUrl = `${API_BASE_URL}${METRICS_ENDPOINT}`;

    const [statusResponse, metricsResponse] = await Promise.all([
      axios.get(statusUrl),
      axios.get(metricsUrl),
    ]);

    const statusData = statusResponse.data;
    const { memory, cpu, timestamp } = metricsResponse.data;

    const heapUsed = parseFloat(memory.heapUsed);
    const rss = parseFloat(memory.rss);
    const cpuDeltaUser = cpu.user - lastCpuUsage.user;
    const cpuDeltaSystem = cpu.system - lastCpuUsage.system;
    lastCpuUsage = cpu;
    const cpuUsagePercent =
      ((cpuDeltaUser + cpuDeltaSystem) / (POLLING_INTERVAL_MS * 1000)) * 100;

    const dataPoint = {
      timestamp,
      heapUsed,
      rss,
      cpuPercent: Math.max(0, cpuUsagePercent),
      linesProcessed: statusData.progress?.processing?.totalLinesStreamed || 0,
      rowsSentToDb: statusData.progress?.database?.rowsSentToDb || 0,
      validLines: statusData.progress?.processing?.validLinesCount || 0,
      errorLines: statusData.progress?.processing?.errorLinesCount || 0,
    };
    collectedData.push(dataPoint);
    process.stdout.write(`.`);

    if (statusData.status === "completed" || statusData.status === "failed") {
      stopMonitoringAndGenerateReport(statusData);
    } else {
      pollingIntervalId = setTimeout(
        () => pollData(requestId),
        POLLING_INTERVAL_MS
      );
    }
  } catch (error) {
    if (isStopping) return;
    process.stdout.write("x");
    pollingIntervalId = setTimeout(
      () => pollData(requestId),
      POLLING_INTERVAL_MS
    );
  }
}

function stopMonitoringAndGenerateReport(finalStatus) {
  if (isStopping) return;
  isStopping = true;

  if (pollingIntervalId) {
    clearTimeout(pollingIntervalId);
  }

  console.log(`\n\nProceso finalizado con estado: ${finalStatus.status}`);

  if (collectedData.length === 0) {
    console.log("No se recolectaron datos. No se generará el reporte.");
    process.exit(0);
  }

  console.log(
    `Se recolectaron ${collectedData.length} puntos de datos. Generando reporte...`
  );
  generateReport(collectedData, finalStatus);
  process.exit(0);
}

function generateReport(data, finalStatus) {
  try {
    const reportPath = path.resolve(__dirname, "report.html");

    const labels = data.map((d) => new Date(d.timestamp).toLocaleTimeString());
    const heapData = data.map((d) => d.heapUsed.toFixed(2));
    const rssData = data.map((d) => d.rss.toFixed(2));
    const cpuData = data.map((d) => d.cpuPercent.toFixed(2));
    const linesProcessedData = data.map((d) => d.linesProcessed);
    const rowsSentToDbData = data.map((d) => d.rowsSentToDb);

    const startTime = new Date(finalStatus.startTime);
    const endTime = new Date(finalStatus.endTime);
    const totalTime = (endTime - startTime) / 1000;
    const averageSpeedLps = data[data.length - 1].linesProcessed / totalTime;

    const stats = finalStatus.progress;
    const statsHtml = `
    <div class="stats-container">
        <h2>Estadísticas Finales de la Importación</h2>
        <table>
            <tr><th>Métrica</th><th>Valor</th></tr>
            <tr><td>Estado Final</td><td>${finalStatus.status}</td></tr>
            <tr><td>Tiempo Total</td><td>${totalTime.toFixed(2)} segundos</td></tr>
            <tr><td>Velocidad Promedio (líneas/s)</td><td>${averageSpeedLps.toFixed(2)}</td></tr>
            <tr><td colspan="2" class="subheader">Procesamiento de Líneas</td></tr>
            <tr><td>Líneas Leídas del Stream</td><td>${(stats?.processing?.totalLinesStreamed || 0).toLocaleString()}</td></tr>
            <tr><td>Líneas Válidas</td><td>${(stats?.processing?.validLinesCount || 0).toLocaleString()}</td></tr>
            <tr><td>Líneas con Error</td><td>${(stats?.processing?.errorLinesCount || 0).toLocaleString()}</td></tr>
            <tr><td colspan="2" class="subheader">Base de Datos</td></tr>
            <tr><td>Filas Enviadas a DB</td><td>${(stats?.database?.rowsSentToDb || 0).toLocaleString()}</td></tr>
            <tr><td>Filas Insertadas</td><td>${(stats?.database?.rowsSuccessfullyInserted || 0).toLocaleString()}</td></tr>
            <tr><td>Lotes Enviados</td><td>${(stats?.database?.batchesSentToDb || 0).toLocaleString()}</td></tr>
            <tr><td>Lotes Fallidos</td><td>${(stats?.database?.batchesFailedInDb || 0).toLocaleString()}</td></tr>
            <tr><td>Último Error DB</td><td class="error-message">${stats?.database?.lastDbError || "Ninguno"}</td></tr>
        </table>
    </div>
  `;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte de Monitoreo de Proceso - ${storedRequestId}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background-color: #f4f7f9; color: #333; }
        h1, h2 { color: #2c3e50; }
        .container { display: flex; flex-wrap: wrap; gap: 20px; }
        .chart-container { background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; flex-grow: 1; min-width: 45%; }
        .stats-container { background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; width: 100%; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
        th { background-color: #eaf2f8; }
        tr:hover { background-color: #f1f1f1; }
        .subheader { font-weight: bold; background-color: #f9f9f9; color: #555; }
    </style>
</head>
<body>
    <h1>Reporte de Monitoreo para Request ID: ${storedRequestId}</h1>
    
    ${statsHtml}

    <div class="container">
        <div class="chart-container">
            <h2>Progreso de Importación (Líneas Procesadas)</h2>
            <canvas id="progressChart"></canvas>
        </div>
        <div class="chart-container">
            <h2>Uso de Memoria (MB)</h2>
            <canvas id="memoryChart"></canvas>
        </div>
        <div class="chart-container">
            <h2>Uso de CPU (%)</h2>
            <canvas id="cpuChart"></canvas>
        </div>
    </div>

    <script>
        const labels = ${JSON.stringify(labels)};
        
        // Gráfico de Progreso
        const progressCtx = document.getElementById('progressChart').getContext('2d');
        new Chart(progressCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Líneas Procesadas',
                    data: ${JSON.stringify(linesProcessedData)},
                    borderColor: 'rgb(40, 167, 69)',
                    backgroundColor: 'rgba(40, 167, 69, 0.2)',
                    fill: true,
                    tension: 0.1
                }, {
                    label: 'Líneas Enviadas a BD',
                    data: ${JSON.stringify(rowsSentToDbData)},
                    borderColor: 'rgb(0, 123, 255)',
                    backgroundColor: 'rgba(0, 123, 255, 0.2)',
                    fill: true,
                    tension: 0.1
                }]
            }
        });

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

    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
    fs.writeFileSync(reportPath, htmlContent);
    console.log(`Reporte generado: ${reportPath}`);
    console.log("Abre el archivo en tu navegador para ver los gráficos.");
  } catch (error) {
    console.error('\n\nError al generar el reporte:', error);
    console.error('Datos finales recibidos:', JSON.stringify(finalStatus, null, 2));
  }
}

process.on("SIGINT", () => {
  console.log("\n\nMonitoreo interrumpido por el usuario.");
  if (collectedData.length > 0) {
    const lastStatus = {
      requestId: "INTERRUMPIDO",
      status: "interrupted",
      progress: {
        totalTime: "N/A",
        averageSpeedLps: 0,
        processing: {
          totalLinesStreamed:
            collectedData[collectedData.length - 1].linesProcessed,
          validLinesCount: collectedData[collectedData.length - 1].validLines,
          errorLinesCount: collectedData[collectedData.length - 1].errorLines,
        },
        database: {
          rowsSentToDb: "N/A",
          rowsInserted: "N/A",
          batchesSent: "N/A",
          batchesFailed: "N/A",
          lastDbError: "N/A",
        },
      },
    };
    stopMonitoringAndGenerateReport(lastStatus);
  }
  process.exit(0);
});

rl.question(
  "Por favor, ingresa el requestId para monitorear: ",
  (requestId) => {
    if (!requestId) {
      console.log("No se ingresó un requestId. Saliendo.");
      process.exit(1);
    }
    console.log(`Iniciando monitoreo para requestId: ${requestId}`);
    console.log(`Consultando estado y métricas cada ${POLLING_INTERVAL_MS}ms.`);
    console.log("Presiona Ctrl+C para detener manualmente.");

    pollData(requestId.trim());
    rl.close();
  }
);
