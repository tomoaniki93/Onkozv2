'use strict';
const { getDb }           = require('../db/database');
const { verifySocketToken } = require('../middleware/auth');
const ms = require('../mediasoup/worker');

// Salons éphémères (créés par users) : Map<roomId, { ownerId, voiceId, textId? }>
const ephemeralRooms = new Map();

// Présence en ligne : Map<userId, socketId>
const onlineUsers = new Map();

// Membres d'un salon vocal : Map<channelId (string), Set<userId>>
const voiceMembers = new Map();

function setupSocketHandlers(io) {

  // ── Middleware auth ────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const user  = verifySocketToken(token);
    if (!user) return next(new Error('Non authentifié'));
    socket.user = user;
    next();
  });

  // ── Connexion ──────────────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const { id: userId, username, role } = socket.user;
    onlineUsers.set(userId, socket.id);

    const db = getDb();
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), userId);

    console.log(`[socket] ${username} (${role}) connecté [${socket.id}]`);

    // Notifier tous les autres
    socket.broadcast.emit('user:online', { userId, username });
    socket.emit('online:list', [...onlineUsers.keys()]);

    // ── CHAT TEXTUEL ─────────────────────────────────────────────────────────

    socket.on('chat:join', (channelId) => {
      socket.join(`ch:${channelId}`);
    });

    socket.on('chat:leave', (channelId) => {
      socket.leave(`ch:${channelId}`);
    });

    socket.on('chat:message', ({ channelId, content }) => {
      if (!content || content.trim().length === 0) return;
      if (content.length > 2000) return;

      const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND type = ?').get(channelId, 'text');
      if (!channel) return;

      const info = db.prepare('INSERT INTO messages (channel_id, user_id, content) VALUES (?, ?, ?)').run(
        channelId, userId, content.trim()
      );

      const msg = {
        id: info.lastInsertRowid,
        channel_id: channelId,
        user_id: userId,
        username,
        role,
        content: content.trim(),
        created_at: Math.floor(Date.now() / 1000),
      };

      io.to(`ch:${channelId}`).emit('chat:message', msg);
    });

    // Suppression message (modérateur ou admin)
    socket.on('chat:delete', ({ messageId, channelId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
      const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!msg) return;
      db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      io.to(`ch:${channelId}`).emit('chat:deleted', { messageId, channelId });
    });

    // ── MESSAGES PRIVÉS ──────────────────────────────────────────────────────

    socket.on('dm:send', ({ toId, content }) => {
      if (!content || content.trim().length === 0) return;
      if (content.length > 2000) return;

      const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(toId);
      if (!target) return;

      const info = db.prepare('INSERT INTO direct_messages (from_id, to_id, content) VALUES (?, ?, ?)').run(
        userId, toId, content.trim()
      );

      const msg = {
        id: info.lastInsertRowid,
        from_id: userId,
        to_id: toId,
        from_username: username,
        to_username: target.username,
        content: content.trim(),
        created_at: Math.floor(Date.now() / 1000),
        read: 0,
      };

      // Envoyer à l'expéditeur et au destinataire (s'il est connecté)
      socket.emit('dm:message', msg);
      const targetSocket = onlineUsers.get(toId);
      if (targetSocket) {
        io.to(targetSocket).emit('dm:message', msg);
      }
    });

    // ── VOCAL PERMANENT ──────────────────────────────────────────────────────

    socket.on('voice:join', async ({ channelId }) => {
      const roomId = `voice:${channelId}`;
      try {
        await ms.getOrCreateRoom(roomId);
        const room = ms.rooms.get(roomId);

        if (!room.peers.has(socket.id)) {
          room.peers.set(socket.id, { userId, username, transportIds: [] });
        }

        if (!voiceMembers.has(String(channelId))) voiceMembers.set(String(channelId), new Set());
        voiceMembers.get(String(channelId)).add(userId);

        socket.join(roomId);

        // Informer les autres
        socket.to(roomId).emit('voice:peer:joined', { peerId: socket.id, userId, username });

        // Envoyer au nouveau la liste des peers actuels
        const peers = [...room.peers.entries()]
          .filter(([pid]) => pid !== socket.id)
          .map(([pid, p]) => ({ peerId: pid, userId: p.userId, username: p.username }));

        socket.emit('voice:peers', peers);

        // Mettre à jour la liste des membres vocaux
        io.emit('voice:members', { channelId, members: [...voiceMembers.get(String(channelId))] });

      } catch (err) {
        console.error('[voice:join]', err.message);
        socket.emit('voice:error', err.message);
      }
    });

    socket.on('voice:leave', ({ channelId }) => {
      const roomId = `voice:${channelId}`;
      leaveVoice(socket, channelId, roomId, io);
    });

    // ── SALON ÉPHÉMÈRE ────────────────────────────────────────────────────────

    socket.on('ephemeral:create', async ({ voiceName, withText }) => {
      const db  = getDb();
      const eid = `eph_${Date.now()}_${userId}`;

      // Créer le salon vocal éphémère (pas en DB, juste mediasoup + socket room)
      await ms.getOrCreateRoom(`ephemeral:${eid}`);
      const room = ms.rooms.get(`ephemeral:${eid}`);
      room.peers.set(socket.id, { userId, username, transportIds: [] });

      const ephemeral = {
        id: eid,
        voiceName: voiceName || `${username}'s room`,
        ownerId: userId,
        withText: !!withText,
        textMessages: [],
        members: new Set([userId]),
      };
      ephemeralRooms.set(eid, ephemeral);

      socket.join(`ephemeral:${eid}`);

      // Broadcast la liste des salons éphémères
      io.emit('ephemeral:list', getEphemeralList());
      socket.emit('ephemeral:created', { eid, ...formatEphemeral(ephemeral) });
    });

    socket.on('ephemeral:join', async ({ eid }) => {
      const eph = ephemeralRooms.get(eid);
      if (!eph) return socket.emit('voice:error', 'Salon éphémère introuvable');

      const room = ms.rooms.get(`ephemeral:${eid}`);
      if (!room) return socket.emit('voice:error', 'Salon mediasoup introuvable');

      room.peers.set(socket.id, { userId, username, transportIds: [] });
      eph.members.add(userId);
      socket.join(`ephemeral:${eid}`);

      socket.to(`ephemeral:${eid}`).emit('voice:peer:joined', { peerId: socket.id, userId, username });

      const peers = [...room.peers.entries()]
        .filter(([pid]) => pid !== socket.id)
        .map(([pid, p]) => ({ peerId: pid, userId: p.userId, username: p.username }));
      socket.emit('voice:peers', peers);

      io.emit('ephemeral:list', getEphemeralList());
    });

    socket.on('ephemeral:leave', ({ eid }) => {
      leaveEphemeral(socket, eid, io);
    });

    socket.on('ephemeral:message', ({ eid, content }) => {
      const eph = ephemeralRooms.get(eid);
      if (!eph || !eph.withText) return;
      if (!content || content.trim().length === 0) return;

      const msg = { username, role, content: content.trim(), ts: Date.now() };
      eph.textMessages.push(msg);
      io.to(`ephemeral:${eid}`).emit('ephemeral:message', { eid, ...msg });
    });

    // ── MEDIASOUP SIGNALING ──────────────────────────────────────────────────

    socket.on('ms:getRouterCapabilities', ({ roomId }, cb) => {
      const caps = ms.getRtpCapabilities(roomId);
      cb?.({ caps });
    });

    socket.on('ms:createTransport', async ({ roomId }, cb) => {
      try {
        const t = await ms.createWebRtcTransport(roomId);
        const room = ms.rooms.get(roomId);
        if (room?.peers.has(socket.id)) {
          room.peers.get(socket.id).transportIds.push(t.id);
        }
        cb?.({
          id: t.id,
          iceParameters: t.iceParameters,
          iceCandidates: t.iceCandidates,
          dtlsParameters: t.dtlsParameters,
        });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:connectTransport', async ({ roomId, transportId, dtlsParameters }, cb) => {
      try {
        await ms.connectTransport(roomId, transportId, dtlsParameters);
        cb?.({ ok: true });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:produce', async ({ roomId, transportId, kind, rtpParameters }, cb) => {
      try {
        const producerId = await ms.produce(roomId, socket.id, transportId, kind, rtpParameters);
        // Notifier les autres peers pour qu'ils consomment
        socket.to(roomId).emit('ms:newProducer', { peerId: socket.id, userId, username, producerId });
        cb?.({ producerId });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:consume', async ({ roomId, producerPeerId, transportId, rtpCapabilities }, cb) => {
      try {
        const data = await ms.consume(roomId, socket.id, producerPeerId, transportId, rtpCapabilities);
        cb?.(data);
      } catch (err) { cb?.({ error: err.message }); }
    });

    // ── MODÉRATION ────────────────────────────────────────────────────────────

    socket.on('mod:kick', ({ targetId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
      const targetSocket = onlineUsers.get(targetId);
      if (targetSocket) {
        io.to(targetSocket).emit('kicked', { by: username });
        io.sockets.sockets.get(targetSocket)?.disconnect(true);
      }
    });

    // ── DÉCONNEXION ───────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      console.log(`[socket] ${username} déconnecté`);
      socket.broadcast.emit('user:offline', { userId });

      // Quitter les salons vocaux permanents
      for (const [chId, members] of voiceMembers.entries()) {
        if (members.has(userId)) {
          const roomId = `voice:${chId}`;
          leaveVoice(socket, chId, roomId, io);
        }
      }

      // Quitter les salons éphémères
      for (const [eid, eph] of ephemeralRooms.entries()) {
        if (eph.members.has(userId)) {
          leaveEphemeral(socket, eid, io);
        }
      }
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function leaveVoice(socket, channelId, roomId, io) {
  const { id: userId, username } = socket.user;
  const remaining = ms.peerLeft(roomId, socket.id);
  socket.leave(roomId);

  const members = voiceMembers.get(String(channelId));
  if (members) {
    members.delete(userId);
    if (members.size === 0) voiceMembers.delete(String(channelId));
  }

  socket.to(roomId).emit('voice:peer:left', { peerId: socket.id, userId, username });
  io.emit('voice:members', { channelId, members: members ? [...members] : [] });
}

function leaveEphemeral(socket, eid, io) {
  const { id: userId } = socket.user;
  const eph = ephemeralRooms.get(eid);
  if (!eph) return;

  ms.peerLeft(`ephemeral:${eid}`, socket.id);
  eph.members.delete(userId);
  socket.leave(`ephemeral:${eid}`);

  socket.to(`ephemeral:${eid}`).emit('voice:peer:left', { peerId: socket.id, userId });

  // Salle vide → supprimer tout
  if (eph.members.size === 0) {
    ms.deleteRoom(`ephemeral:${eid}`);
    ephemeralRooms.delete(eid);
    console.log(`[ephemeral] Salon ${eid} supprimé (vide)`);
  }

  io.emit('ephemeral:list', getEphemeralList());
}

function getEphemeralList() {
  return [...ephemeralRooms.entries()].map(([eid, eph]) => formatEphemeral({ id: eid, ...eph }));
}

function formatEphemeral(eph) {
  return {
    id: eph.id,
    voiceName: eph.voiceName,
    ownerId: eph.ownerId,
    withText: eph.withText,
    memberCount: eph.members?.size || 0,
  };
}

module.exports = { setupSocketHandlers };
