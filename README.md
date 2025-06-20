# Worldsys Challenge: Microservicio de Procesamiento de Datos de Clientes

## 1. Descripción General

Este proyecto contiene un microservicio de Node.js diseñado para procesar archivos de datos (`.dat`) de gran tamaño que contienen registros de clientes. El servicio está construido para ser robusto, escalable y observable, utilizando un enfoque de procesamiento en streaming para manejar eficientemente archivos que exceden la memoria RAM disponible.

El microservicio expone una API REST para la carga de archivos, la consulta del estado del procesamiento, y la monitorización de su salud y métricas de rendimiento. Está completamente dockerizado y listo para ser desplegado en un entorno de Kubernetes.

### Estructura del Repositorio

- **/data-processing-ms**: Contiene el código fuente del microservicio Node.js.
- **/data-generator**: Un script para generar archivos `.dat` de prueba.
- **/metrics-monitor**: Un script de utilidad para monitorear el rendimiento y el progreso de una carga de archivos.

### Características Principales

- **Procesamiento de Archivos Grandes**: Capaz de manejar archivos de varios gigabytes gracias al procesamiento en streaming (con `busboy`) y la lectura línea por línea.
- **Procesamiento Asíncrono**: Utiliza `worker_threads` de Node.js para procesar los archivos en segundo plano, manteniendo la API principal receptiva en todo momento.
- **Base de Datos SQL Server**: Inserta los datos validados en una base de datos SQL Server utilizando inserciones masivas (`bulk insert`) para un rendimiento óptimo.
- **Tolerancia a Fallos**: Identifica y cuenta las líneas corruptas o con formato incorrecto en el archivo de datos sin detener el proceso.
- **Monitorización y Observabilidad**:
  - Endpoint `/health` para chequeos de salud (liveness/readiness probes).
  - Endpoint `/metrics` que expone métricas de uso de CPU y memoria.
  - Endpoint de estado `/api/v1/clients/status/:requestId` para seguir el progreso de una carga en tiempo real.
- **Contenerización y Orquestación**: Incluye un `Dockerfile` multi-etapa optimizado para producción y manifiestos de Kubernetes (`Deployment`, `Service`, `ConfigMap`, `Secret`) para un despliegue sencillo.

---

## 2. Decisiones de Arquitectura

- **Node.js y Express**: Se eligió Node.js por su modelo de I/O no bloqueante, ideal para aplicaciones de red y streaming. Express proporciona un framework minimalista y robusto para la API.
- **Worker Threads**: Para evitar bloquear el hilo principal durante el procesamiento intensivo del archivo, se delega toda la lógica de parsing e inserción a un hilo de trabajo separado. Esto asegura que el endpoint `/health` y otras llamadas a la API siempre respondan.
- **Streaming con `busboy`**: En lugar de cargar el archivo completo en memoria, se procesa como un stream. `busboy` es una librería eficiente para parsear `multipart/form-data` directamente desde el stream de la petición.
- **Inserciones Masivas (Bulk Inserts)**: Para maximizar el rendimiento de la base de datos, los registros validados se agrupan en lotes y se envían a SQL Server mediante una única operación de `bulk insert`, reduciendo drásticamente la sobrecarga de la red y las transacciones.
- **Docker y Kubernetes (K8s)**: La contenerización asegura un entorno de ejecución consistente. Kubernetes fue elegido para la orquestación por su robustez, escalabilidad y estándar en la industria. Se utiliza `kind` para el desarrollo local en un entorno similar a producción.
- **Logging Centralizado con `Winston`**: Se utiliza Winston para un logging estructurado y configurable, con un `requestId` para correlacionar todos los logs pertenecientes a una misma petición.

---

## 3. Configuración del Entorno

### Prerrequisitos

- Node.js (v18+)
- pnpm (o npm/yarn)
- Docker y Docker Compose
- `kubectl` y `kind` para despliegue en Kubernetes local.

### Variables de Entorno

El servicio se configura mediante variables de entorno. Crea un archivo `.env` en el directorio `data-processing-ms` a partir del archivo `data-processing-ms/.env.example`.

```bash
# data-processing-ms/.env

# Server Configuration
PORT=3000
LOG_LEVEL=info

# Database Configuration
DB_USER=sa
DB_PASSWORD=YourStrong@Password
DB_SERVER=localhost
DB_PORT=1433
DB_DATABASE=WorldsysChallenge
DB_ENCRYPT=false # Poner a true si se conecta a Azure SQL o una instancia con SSL

# Worker & Processing Configuration
DB_BATCH_SIZE=1000 # Número de filas por lote de inserción
DB_MAX_QUEUE_SIZE=5 # Número de lotes que el worker puede encolar antes de pausar el stream
```

### Base de Datos

El servicio está configurado para conectarse a SQL Server. Para desarrollo en un entorno ARM64 (como un Mac M1/M2/M3 o el servidor Oracle Linux), se recomienda usar la imagen de Azure SQL Edge:

```bash
docker run --cap-add SYS_PTRACE -e 'ACCEPT_EULA=1' -e 'MSSQL_SA_PASSWORD=YourStrong@Password' \
-p 1433:1433 --name azuresqledge -d \
mcr.microsoft.com/azure-sql-edge
```

---

## 4. Cómo Ejecutar el Servicio

### A. Localmente (para desarrollo rápido)

1.  **Navegar al directorio**: `cd data-processing-ms`
2.  **Instalar dependencias**: `pnpm install`
3.  **Configurar `.env`**: Asegúrate de que tu archivo `.env` esté configurado correctamente.
4.  **Iniciar el servicio**: `pnpm run dev` (usa `nodemon` para recarga en caliente).

### B. Con Docker Compose

El `docker-compose.yml` en la raíz del proyecto levanta el servicio y la base de datos de SQL Server.

1.  **Construir y levantar los contenedores**: `docker-compose up --build`

### C. En Kubernetes (con `kind`)

1.  **Crear el clúster `kind`**: Si es la primera vez, crea el clúster con el mapeo de puertos necesario.
    ```bash
    kind create cluster --name data-processing-cluster --config ./data-processing-ms/dev/kind-config.yaml
    ```

2.  **Construir la imagen Docker**:
    ```bash
    docker build -t data-processing-ms:latest ./data-processing-ms
    ```

3.  **Cargar la imagen en el clúster `kind`**:
    ```bash
    kind load docker-image data-processing-ms:latest --name data-processing-cluster
    ```

4.  **Aplicar los manifiestos de Kubernetes**:
    - **Importante**: Los secretos de base de datos deben ser creados primero. Edita `data-processing-ms/k8s/secret.yaml` con tus credenciales codificadas en Base64.
      ```bash
      # Ejemplo para obtener el valor en base64
      echo -n 'YourStrong@Password' | base64
      ```
    - Aplica todos los manifiestos:
      ```bash
      kubectl apply -f ./data-processing-ms/k8s/
      ```

---

## 5. Uso de la API y Herramientas

### Endpoints

- `POST /api/v1/clients/upload`
  - Sube el archivo `.dat`. Debe ser una petición `multipart/form-data` con el campo `file`.
  - **Ejemplo con `curl`** (asumiendo que el archivo está en `data-generator/`):
    ```bash
    curl -X POST -F "file=@./data-generator/clientes.dat" http://localhost:30080/api/v1/clients/upload
    ```

- `GET /api/v1/clients/status/:requestId`
  - Consulta el estado de un proceso de carga. Devuelve el estado (`pending`, `processing`, `completed`, `failed`) y estadísticas detalladas.

- `GET /health`
  - Devuelve un estado `OK`. Usado para liveness y readiness probes en Kubernetes.

- `GET /metrics`
  - Devuelve métricas de rendimiento en formato JSON (uso de CPU y memoria).

### Generador de Datos

El proyecto `data-generator` contiene un script para generar archivos de prueba.

1.  Navega a `cd data-generator`.
2.  Ejecuta `node generate-data.js --help` para ver las opciones (número de líneas, tasa de error, etc.).

### Script de Monitoreo

El proyecto `metrics-monitor` contiene un script para monitorear una carga específica y generar un reporte HTML.

1.  Navega a `cd metrics-monitor`.
2.  Instala dependencias: `pnpm install`.
3.  Configura el archivo `.env` con la URL base de la API (`http://localhost:30080` para Kubernetes).
4.  Ejecuta el script: `pnpm start`.
5.  Ingresa el `requestId` devuelto por el endpoint de subida.

---

## 6. Estrategia de Escalabilidad

Se ha propuesto una estrategia de escalabilidad con dos enfoques:

1.  **Escalado Horizontal (Múltiples Archivos)**: Utilizar un Horizontal Pod Autoscaler (HPA) en Kubernetes para escalar el número de Pods basado en el uso de CPU. Esto permite procesar múltiples archivos de forma concurrente, donde cada Pod se encarga de un archivo.

2.  **Escalado por Sharding (Archivos Gigantes)**: Para archivos individuales que superan los 20-30 GB, se propone un modelo de *sharding*. Un servicio "coordinador" dividiría el archivo en trozos lógicos (rangos de bytes) y los encolaría en una cola de mensajes (como RabbitMQ o Kafka). Múltiples Pods "trabajadores" consumirían mensajes de la cola, procesando cada uno un trozo del archivo en paralelo. Esto permite paralelizar el procesamiento de un único archivo masivo.