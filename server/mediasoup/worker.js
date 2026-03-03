'use strict';
const mediasoup = require('mediasoup');

const ANNOUNCED_IP = () => process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1';

const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8',  clockRate: 90000, parameters: {} },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

let workers   = [];
let workerIdx = 0;

async function createWorkers(num) {
  const count = num || parseInt(process.env.MEDIASOUP_NUM_WORKERS || '1');
  for (let i = 0; i < count; i++) {
    const w = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000'),
      rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '49999'),
    });
    w.on('died', () => { console.error('[mediasoup] worker died'); process.exit(1); });
    workers.push(w);
    console.log(`[mediasoup] Worker #${i} créé (pid ${w.pid})`);
  }
}

function getNextWorker() {
  const w = workers[workerIdx % workers.length];
  workerIdx++;
  return w;
}

// ── Rooms ──────────────────────────────────────────────────────────────────────
// ✅ FIX BUG 1 : producers stockés par producerId (pas peerId)
//               pour supporter audio + screen share simultanément par peer
const rooms = new Map();

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const router = await getNextWorker().createRouter({ mediaCodecs: MEDIA_CODECS });
  const room = {
    router,
    producers:  new Map(), // ✅ producerId → { producer, peerId, appData }
    consumers:  new Map(), // consumerId  → consumer
    transports: new Map(), // transportId → transport
    peers:      new Map(), // peerId      → { userId, username, transportIds[] }
  };
  rooms.set(roomId, room);
  console.log(`[mediasoup] Salle "${roomId}" créée`);
  return room;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const t of room.transports.values()) { try { t.close(); } catch {} }
  room.router.close();
  rooms.delete(roomId);
  console.log(`[mediasoup] Salle "${roomId}" supprimée`);
}

function getRtpCapabilities(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.router.rtpCapabilities;
}

// ── Transport ──────────────────────────────────────────────────────────────────
async function createWebRtcTransport(roomId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');
  const transport = await room.router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: ANNOUNCED_IP() }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  room.transports.set(transport.id, transport);
  return transport;
}

async function connectTransport(roomId, transportId, dtlsParameters) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transport introuvable');
  await transport.connect({ dtlsParameters });
}

// ── Produce ────────────────────────────────────────────────────────────────────
// ✅ FIX BUG 1 & 2 : accepter appData, stocker par producerId
async function produce(roomId, peerId, transportId, kind, rtpParameters, appData = {}) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transport introuvable');

  const producer = await transport.produce({ kind, rtpParameters, appData });

  // ✅ Clé = producerId (et non peerId) → supporte plusieurs producers par peer
  room.producers.set(producer.id, { producer, peerId, appData });

  producer.on('transportclose', () => {
    room.producers.delete(producer.id);
  });

  console.log(`[mediasoup] Producer ${producer.id} (${kind}) peer=${peerId} screen=${!!appData?.screenShare}`);
  return producer.id;
}

// ── Consume ────────────────────────────────────────────────────────────────────
// ✅ FIX BUG 3 : chercher par producerId directement (plus producerPeerId)
async function consume(roomId, consumerPeerId, producerId, transportId, rtpCapabilities) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');

  const entry = room.producers.get(producerId);
  if (!entry) throw new Error(`Producteur introuvable : ${producerId}`);
  const { producer } = entry;

  if (!room.router.canConsume({ producerId: producer.id, rtpCapabilities }))
    throw new Error('Codecs incompatibles');

  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transport consommateur introuvable');

  const consumer = await transport.consume({ producerId: producer.id, rtpCapabilities, paused: false });
  room.consumers.set(consumer.id, consumer);
  consumer.on('transportclose', () => room.consumers.delete(consumer.id));
  consumer.on('producerclose',  () => room.consumers.delete(consumer.id));

  return {
    id:            consumer.id,
    producerId:    producer.id,
    kind:          consumer.kind,
    rtpParameters: consumer.rtpParameters,
    appData:       entry.appData, // ✅ retourner appData pour distinguer audio/screen
  };
}

// ── Peer quitte ────────────────────────────────────────────────────────────────
// ✅ FIX : fermer TOUS les producers du peer (audio + screen share)
function peerLeft(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const [prodId, entry] of room.producers.entries()) {
    if (entry.peerId === peerId) {
      try { entry.producer.close(); } catch {}
      room.producers.delete(prodId);
    }
  }

  const peer = room.peers.get(peerId);
  if (peer) {
    for (const tId of peer.transportIds) {
      const t = room.transports.get(tId);
      if (t) { try { t.close(); } catch {} room.transports.delete(tId); }
    }
    room.peers.delete(peerId);
  }

  return room.peers.size;
}

module.exports = {
  createWorkers,
  getOrCreateRoom,
  deleteRoom,
  getRtpCapabilities,
  createWebRtcTransport,
  connectTransport,
  produce,
  consume,
  peerLeft,
  rooms,
};
