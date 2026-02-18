'use strict';
const mediasoup = require('mediasoup');

// ── Configuration ─────────────────────────────────────────────────────────────
const ANNOUNCED_IP   = () => process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1';
const RTC_MIN_PORT   = () => parseInt(process.env.RTC_MIN_PORT)  || 40000;
const RTC_MAX_PORT   = () => parseInt(process.env.RTC_MAX_PORT)  || 49999;
const NUM_WORKERS    = () => parseInt(process.env.MEDIASOUP_NUM_WORKERS) || 2;

const MEDIA_CODECS = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  }
];

// ── Workers ───────────────────────────────────────────────────────────────────
let workers = [];
let workerIdx = 0;

async function createWorkers() {
  const n = NUM_WORKERS();
  console.log(`[mediasoup] Création de ${n} worker(s)...`);

  for (let i = 0; i < n; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: RTC_MIN_PORT(),
      rtcMaxPort: RTC_MAX_PORT(),
    });
    worker.on('died', () => {
      console.error(`[mediasoup] Worker ${worker.pid} est mort — redémarrage dans 2s`);
      setTimeout(() => process.exit(1), 2000);
    });
    workers.push(worker);
    console.log(`[mediasoup] Worker ${i + 1}/${n} créé (pid: ${worker.pid})`);
  }
}

function getNextWorker() {
  const w = workers[workerIdx % workers.length];
  workerIdx++;
  return w;
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
// Map<roomId, { router, producers: Map, consumers: Map, transports: Map }>
const rooms = new Map();

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });

  const room = {
    router,
    producers:  new Map(), // peerId → producer
    consumers:  new Map(), // consumerId → consumer
    transports: new Map(), // transportId → transport
    peers:      new Map(), // peerId → { userId, username, transportIds: [] }
  };

  rooms.set(roomId, room);
  console.log(`[mediasoup] Salle "${roomId}" créée`);
  return room;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Fermer tous les transports
  for (const t of room.transports.values()) {
    try { t.close(); } catch {}
  }
  room.router.close();
  rooms.delete(roomId);
  console.log(`[mediasoup] Salle "${roomId}" supprimée`);
}

function getRtpCapabilities(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.router.rtpCapabilities;
}

// ── Transports WebRTC ─────────────────────────────────────────────────────────
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

// ── Produce ───────────────────────────────────────────────────────────────────
async function produce(roomId, peerId, transportId, kind, rtpParameters) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transport introuvable');

  const producer = await transport.produce({ kind, rtpParameters });
  room.producers.set(peerId, producer);

  producer.on('transportclose', () => {
    room.producers.delete(peerId);
  });

  return producer.id;
}

// ── Consume ───────────────────────────────────────────────────────────────────
async function consume(roomId, consumerPeerId, producerPeerId, transportId, rtpCapabilities) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');

  const producer  = room.producers.get(producerPeerId);
  if (!producer) throw new Error('Producteur introuvable');

  if (!room.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
    throw new Error('Impossible de consommer ce producteur');
  }

  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transport consommateur introuvable');

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: false,
  });

  room.consumers.set(consumer.id, consumer);

  consumer.on('transportclose', () => room.consumers.delete(consumer.id));
  consumer.on('producerclose',  () => room.consumers.delete(consumer.id));

  return {
    id:            consumer.id,
    producerId:    producer.id,
    kind:          consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

// ── Peer quitte la salle ──────────────────────────────────────────────────────
function peerLeft(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Fermer le producer du peer
  const producer = room.producers.get(peerId);
  if (producer) {
    try { producer.close(); } catch {}
    room.producers.delete(peerId);
  }

  // Retirer le peer
  const peer = room.peers.get(peerId);
  if (peer) {
    for (const tId of peer.transportIds) {
      const t = room.transports.get(tId);
      if (t) { try { t.close(); } catch {} room.transports.delete(tId); }
    }
    room.peers.delete(peerId);
  }

  // Salle vide → supprimer si éphémère (géré côté socket)
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
