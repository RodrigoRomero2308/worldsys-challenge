# Generador de Datos de Clientes (.dat)

Este script de Node.js ([generate-data.js](./generate-data.js)) se utiliza para generar archivos `.dat` con datos ficticios de clientes. Está diseñado para crear conjuntos de datos de prueba para el microservicio de procesamiento de archivos, incluyendo la capacidad de introducir errores en un porcentaje configurable de las líneas.

## Características

- Genera datos de clientes con campos como ID, Nombre, Apellido, Email, Fecha de Nacimiento, Dirección, Ciudad, País (LATAM), Teléfono y Fecha de Registro.
- Utiliza la librería `@faker-js/faker` para generar datos realistas y variados.
- Permite configurar el número total de líneas a generar.
- Permite configurar un porcentaje de líneas que contendrán errores.
- Los tipos de errores introducidos aleatoriamente incluyen:
    - Número incorrecto de campos.
    - Campos requeridos vacíos (ej. email).
    - Formato de datos incorrecto (ej. ID no numérico, formato de fecha inválido).
- El archivo de salida es un archivo de texto plano donde cada línea representa un registro y los campos están separados por comas (formato CSV-like).

## Requisitos Previos

- Node.js (v16 o superior recomendado)
- pnpm (o npm/yarn)

## Instalación de Dependencias

Desde la carpeta `data-generator`, ejecuta:

```bash
pnpm install