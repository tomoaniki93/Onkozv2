'use strict';

/* ── SpeedG en ligne ─────────────────────────────────────────────────────────
   Salons de course entre membres d'ONKOZ, sur un espace de noms Socket.IO à
   part (/speedg) : rien n'est partagé avec les salons vocaux / texte de
   handlers.js, et aucune table SQLite n'est utilisée (tout est en mémoire).

   Le serveur ne simule pas la course : il tient les salons et relaie les
   messages. Comme dans la version Godot du jeu, l'hôte du salon fait autorité
   (arrivées, éliminations, impacts, IA) ; le serveur vérifie seulement que les
   messages réservés à l'hôte viennent bien de lui, et borne ce qu'il relaie.

   Authentification : même token que le reste d'ONKOZ ; le pseudo en course est
   celui du compte.
   ─────────────────────────────────────────────────────────────────────────── */

const { getDb }             = require('../db/database');
const { verifySocketToken } = require('../middleware/auth');

const MAX_PLAYERS = 8;
const MAX_ROOMS   = 100;
const TRACKS      = 12;           // nombre de circuits du jeu
const CUPS        = 3;            // coupes du championnat
const MODES       = ['champ', 'ko', 'time'];
const EVENTS      = ['finish', 'elim', 'hit_missile', 'hit_mine', 'hit_wave', 'block'];
const ITEMS       = ['missile', 'mine', 'shield', 'wave'];
const CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // sans I ni O (confusion avec 1 et 0)

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Pseudo affiché en course : majuscules, 12 caractères (comme Zero-Gravity).
const cleanName = s => String(s == null ? '' : s).normalize('NFC').toUpperCase()
  .replace(/[^A-Z0-9_À-ÖØ-Þ .'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);

function setupSpeedG(io) {
  const nsp   = io.of('/speedg');
  const rooms = new Map();        // code → salon

  // ── Authentification (identique à handlers.js) ─────────────────────────────
  nsp.use((socket, next) => {
    const user = verifySocketToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('Non authentifié'));
    let row;
    try {
      row = getDb().prepare(
        'SELECT id, username, role, is_ephemeral, expires_at FROM users WHERE id = ?'
      ).get(user.id);
    } catch { return next(new Error('Non authentifié')); }
    if (!row) return next(new Error('Non authentifié'));
    if (row.is_ephemeral && row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
      return next(new Error('Compte éphémère expiré'));
    }
    socket.user = { id: row.id, username: row.username };
    next();
  });

  // ── Salons ─────────────────────────────────────────────────────────────────
  const chan = code => `speedg:${code}`;

  function newCode() {
    for (let tries = 0; tries < 50; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  // Ce que les joueurs voient du salon
  const view = room => ({
    code: room.code, host: room.host, public: room.public, in_race: room.inRace,
    lobby: room.lobby,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name })),
  });
  const push = room => nsp.to(chan(room.code)).emit('room', view(room));

  // Deux onglets du même compte dans un salon : le second s'appelle « PSEUDO 2 »
  function uniqueName(room, base) {
    const taken = new Set([...room.players.values()].map(p => p.name));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 20; n++) {
      const name = `${base.slice(0, 10)} ${n}`;
      if (!taken.has(name)) return name;
    }
    return base;
  }

  function checkAllLoaded(room) {
    if (!room.inRace || room.ready.size === 0) return;
    for (const id of room.players.keys()) if (!room.ready.has(id)) return;
    room.ready.clear();
    nsp.to(chan(room.code)).emit('go');
  }

  function leave(socket) {
    const room = rooms.get(socket.data.room);
    socket.data.room = null;
    if (!room) return;
    socket.leave(chan(room.code));
    room.players.delete(socket.id);
    room.ready.delete(socket.id);
    if (socket.id === room.host || room.players.size === 0) {
      // L'hôte fait tourner la course : sans lui le salon s'arrête (comme dans le jeu d'origine)
      rooms.delete(room.code);
      nsp.to(chan(room.code)).emit('closed');
      for (const id of room.players.keys()) {
        const s = nsp.sockets.get(id);
        if (s) { s.leave(chan(room.code)); s.data.room = null; }
      }
      console.log(`[SpeedG] Salon ${room.code} fermé`);
      return;
    }
    nsp.to(chan(room.code)).emit('left', socket.id);
    push(room);
    checkAllLoaded(room);
  }

  nsp.on('connection', (socket) => {
    const name = cleanName(socket.user.username) || `PILOTE-${socket.user.id}`;
    socket.data.room = null;

    // Une exception dans un handler ne doit jamais faire tomber le process.
    const rawOn = socket.on.bind(socket);
    socket.on = (event, handler) => rawOn(event, (...args) => {
      try { handler(...args); }
      catch (err) { console.error(`[SpeedG] ${event} (${name}) :`, err.message); }
    });

    // Anti-flood simple : `max` évènements par fenêtre de `windowMs`, par socket
    const buckets = new Map();
    const allow = (key, max, windowMs) => {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || now > b.reset) { buckets.set(key, { count: 1, reset: now + windowMs }); return true; }
      return ++b.count <= max;
    };

    const myRoom  = () => rooms.get(socket.data.room);
    const isHost  = room => !!room && room.host === socket.id;
    const reply   = (ack, data) => { if (typeof ack === 'function') ack(data); };
    const toOthers = () => socket.to(chan(socket.data.room));

    function enter(room) {
      const player = { id: socket.id, name: uniqueName(room, name), userId: socket.user.id };
      room.players.set(socket.id, player);
      socket.join(chan(room.code));
      socket.data.room = room.code;
      push(room);
    }

    // ── Liste des parties publiques ──────────────────────────────────────────
    socket.on('rooms', (ack) => {
      if (!allow('rooms', 20, 10000)) return reply(ack, { ok: false, error: 'Trop de requêtes' });
      const list = [];
      for (const room of rooms.values()) {
        if (!room.public) continue;
        const host = room.players.get(room.host);
        list.push({ code: room.code, host: host ? host.name : '?', players: room.players.size, mode: room.lobby.mode, in_race: room.inRace });
      }
      reply(ack, { ok: true, rooms: list });
    });

    // ── Créer / rejoindre / quitter ──────────────────────────────────────────
    socket.on('create', (opts, ack) => {
      if (!allow('create', 6, 60000)) return reply(ack, { ok: false, error: 'Trop de requêtes' });
      leave(socket);
      const code = rooms.size < MAX_ROOMS ? newCode() : null;
      if (!code) return reply(ack, { ok: false, error: 'Serveur complet' });
      const room = {
        code, host: socket.id, public: !opts || opts.public !== false, inRace: false,
        lobby: { mode: 'champ', track: 0 }, players: new Map(), ready: new Set(),
      };
      rooms.set(code, room);
      enter(room);
      console.log(`[SpeedG] Salon ${code} ouvert par ${name}`);
      reply(ack, { ok: true, room: view(room) });
    });

    socket.on('join', (code, ack) => {
      if (!allow('join', 20, 60000)) return reply(ack, { ok: false, error: 'Trop de requêtes' });
      const room = rooms.get(String(code || '').toUpperCase().slice(0, 4));
      if (!room) return reply(ack, { ok: false, error: 'Code inconnu' });
      if (room.players.has(socket.id)) return reply(ack, { ok: true, room: view(room) });
      if (room.players.size >= MAX_PLAYERS) return reply(ack, { ok: false, error: 'Salon complet' });
      if (room.inRace) return reply(ack, { ok: false, error: 'Partie en cours' });
      leave(socket);
      enter(room);
      reply(ack, { ok: true, room: view(room) });
    });

    socket.on('leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));

    // ── Salon : réglages de l'hôte, lancement ────────────────────────────────
    socket.on('lobby', (l) => {
      const room = myRoom();
      if (!isHost(room) || room.inRace || !l || !MODES.includes(l.mode)) return;
      const max = l.mode === 'champ' ? CUPS : TRACKS;
      room.lobby = { mode: l.mode, track: isInt(l.track, 0, max - 1) ? l.track : 0 };
      push(room);
    });

    socket.on('start', (cfg) => {
      const room = myRoom();
      if (!isHost(room) || !allow('start', 10, 60000)) return;
      // Configuration de course bâtie par l'hôte : forme vérifiée, puis diffusée telle quelle
      if (!cfg || !MODES.includes(cfg.mode) || !isInt(cfg.track, 0, TRACKS - 1)) return;
      if (!Array.isArray(cfg.racers) || cfg.racers.length < 1 || cfg.racers.length > 16) return;
      if (JSON.stringify(cfg).length > 8000) return;
      for (const r of cfg.racers) {
        if (!r || typeof r.name !== 'string' || r.name.length > 16) return;
        if (!Array.isArray(r.color) || r.color.length !== 3 || !r.color.every(isNum)) return;
        if (r.kind !== 'ai' && r.kind !== 'human') return;
        if (r.kind === 'human' && !room.players.has(r.peer)) return;
      }
      room.inRace = true;
      room.ready.clear();
      nsp.to(chan(room.code)).emit('start', cfg);
      push(room);
    });

    socket.on('loaded', () => {
      const room = myRoom();
      if (!room || !room.inRace) return;
      room.ready.add(socket.id);
      checkAllLoaded(room);
    });

    // L'hôte force le départ si un joueur tarde à charger
    socket.on('go', () => {
      const room = myRoom();
      if (!isHost(room) || !room.inRace) return;
      room.ready.clear();
      nsp.to(chan(room.code)).emit('go');
    });

    socket.on('tolobby', () => {
      const room = myRoom();
      if (!isHost(room)) return;
      room.inRace = false;
      room.ready.clear();
      nsp.to(chan(room.code)).emit('tolobby');
      push(room);
    });

    // ── Pendant la course : relais ───────────────────────────────────────────
    // États des motos (~30 messages/s par joueur) : « volatile », un message
    // en retard est abandonné plutôt que mis en file.
    socket.on('st', (list) => {
      const room = myRoom();
      if (!room || !room.inRace || !allow('st', 120, 1000)) return;
      if (!Array.isArray(list) || list.length > 16) return;
      for (const e of list) {
        if (!Array.isArray(e) || !isInt(e[0], 0, 15)) return;
        if (!Array.isArray(e[1]) || e[1].length !== 7 || !e[1].every(isNum)) return;
      }
      toOthers().volatile.emit('st', list);
    });

    // Arrivées, éliminations, impacts : décidés par l'hôte uniquement
    socket.on('ev', (kind, idx, value) => {
      const room = myRoom();
      if (!isHost(room) || !EVENTS.includes(kind) || !isInt(idx, 0, 15) || !isNum(value)) return;
      if (!allow('ev', 200, 1000)) return;
      toOthers().emit('ev', kind, idx, value);
    });

    socket.on('item', (kind, owner, s, x, target, id) => {
      const room = myRoom();
      if (!room || !room.inRace || !ITEMS.includes(kind) || !allow('item', 60, 1000)) return;
      if (!isInt(owner, 0, 15) || !isNum(s) || !isNum(x) || !isInt(target, -1, 15) || !isNum(id)) return;
      toOthers().emit('item', kind, owner, s, x, target, id);
    });

    socket.on('over', (order) => {
      const room = myRoom();
      if (!isHost(room)) return;
      if (!Array.isArray(order) || order.length > 16 || !order.every(i => isInt(i, 0, 15))) return;
      toOthers().emit('over', order);
    });
  });

  console.log('[SpeedG] Mode en ligne prêt (namespace /speedg)');
}

module.exports = { setupSpeedG };
