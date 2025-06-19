const fs = require('fs');
const { Faker, es } = require('@faker-js/faker');
const { Command } = require('commander');

const program = new Command();
program
  .option('-l, --lines <number>', 'Número total de líneas a generar', '1000')
  .option('-e, --error-rate <number>', 'Tasa de error (ej. 0.01 para 1%)', '0')
  .option('-o, --output <string>', 'Archivo de salida', 'clientes.dat')
  .parse(process.argv);

const options = program.opts();
const totalLines = parseInt(options.lines);
const errorRate = parseFloat(options.errorRate);
const outputFile = options.output;

const faker = new Faker({ locale: [es] });

function generateId() {
  return faker.string.numeric(8);
}

function generateNombre() {
  return faker.person.firstName();
}

function generateApellido() {
  return faker.person.lastName();
}

function generateEmail(nombre, apellido) {
  return faker.internet.email({ firstName: nombre, lastName: apellido });
}

function generateFechaNacimiento() {
  const birthDate = faker.date.birthdate({ min: 18, max: 80, mode: 'age' });
  return birthDate.toISOString().split('T')[0];
}

function generateDireccion() {
  return faker.location.streetAddress(false);
}

function generateCiudad() {
  return faker.location.city();
}

function generatePais() {
  const paisesLatam = [
    "Argentina",
    "Bolivia",
    "Brasil",
    "Chile",
    "Colombia",
    "Costa Rica",
    "Cuba",
    "Ecuador",
    "El Salvador",
    "Guatemala",
    "Honduras",
    "México",
    "Nicaragua",
    "Panamá",
    "Paraguay",
    "Perú",
    "República Dominicana",
    "Uruguay",
    "Venezuela"
  ];
  return faker.helpers.arrayElement(paisesLatam);
}

function generateTelefono() {
  return faker.phone.number('###########');
}

function generateFechaRegistro() {
  const pastDate = faker.date.past({ years: 5 });
  return pastDate.toISOString().replace('T', ' ').substring(0, 19); // YYYY-MM-DD HH:MM:SS
}

function createRecord() {
  const nombre = generateNombre();
  const apellido = generateApellido();
  return [
    generateId(),
    nombre,
    apellido,
    generateEmail(nombre, apellido),
    generateFechaNacimiento(),
    generateDireccion(),
    generateCiudad(),
    generatePais(),
    generateTelefono(),
    generateFechaRegistro()
  ];
}

function introduceError(record) {
  const errorType = Math.floor(Math.random() * 4);
  const newRecord = [...record];

  switch (errorType) {
    case 0: // Número incorrecto de campos (eliminar uno)
      if (newRecord.length > 1) {
        newRecord.pop();
        console.log('IntroduceError: Se eliminó un campo para provocar número incorrecto de campos.');
      }
      break;
    case 1: // Campo requerido vacío (ej. email)
      const emailIndex = 3; // Suponiendo que el email es el cuarto campo (índice 3)
      if (newRecord.length > emailIndex) {
        newRecord[emailIndex] = "";
        console.log('IntroduceError: El campo email fue vaciado para provocar error.');
      }
      break;
    case 2: // Formato incorrecto (ID no numérico)
      const idIndex = 0;
      if (newRecord.length > idIndex) {
        newRecord[idIndex] = "ABC" + newRecord[idIndex];
        console.log('IntroduceError: El ID fue modificado a formato no numérico.');
      }
      break;
    case 3: // Formato incorrecto (Fecha Nacimiento)
      const fechaNacIndex = 4;
      if (newRecord.length > fechaNacIndex && newRecord[fechaNacIndex].includes('-')) {
        newRecord[fechaNacIndex] = newRecord[fechaNacIndex].replace(/-/g, '/'); // YYYY/MM/DD
        console.log('IntroduceError: El formato de la fecha de nacimiento fue modificado.');
      }
      break;
  }
  return newRecord;
}

const writeStream = fs.createWriteStream(outputFile);
console.log(`Generando ${totalLines} líneas en ${outputFile} con una tasa de error de ${errorRate * 100}%...`);

for (let i = 0; i < totalLines; i++) {
  let record = createRecord();
  if (Math.random() < errorRate) {
    record = introduceError(record);
  }
  // Convertir array a string CSV, asegurando que las cadenas con comas queden entre comillas.
  const line = record.map(field => (typeof field === 'string' && field.includes(',')) ? `"${field}"` : field).join(',');
  writeStream.write(line + '\n');

  if ((i + 1) % (Math.floor(totalLines / 10) || 1) === 0) {
    console.log(`Generadas ${i + 1} de ${totalLines} líneas...`);
  }
}

writeStream.end(() => {
  console.log(`Archivo ${outputFile} generado exitosamente con ${totalLines} líneas.`);
  console.log(`Uso: node generate-data.js --lines 10000 --error-rate 0.05 --output mi_archivo.dat`);
});
