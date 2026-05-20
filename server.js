const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let whatsappClient = null;
let clientState = 'idle';
let cachedContacts = [];

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Frontend conectado: ${socket.id}`);

  socket.emit('state', clientState);

  if (clientState === 'ready' && cachedContacts.length > 0) {
    socket.emit('contacts', cachedContacts);
  }

  socket.on('connect-whatsapp', () => {
    if (clientState !== 'idle' && clientState !== 'error') {
      socket.emit('status', { type: clientState, message: 'WhatsApp ya está conectándose...' });
      return;
    }
    startWhatsApp();
  });

  socket.on('disconnect-whatsapp', async () => {
    if (whatsappClient) {
      try { await whatsappClient.destroy(); } catch (_) {}
      whatsappClient = null;
    }
    clientState = 'idle';
    cachedContacts = [];
    io.emit('state', 'idle');
    io.emit('status', { type: 'warning', message: 'Desconectado de WhatsApp.' });
  });

  socket.on('cleanup-session', async () => {
    if (whatsappClient) {
      try { await whatsappClient.destroy(); } catch (_) {}
      whatsappClient = null;
    }
    clientState = 'idle';
    cachedContacts = [];
    try {
      fs.rmSync(path.join(__dirname, 'wa-session'), { recursive: true, force: true });
      console.log('Sesión eliminada del disco.');
    } catch (_) {}
    io.emit('state', 'idle');
    io.emit('cleanup-done');
    io.emit('status', { type: 'done', message: 'Sesión eliminada. No quedan datos guardados en el servidor.' });
  });
});

function startWhatsApp() {
  clientState = 'initializing';
  io.emit('state', 'initializing');
  io.emit('status', { type: 'loading', message: 'Iniciando WhatsApp, aguardá unos segundos...' });

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: './wa-session' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  whatsappClient.on('qr', async (qr) => {
    clientState = 'qr';
    io.emit('state', 'qr');
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        scale: 8,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });
      io.emit('qr', qrDataUrl);
      io.emit('status', { type: 'qr', message: 'Escaneá el código QR con tu WhatsApp' });
    } catch (err) {
      console.error('Error generando QR:', err);
    }
  });

  whatsappClient.on('authenticated', () => {
    clientState = 'authenticated';
    io.emit('state', 'authenticated');
    io.emit('status', { type: 'success', message: 'Autenticado correctamente. Cargando contactos...' });
  });

  whatsappClient.on('ready', async () => {
    clientState = 'ready';
    io.emit('state', 'ready');
    io.emit('status', { type: 'loading', message: 'Obteniendo contactos de tu agenda...' });

    try {
      const allContacts = await whatsappClient.getContacts();

      const contacts = allContacts
        .filter(c => c.isMyContact && c.number && !c.isGroup)
        .map(c => ({
          name: c.name || c.pushname || ('+' + c.number),
          number: '+' + c.number
        }))
        .filter((c, i, arr) => arr.findIndex(x => x.number === c.number) === i)
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

      cachedContacts = contacts;
      io.emit('contacts', contacts);
      io.emit('status', { type: 'done', message: `${contacts.length} contactos encontrados` });
      console.log(`Contactos exportados: ${contacts.length}`);
    } catch (err) {
      console.error('Error obteniendo contactos:', err);
      io.emit('status', { type: 'error', message: 'Error al obtener contactos: ' + err.message });
    }
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('Auth failure:', msg);
    clientState = 'error';
    io.emit('state', 'error');
    io.emit('status', { type: 'error', message: 'Error de autenticación. Intentá de nuevo.' });
    whatsappClient = null;
  });

  whatsappClient.on('disconnected', (reason) => {
    console.log('Desconectado:', reason);
    clientState = 'idle';
    io.emit('state', 'idle');
    io.emit('status', { type: 'warning', message: 'WhatsApp desconectado: ' + reason });
    whatsappClient = null;
  });

  whatsappClient.initialize().catch(err => {
    console.error('Error de inicialización:', err);
    clientState = 'error';
    io.emit('state', 'error');
    io.emit('status', { type: 'error', message: 'Error al iniciar Chromium: ' + err.message });
    whatsappClient = null;
  });
}

server.listen(PORT, () => {
  console.log(`\n✅ Servidor corriendo en http://localhost:${PORT}\n`);
});
