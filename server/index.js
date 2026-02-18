'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const { Server } = require('socket.io');
const cors       = require('cors');

const { getDb, cleanOldDMs }       = require('./db/database');
const { createWorkers }            = require('./mediasoup/worker');
const { setupSocketHandlers }      = require('./socket/handlers');

const authRoutes     = require('./routes/auth');
const channelRoutes  = require('./routes/channels');
const userRoutes     = require('./routes/users');

const PORT = process.env.PORT || 3000;

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Fichiers statiques du client
app.use(express.static(path.join(__dirname, '..', 'client')));

// ── Routes API ────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/users',    userRoutes);

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// SPA fallback
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ── Nettoyage DM ──────────────────────────────────────────────────────────────
function scheduleDMCleanup() {
  const db = getDb();
  cleanOldDMs(db);
  setInterval(() => cleanOldDMs(getDb()), 60 * 60 * 1000); // toutes les heures
}

// ── Démarrage ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    // Init DB
    getDb();
    console.log('[DB] SQLite initialisée');

    // Init mediasoup workers
    await createWorkers();

    // Socket handlers
    setupSocketHandlers(io);

    // Nettoyage DM
    scheduleDMCleanup();

    server.listen(PORT, () => {
      console.log(`\n🎤 ONKOZ démarré sur http://localhost:${PORT}`);
      console.log(`   Domaine : https://${process.env.DOMAIN || 'onkoz.fr'}`);
      console.log(`   Env     : ${process.env.NODE_ENV || 'development'}\n`);
    });

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

start();
