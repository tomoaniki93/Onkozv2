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
const userRoutes      = require('./routes/users');
const categoryRoutes  = require('./routes/categories');
const uploadRoutes    = require('./routes/upload');
const previewRoutes   = require('./routes/preview');
const bugRoutes       = require('./routes/bugs');

const PORT = process.env.PORT || 3000;

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express();
// Derrière nginx : faire confiance au proxy pour obtenir la vraie IP client
// (indispensable pour que le rate-limiting d'authentification fonctionne par IP)
app.set('trust proxy', 1);
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
// Les diagnostics du Bug Tracker peuvent être nettement plus gros qu'un message.
// 2 Mo reste volontairement borné ; les futurs Long Reports seront stockés à part.
app.use(express.json({ limit: '2mb' }));

// ── Content-Security-Policy ───────────────────────────────────────────────────
// Démarrée en Report-Only : les violations sont signalées dans la console du
// navigateur SANS rien bloquer. Une fois vérifié que RNNoise (WASM/worklet), les
// polices, les previews et le socket fonctionnent → passer CSP_REPORT_ONLY à false.
const CSP_REPORT_ONLY = true;
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",                          // scripts same-origin + WASM RNNoise
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Tailwind + styles inline
  "img-src 'self' data: https:",                                   // avatars, uploads, previews, miniatures
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self'",                                            // API + socket.io (même origine)
  "media-src 'self' blob:",                                        // flux WebRTC (srcObject) / blob
  "worker-src 'self' blob:",                                       // AudioWorklet
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader(
    CSP_REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
    CSP_POLICY
  );
  next();
});

// Fichiers statiques du client
app.use((req, res, next) => {
  try { decodeURIComponent(req.path); next(); }
  catch { res.status(400).end(); }
});
app.use(express.static(path.join(__dirname, '..', 'client')));

// Fichiers uploadés (images partagées)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Routes API ────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload',     uploadRoutes);
app.use('/api/preview',   previewRoutes);
app.use('/api/bugs',      bugRoutes);

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
    // Sécurité : refuser de démarrer en production sans secret JWT robuste
    const secret = process.env.JWT_SECRET;
    if (process.env.NODE_ENV === 'production' &&
        (!secret || secret.length < 32 || secret.includes('changeme'))) {
      console.error('[FATAL] JWT_SECRET manquant ou trop faible en production. ' +
        'Definissez une valeur aleatoire d\'au moins 32 caracteres dans .env.');
      process.exit(1);
    }

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
