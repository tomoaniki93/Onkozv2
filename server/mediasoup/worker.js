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
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
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
async function produce(roomId, peerId, transportId, kind, rtpParameters, appData) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');
  const transport = room.transports.get(transportId);
  if (!transport) throw new Error('Transport introuvable');

  const producer = await transport.produce({ kind, rtpParameters, appData: appData || {} });

  // Stocker dans une Map par peerId → Map<producerId → {producer, kind, appData}>
  if (!room.producers.has(peerId)) room.producers.set(peerId, new Map());
  room.producers.get(peerId).set(producer.id, { producer, kind, appData: appData || {} });

  producer.on('transportclose', () => {
    room.producers.get(peerId)?.delete(producer.id);
    if (room.producers.get(peerId)?.size === 0) room.producers.delete(peerId);
  });

  return producer.id;
}

// ── Consume ───────────────────────────────────────────────────────────────────
async function consume(roomId, consumerPeerId, producerPeerId, transportId, rtpCapabilities, producerId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Salle introuvable');

  const peerProducers = room.producers.get(producerPeerId);
  if (!peerProducers || peerProducers.size === 0) throw new Error('Producteur introuvable');

  // Chercher par producerId exact, sinon prendre le premier
  let entry = producerId ? peerProducers.get(producerId) : peerProducers.values().next().value;
  if (!entry) throw new Error('Producteur introuvable');
  const producer = entry.producer;

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
    appData:       entry.appData || {},
  };
}

// ── Peer quitte la salle ──────────────────────────────────────────────────────
function peerLeft(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Fermer tous les producers du peer (audio + screen)
  const peerProducers = room.producers.get(peerId);
  if (peerProducers) {
    for (const { producer } of peerProducers.values()) {
      try { producer.close(); } catch {}
    }
    room.producers.delete(peerId);
  }

  // Retirer le peer et ses transports
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

// ── Lister tous les producers actifs dans une salle ───────────────────────────
// Utilisé pour envoyer les producers existants à un peer qui rejoint
function getExistingProducers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const result = [];
  for (const [peerId, producerMap] of room.producers.entries()) {
    for (const [producerId, { kind, appData }] of producerMap.entries()) {
      const peer = room.peers.get(peerId);
      result.push({ peerId, producerId, kind, appData, username: peer?.username || '' });
    }
  }
  return result;
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
  getExistingProducers,
  rooms,
};
