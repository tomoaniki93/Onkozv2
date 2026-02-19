'use strict';
const { getDb }             = require('../db/database');
const { verifySocketToken } = require('../middleware/auth');
const ms                    = require('../mediasoup/worker');

const ephemeralRooms = new Map();
const onlineUsers    = new Map();           // userId → socketId
const voiceMembers   = new Map();           // channelId(str) → Set<{userId,username}>
const textViewers    = new Map();           // channelId(str) → Set<{userId,username}>

function setupSocketHandlers(io) {

  io.use((socket, next) => {
    const user = verifySocketToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('Non authentifié'));
    socket.user = user;
    next();
  });

  io.on('connection', async (socket) => {
    const { id: userId, username, role } = socket.user;
    onlineUsers.set(userId, socket.id);

    const db = getDb();
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), userId);
    console.log(`[socket] ${username} connecté [${socket.id}]`);

    socket.broadcast.emit('user:online', { userId, username });
    socket.emit('online:list', [...onlineUsers.keys()]);

    // ── CHAT TEXTUEL ──────────────────────────────────────────────────────────

    socket.on('chat:join', (channelId) => {
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
      socket.leave(`ch:${channelId}`);
      removeTextViewer(channelId, userId, username, io);
      if (socket._textChannelId === channelId) socket._textChannelId = null;
    });

    socket.on('chat:message', ({ channelId, content }) => {
      if (!content?.trim() || content.length > 2000) return;
      const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND type = ?').get(channelId, 'text');
      if (!channel) return;

      const info = db.prepare('INSERT INTO messages (channel_id, user_id, content) VALUES (?, ?, ?)').run(
        channelId, userId, content.trim()
      );
      io.to(`ch:${channelId}`).emit('chat:message', {
        id: info.lastInsertRowid, channel_id: channelId,
        user_id: userId, username, role,
        content: content.trim(),
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

    // ── MESSAGES PRIVÉS ───────────────────────────────────────────────────────

    socket.on('dm:send', ({ toId, content }) => {
      if (!content?.trim() || content.length > 2000) return;
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

        emitVoiceMembers(channelId, io);
      } catch (err) {
        console.error('[voice:join]', err.message);
        socket.emit('voice:error', err.message);
      }
    });

    socket.on('voice:leave', ({ channelId }) => {
      leaveVoice(socket, channelId, `voice:${channelId}`, io);
    });

    // ── SALON ÉPHÉMÈRE ────────────────────────────────────────────────────────

    socket.on('ephemeral:create', async ({ voiceName, withText }) => {
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
      if (!eph?.withText || !content?.trim()) return;
      const msg = { username, role, content: content.trim(), ts: Date.now() };
      eph.textMessages.push(msg);
      io.to(`ephemeral:${eid}`).emit('ephemeral:message', { eid, ...msg });
    });

    // ── MEDIASOUP SIGNALING ───────────────────────────────────────────────────

    socket.on('ms:getRouterCapabilities', ({ roomId }, cb) => {
      cb?.({ caps: ms.getRtpCapabilities(roomId) });
    });

    socket.on('ms:createTransport', async ({ roomId }, cb) => {
      try {
        const t = await ms.createWebRtcTransport(roomId);
        ms.rooms.get(roomId)?.peers.get(socket.id)?.transportIds.push(t.id);
        cb?.({ id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:connectTransport', async ({ roomId, transportId, dtlsParameters }, cb) => {
      try { await ms.connectTransport(roomId, transportId, dtlsParameters); cb?.({ ok: true }); }
      catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:produce', async ({ roomId, transportId, kind, rtpParameters }, cb) => {
      try {
        const producerId = await ms.produce(roomId, socket.id, transportId, kind, rtpParameters);
        socket.to(roomId).emit('ms:newProducer', { peerId: socket.id, userId, username, producerId });
        cb?.({ producerId });
      } catch (err) { cb?.({ error: err.message }); }
    });

    socket.on('ms:consume', async ({ roomId, producerPeerId, transportId, rtpCapabilities }, cb) => {
      try { cb?.(await ms.consume(roomId, socket.id, producerPeerId, transportId, rtpCapabilities)); }
      catch (err) { cb?.({ error: err.message }); }
    });

    // ── MODÉRATION ────────────────────────────────────────────────────────────

    socket.on('mod:kick', ({ targetId }) => {
      if (!['admin', 'moderator'].includes(role)) return;
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
  socket.to(`ephemeral:${eid}`).emit('voice:peer:left', { peerId: socket.id, userId });

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
