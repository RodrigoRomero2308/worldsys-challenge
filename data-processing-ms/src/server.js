require('dotenv').config();

const app = require('./app');

const port = process.env.PORT || 3000;

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor escuchando en el puerto ${port} en todas las interfaces (0.0.0.0)`);
});

server.timeout = 0;