'use strict';
const { getDb }             = require('../db/database');
const { verifySocketToken } = require('../middleware/auth');
const ms                    = require('../mediasoup/worker');

// La saisie client est limitée à 20 000 caractères. On garde une petite marge
// pour les marqueurs internes ajoutés aux messages contenant une image.
const MAX_CHAT_PAYLOAD_LENGTH = 22000;

// Salons éphémères : désactivés dans l'interface → refusés aussi côté serveur.
// Repasser à true pour les réactiver (les entrées sont validées plus bas).
const EPHEMERAL_ENABLED = false;

// Identifiant de salon : entier, ou chaîne purement numérique
const isId = v => Number.isInteger(v) || (typeof v === 'string' && /^\d{1,12}$/.test(v));

// URL d'image acceptable pour un avatar / une bannière : chemin local, http(s)
// ou data-URI image. Jamais de guillemets, chevrons, espaces ni antislash
// (ils permettraient de sortir d'un attribut HTML ou d'un url() CSS).
function isSafeImageUrl(u) {
  if (typeof u !== 'string' || u.length === 0 || u.length > 500000) return false;
  if (/["<>\\\s]/.test(u)) return false;
  if (u.startsWith('/')) return !u.startsWith('//');
  return /^https?:\/\//i.test(u) || /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(u);
}
const isTextOrNull = (v, max) => v == null || (typeof v === 'string' && v.length <= max);

const ephemeralRooms = new Map();
const onlineUsers    = new Map();           // userId → socketId
const voiceMembers   = new Map();           // channelId(str) → Set<{userId,username}>
const textViewers    = new Map();           // channelId(str) → Set<{userId,username}>

function setupSocketHandlers(io) {

  io.use((socket, next) => {
    const user = verifySocketToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('Non authentifié'));

    // Le token seul ne suffit pas : le compte doit toujours exister, ne pas être
    // expiré, et le rôle est celui de la base (pas celui figé dans le token).
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
    socket.user = { id: row.id, username: row.username, role: row.role };
    next();
  });

  io.on('connection', async (socket) => {
    const { id: userId, username, role } = socket.user;
    onlineUsers.set(userId, socket.id);

    // ── Garde-fou global ──────────────────────────────────────────────────────
    // Une exception dans un handler (payload absent ou mal formé, erreur SQLite…)
    // ne doit JAMAIS faire tomber le process : on l'attrape et on la journalise.
    const rawOn = socket.on.bind(socket);
    socket.on = (event, handler) => rawOn(event, (...args) => {
      try {
        const result = handler(...args);
        if (result && typeof result.catch === 'function') {
          result.catch(err => console.error(`[socket] ${event} (${username}) :`, err.message));
        }
      } catch (err) {
        console.error(`[socket] ${event} (${username}) :`, err.message);
      }
    });

    // Anti-flood simple : `max` évènements par fenêtre de `windowMs`, par socket
    const floodBuckets = new Map();
    const allow = (key, max, windowMs) => {
      const now = Date.now();
      const b = floodBuckets.get(key);
      if (!b || now > b.reset) { floodBuckets.set(key, { count: 1, reset: now + windowMs }); return true; }
      return ++b.count <= max;
    };

    const db = getDb();
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), userId);
    console.log(`[socket] ${username} connecté [${socket.id}]`);

    socket.broadcast.emit('user:online', { userId, username });
    socket.emit('online:list', [...onlineUsers.keys()]);

    // Envoyer l'état actuel de tous les salons vocaux occupés
    for (const [channelId, membersMap] of voiceMembers.entries()) {
      if (membersMap.size > 0) {
        const members = [...membersMap.entries()].map(([id, name]) => ({ userId: id, username: name }));
        socket.emit('voice:members', { channelId, members });
      }
    }

    // ── CHAT TEXTUEL ──────────────────────────────────────────────────────────

    socket.on('chat:join', (channelId) => {
      if (!isId(channelId)) return;
      // Quitter l'ancien salon texte
      if (socket._textChannelId && socket._textChannelId !== channelId) {
        socket.leave(`ch:${socket._textChannelId}`);
        removeTextViewer(socket._textChannelId, userId, username, io);
      }
      socket._textChannelId = channelId;
      socket.join(`ch:${channelId}`);
      addTextViewer(channelId, userId, username, io);
    });

    socket.on('chat:leave', (channelId) => {
      if (!isId(channelId)) return;
      socket.leave(`ch:${channelId}`);
      removeTextViewer(channelId, userId, username, io);
      if (socket._textChannelId === channelId) socket._textChannelId = null;
    });

    socket.on('chat:message', ({ channelId, content }) => {
      if (typeof content !== 'string' || !isId(channelId)) return;
      if (!allow('chat', 10, 5000)) return;

      // Normalise seulement les fins de ligne Windows/macOS. On ne trim pas le
      // message afin de conserver l'indentation et les lignes vides collées.
      const normalizedContent = content.replace(/\r\n?/g, '\n');
      if (!normalizedContent.trim() || normalizedContent.length > MAX_CHAT_PAYLOAD_LENGTH) return;
      const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND type = ?').get(channelId, 'text');
      if (!channel) return;

      const info = db.prepare('INSERT INTO messages (channel_id, user_id, content) VALUES (?, ?, ?)').run(
        channelId, userId, normalizedContent
      );
      io.to(`ch:${channelId}`).emit('chat:message', {
        id: info.lastInsertRowid, channel_id: channelId,
        user_id: userId, username, role,
        content: normalizedContent,
        created_at: Math.floor(Date.now() / 1000),
      });
    });

    socket.on('chat:delete', ({ messageId, channelId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
      const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!msg) return;
      db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      io.to(`ch:${channelId}`).emit('chat:deleted', { messageId, channelId });
    });

    // ── ÉPINGLAGE ────────────────────────────────────────────────────────────
    socket.on('chat:pin', ({ messageId, channelId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
      db.prepare('UPDATE messages SET pinned = 1 WHERE id = ?').run(messageId);
      const msg = db.prepare(`
        SELECT m.*, u.username, u.role FROM messages m
        JOIN users u ON m.user_id = u.id WHERE m.id = ?
      `).get(messageId);
      if (msg) io.to(`ch:${channelId}`).emit('chat:pinned', { message: msg, channelId });
    });

    socket.on('chat:unpin', ({ messageId, channelId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
      db.prepare('UPDATE messages SET pinned = 0 WHERE id = ?').run(messageId);
      io.to(`ch:${channelId}`).emit('chat:unpinned', { messageId, channelId });
    });

    // ── MESSAGES PRIVÉS ───────────────────────────────────────────────────────

    socket.on('dm:send', ({ toId, content }) => {
      if (typeof content !== 'string' || !content.trim() || content.length > 2000) return;
      if (!Number.isInteger(toId) || !allow('dm', 10, 5000)) return;
      const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(toId);
      if (!target) return;

      const info = db.prepare('INSERT INTO direct_messages (from_id, to_id, content) VALUES (?, ?, ?)').run(
        userId, toId, content.trim()
      );
      const msg = {
        id: info.lastInsertRowid, from_id: userId, to_id: toId,
        from_username: username, to_username: target.username,
        content: content.trim(), created_at: Math.floor(Date.now() / 1000), read: 0,
      };
      socket.emit('dm:message', msg);
      const ts = onlineUsers.get(toId);
      if (ts) io.to(ts).emit('dm:message', msg);
    });

    // ── VOCAL PERMANENT ───────────────────────────────────────────────────────

    socket.on('voice:join', async ({ channelId }) => {
      // Le salon doit exister en base et être vocal (sinon n'importe qui pourrait
      // créer des salles mediasoup à volonté)
      if (!isId(channelId)) return;
      const voiceCh = db.prepare("SELECT id FROM channels WHERE id = ? AND type = 'voice'").get(channelId);
      if (!voiceCh) return socket.emit('voice:error', 'Salon vocal introuvable');

      // Quitter l'ancien vocal si différent
      if (socket._voiceChannelId && socket._voiceChannelId !== channelId) {
        const oldRoomId = `voice:${socket._voiceChannelId}`;
        leaveVoice(socket, socket._voiceChannelId, oldRoomId, io);
      }

      const roomId = `voice:${channelId}`;
      try {
        await ms.getOrCreateRoom(roomId);
        const room = ms.rooms.get(roomId);
        if (!room.peers.has(socket.id)) {
          room.peers.set(socket.id, { userId, username, transportIds: [] });
        }

        if (!voiceMembers.has(String(channelId))) voiceMembers.set(String(channelId), new Map());
        voiceMembers.get(String(channelId)).set(userId, username);

        socket._voiceChannelId = channelId;
        socket.join(roomId);

        socket.to(roomId).emit('voice:peer:joined', { peerId: socket.id, userId, username });

        const peers = [...room.peers.entries()]
          .filter(([pid]) => pid !== socket.id)
          .map(([pid, p]) => ({ peerId: pid, userId: p.userId, username: p.username }));
        socket.emit('voice:peers', peers);

        // Envoyer aussi les producers actifs (audio + screen en cours)
        const existingProducers = ms.getExistingProducers(roomId)
          .filter(p => p.peerId !== socket.id);
        if (existingProducers.length > 0) {
          socket.emit('ms:existingProducers', existingProducers);
        }

        emitVoiceMembers(channelId, io);
      } catch (err) {
        console.error('[voice:join]', err.message);
        socket.emit('voice:error', err.message);
      }
    });

    socket.on('voice:leave', ({ channelId }) => {
      if (!isId(channelId)) return;
      leaveVoice(socket, channelId, `voice:${channelId}`, io);
    });

    // ── Déplacer un membre vers un autre salon vocal (mod/admin) ──────────────
    socket.on('voice:move', ({ targetUserId, toChannelId }) => {
      if (!['admin', 'moderator'].includes(role)) return;   // garde de rôle serveur
      if (targetUserId == null || toChannelId == null) return;

      const targetSocketId = onlineUsers.get(targetUserId);
      if (!targetSocketId) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket) return;

      // La cible doit être en vocal, et pas déjà dans le salon de destination
      if (targetSocket._voiceChannelId == null) return;
      if (String(targetSocket._voiceChannelId) === String(toChannelId)) return;

      // Le client cible refait lui-même le handshake mediasoup (leave + join)
      targetSocket.emit('voice:forceMove', { toChannelId, by: username });
    });

    // ── SALON ÉPHÉMÈRE ────────────────────────────────────────────────────────

    socket.on('ephemeral:create', async ({ voiceName, withText }) => {
      if (!EPHEMERAL_ENABLED) return;
      voiceName = typeof voiceName === 'string' ? voiceName.trim().slice(0, 32) : '';
      const eid = `eph_${Date.now()}_${userId}`;
      await ms.getOrCreateRoom(`ephemeral:${eid}`);
      const room = ms.rooms.get(`ephemeral:${eid}`);
      room.peers.set(socket.id, { userId, username, transportIds: [] });

      const eph = {
        id: eid,
        voiceName: voiceName || `${username}'s room`,
        ownerId: userId, withText: !!withText,
        textMessages: [],
        members: new Map([[userId, username]]),
      };
      ephemeralRooms.set(eid, eph);
      socket.join(`ephemeral:${eid}`);

      io.emit('ephemeral:list', getEphemeralList());
      socket.emit('ephemeral:created', { eid, ...formatEphemeral(eph) });
    });

    socket.on('ephemeral:join', async ({ eid }) => {
      if (!EPHEMERAL_ENABLED) return;
      const eph = ephemeralRooms.get(eid);
      if (!eph) return socket.emit('voice:error', 'Salon éphémère introuvable');
      const room = ms.rooms.get(`ephemeral:${eid}`);
      if (!room) return socket.emit('voice:error', 'Salon mediasoup introuvable');

      room.peers.set(socket.id, { userId, username, transportIds: [] });
      eph.members.set(userId, username);
      socket.join(`ephemeral:${eid}`);

      socket.to(`ephemeral:${eid}`).emit('voice:peer:joined', { peerId: socket.id, userId, username });

      const peers = [...room.peers.entries()]
        .filter(([pid]) => pid !== socket.id)
        .map(([pid, p]) => ({ peerId: pid, userId: p.userId, username: p.username }));
      socket.emit('voice:peers', peers);

      io.emit('ephemeral:list', getEphemeralList());
    });

    socket.on('ephemeral:leave', ({ eid }) => leaveEphemeral(socket, eid, io));

    socket.on('ephemeral:message', ({ eid, content }) => {
      const eph = ephemeralRooms.get(eid);
      if (!EPHEMERAL_ENABLED) return;
      if (typeof content !== 'string' || content.length > 2000) return;
      if (!eph?.withText || !content.trim() || !eph.members.has(userId)) return;
      if (!allow('eph', 10, 5000)) return;
      const msg = { username, role, content: content.trim(), ts: Date.now() };
      eph.textMessages.push(msg);
      if (eph.textMessages.length > 200) eph.textMessages.shift();
      io.to(`ephemeral:${eid}`).emit('ephemeral:message', { eid, ...msg });
    });

    // ── MEDIASOUP SIGNALING ───────────────────────────────────────────────────

    // Autorisation SFU : n'autoriser les opérations mediasoup que sur une salle
    // effectivement rejointe (le peer est enregistré par voice:join / ephemeral).
    const isRoomMember = (roomId) => Boolean(ms.rooms.get(roomId)?.peers.has(socket.id));
    // Un transport n'est utilisable que par le socket qui l'a créé
    const ownsTransport = (roomId, transportId) =>
      Boolean(ms.rooms.get(roomId)?.peers.get(socket.id)?.transportIds.includes(transportId));

    socket.on('ms:getRouterCapabilities', ({ roomId }, cb) => {
      cb?.({ caps: ms.getRtpCapabilities(roomId) });
    });

    socket.on('ms:createTransport', async ({ roomId }, cb) => {
      if (!isRoomMember(roomId)) return cb?.({ error: 'Non autorisé' });
      try {
        const t = await ms.createWebRtcTransport(roomId);
        ms.rooms.get(roomId)?.peers.get(socket.id)?.transportIds.push(t.id);
        cb?.({ id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:connectTransport', async ({ roomId, transportId, dtlsParameters }, cb) => {
      if (!ownsTransport(roomId, transportId)) return cb?.({ error: 'Non autorisé' });
      try { await ms.connectTransport(roomId, transportId, dtlsParameters); cb?.({ ok: true }); }
      catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:produce', async ({ roomId, transportId, kind, rtpParameters, appData }, cb) => {
      if (!ownsTransport(roomId, transportId)) return cb?.({ error: 'Non autorisé' });
      try {
        const producerId = await ms.produce(roomId, socket.id, transportId, kind, rtpParameters, appData || {});
        // Notifier tous les autres peers avec appData (pour distinguer audio/screen)
        socket.to(roomId).emit('ms:newProducer', {
          peerId: socket.id, userId, username, producerId, kind, appData: appData || {}
        });
        // Notification dédiée pour le partage d'écran
        if (appData?.screenShare) {
          socket.to(roomId).emit('screen:started', { peerId: socket.id, userId, username });
        }
        cb?.({ producerId });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:consume', async ({ roomId, producerPeerId, transportId, rtpCapabilities, producerId }, cb) => {
      if (!ownsTransport(roomId, transportId)) return cb?.({ error: 'Non autorisé' });
      try { cb?.(await ms.consume(roomId, socket.id, producerPeerId, transportId, rtpCapabilities, producerId)); }
      catch (err) { cb?.({ error: err.message }); }
    });

    // ── RÉACTIONS ────────────────────────────────────────────────────────────

    socket.on('reaction:toggle', ({ messageId, emoji, channelId }) => {
      if (!Number.isInteger(Number(messageId))) return;
      // Un emoji : chaîne courte, sans caractère HTML ni espace
      if (typeof emoji !== 'string' || !emoji || emoji.length > 32 || /[<>&"'\s]/.test(emoji)) return;
      if (!allow('reaction', 20, 5000)) return;
      // Le salon de diffusion vient du message, pas du client
      const target = db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(messageId);
      if (!target) return;
      channelId = target.channel_id;
      const existing = db.prepare(
        'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
      ).get(messageId, userId, emoji);

      if (existing) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
      } else {
        db.prepare(
          'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
        ).run(messageId, userId, emoji);
      }

      // Recalculer toutes les réactions du message
      const rows = db.prepare(`
        SELECT r.emoji, r.user_id, u.username
        FROM reactions r JOIN users u ON r.user_id = u.id
        WHERE r.message_id = ?
        ORDER BY r.created_at
      `).all(messageId);

      // Grouper par emoji
      const grouped = {};
      rows.forEach(({ emoji, user_id, username }) => {
        if (!grouped[emoji]) grouped[emoji] = { emoji, count: 0, users: [] };
        grouped[emoji].count++;
        grouped[emoji].users.push({ userId: user_id, username });
      });

      io.to(`ch:${channelId}`).emit('reaction:update', {
        messageId,
        reactions: Object.values(grouped),
      });
    });

    // ── PROFIL ────────────────────────────────────────────────────────────────

    socket.on('profile:update', ({ bio, status, avatar_url, banner_url }) => {
      // Mettre à jour en DB
      if (!allow('profile', 5, 10000)) return;
      if (!isTextOrNull(bio, 200) || !isTextOrNull(status, 50)) return;
      if (avatar_url && !isSafeImageUrl(avatar_url)) return;
      if (banner_url && !isSafeImageUrl(banner_url)) return;
      bio = bio ?? null; status = status ?? null;
      avatar_url = avatar_url || null; banner_url = banner_url || null;

      db.prepare('UPDATE users SET bio=?, status=?, avatar_url=?, banner_url=? WHERE id=?')
        .run(bio ?? null, status ?? null, avatar_url ?? null, banner_url ?? null, userId);

      // Diffuser à tous
      io.emit('profile:updated', { userId, username, bio, status, avatar_url, banner_url });
    });

    // ── PARTAGE D'ÉCRAN ───────────────────────────────────────────────────────

    socket.on('screen:stop', ({ roomId }) => {
      // Informer les autres membres du salon que le partage s'est arrêté
      if (!isRoomMember(roomId)) return;
      socket.to(roomId).emit('screen:stopped', { peerId: socket.id, userId, username });
    });

    // ── MODÉRATION ────────────────────────────────────────────────────────────

    socket.on('mod:kick', ({ targetId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
      // Un modérateur ne peut pas expulser un admin
      const kicked = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId);
      if (kicked?.role === 'admin' && role !== 'admin') return;
      const ts = onlineUsers.get(targetId);
      if (ts) { io.to(ts).emit('kicked', { by: username }); io.sockets.sockets.get(ts)?.disconnect(true); }
    });

    // ── DÉCONNEXION ───────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      console.log(`[socket] ${username} déconnecté`);
      socket.broadcast.emit('user:offline', { userId });

      if (socket._voiceChannelId) leaveVoice(socket, socket._voiceChannelId, `voice:${socket._voiceChannelId}`, io);
      if (socket._textChannelId)  removeTextViewer(socket._textChannelId, userId, username, io);

      for (const [eid, eph] of ephemeralRooms.entries()) {
        if (eph.members.has(userId)) leaveEphemeral(socket, eid, io);
      }
    });
  });
}

// ── Helpers présence texte ────────────────────────────────────────────────────

function addTextViewer(channelId, userId, username, io) {
  const key = String(channelId);
  if (!textViewers.has(key)) textViewers.set(key, new Map());
  textViewers.get(key).set(userId, username);
  emitTextViewers(channelId, io);
}

function removeTextViewer(channelId, userId, username, io) {
  const key = String(channelId);
  textViewers.get(key)?.delete(userId);
  if (textViewers.get(key)?.size === 0) textViewers.delete(key);
  emitTextViewers(channelId, io);
}

function emitTextViewers(channelId, io) {
  const viewers = textViewers.get(String(channelId));
  const members = viewers ? [...viewers.entries()].map(([id, name]) => ({ userId: id, username: name })) : [];
  io.emit('text:viewers', { channelId, members });
}

function emitVoiceMembers(channelId, io) {
  const members_map = voiceMembers.get(String(channelId));
  const members = members_map ? [...members_map.entries()].map(([id, name]) => ({ userId: id, username: name })) : [];
  io.emit('voice:members', { channelId, members });
}

// ── Helpers voice ─────────────────────────────────────────────────────────────

function leaveVoice(socket, channelId, roomId, io) {
  const { id: userId, username } = socket.user;
  ms.peerLeft(roomId, socket.id);
  socket.leave(roomId);

  const members = voiceMembers.get(String(channelId));
  if (members) {
    members.delete(userId);
    if (members.size === 0) voiceMembers.delete(String(channelId));
  }

  socket.to(roomId).emit('voice:peer:left', { peerId: socket.id, userId, username });
  emitVoiceMembers(channelId, io);
  if (socket._voiceChannelId === channelId) socket._voiceChannelId = null;
}

// ── Helpers éphémères ─────────────────────────────────────────────────────────

function leaveEphemeral(socket, eid, io) {
  const { id: userId } = socket.user;
  const eph = ephemeralRooms.get(eid);
  if (!eph) return;

  ms.peerLeft(`ephemeral:${eid}`, socket.id);
  eph.members.delete(userId);
  socket.leave(`ephemeral:${eid}`);
  socket.to(`ephemeral:${eid}`).emit('voice:peer:left', { peerId: socket.id, userId, username });

  if (eph.members.size === 0) {
    ms.deleteRoom(`ephemeral:${eid}`);
    ephemeralRooms.delete(eid);
    console.log(`[ephemeral] ${eid} supprimé (vide)`);
  }
  io.emit('ephemeral:list', getEphemeralList());
}

function getEphemeralList() {
  return [...ephemeralRooms.entries()].map(([eid, eph]) => formatEphemeral({ id: eid, ...eph }));
}

function formatEphemeral(eph) {
  return {
    id: eph.id, voiceName: eph.voiceName,
    ownerId: eph.ownerId, withText: eph.withText,
    memberCount: eph.members?.size || 0,
    members: eph.members ? [...eph.members.entries()].map(([id, name]) => ({ userId: id, username: name })) : [],
  };
}

module.exports = { setupSocketHandlers };
