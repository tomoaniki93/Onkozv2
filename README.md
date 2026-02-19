# 🎤 ONKOZ — Voice & Chat Platform

> Plateforme de communication vocale et textuelle en temps réel — Discord-like dark mode

![Stack](https://img.shields.io/badge/Node.js-20-green) ![mediasoup](https://img.shields.io/badge/mediasoup-3.x-purple) ![SQLite](https://img.shields.io/badge/SQLite-3-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Fonctionnalités

- **Chat vocal WebRTC SFU** via mediasoup — 30-50+ personnes par salon
- **Chat textuel** temps réel par salon, avec historique
- **Messages privés (DM)** — historique 7 jours, badges non lus
- **Salons éphémères** — disparaissent quand le dernier membre part
- **Système de rôles** : 🔴 Admin, 🟢 Modérateur, 🟡 Utilisateur
- **Pseudo définitif** choisi à l'inscription
- **Interface Discord-like** dark mode
- **Modération** : kick, suppression de messages, changement de rôle

---

## 🗂️ Structure des fichiers

```
onkoz/
├── package.json                  Dépendances Node.js et scripts npm
├── .env.example                  Template des variables d'environnement
├── Installation.md               Guide d'installation complet (ce doc)
├── README.md                     Ce fichier
│
├── server/                       ── BACKEND ──
│   ├── index.js                  Point d'entrée : Express + Socket.io + démarrage
│   │
│   ├── db/
│   │   ├── schema.sql            Schéma SQLite (tables users, channels, messages, DMs)
│   │   └── database.js           Init DB, helpers, nettoyage DMs > 7 jours
│   │
│   ├── middleware/
│   │   └── auth.js               JWT : signToken, requireAuth, requireRole, verifySocketToken
│   │
│   ├── routes/
│   │   ├── auth.js               POST /api/auth/setup|register|login — GET /api/auth/me
│   │   ├── channels.js           GET/POST/DELETE /api/channels — GET /api/channels/:id/messages
│   │   └── users.js              GET /api/users — PATCH/DELETE rôles — GET DM conversations & historique
│   │
│   ├── mediasoup/
│   │   └── worker.js             Workers mediasoup, gestion des rooms/transports/producers/consumers
│   │
│   └── socket/
│       └── handlers.js           Tous les événements Socket.io (chat, DM, voice, ephemeral, modération)
│
├── client/                       ── FRONTEND ──
│   ├── index.html                Page unique SPA (structure HTML complète)
│   │
│   ├── css/
│   │   └── style.css             Thème dark mode Discord-like, variables CSS, composants UI
│   │
│   └── js/
│       ├── api.js                Wrapper fetch vers l'API REST (auth, channels, users, DM)
│       ├── auth.js               Gestion écran login/register/setup, session JWT
│       ├── ui.js                 Utilitaires UI : avatars, modal, sidebar utilisateurs
│       ├── voice.js              Client mediasoup : WebRTC, micro, consommation audio pairs
│       ├── chat.js               Messages texte (salons + DM), rendu, envoi
│       └── app.js                Orchestrateur : init, socket events, navigation, modération
│
└── nginx/
    ├── onkoz.conf                Config Nginx (reverse proxy HTTPS, WebSocket, SSL)
    └── onkoz.service             Unité systemd pour démarrage automatique
```

---

## 🔌 API REST

### Auth
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/setup` | Créer le premier compte admin |
| POST | `/api/auth/register` | S'inscrire (pseudo + mdp) |
| POST | `/api/auth/login` | Se connecter |
| GET | `/api/auth/me` | Profil courant (auth) |
| GET | `/api/auth/check-username/:name` | Vérifier dispo pseudo |

### Channels
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/channels` | Liste de tous les salons |
| POST | `/api/channels` | Créer un salon (admin) |
| DELETE | `/api/channels/:id` | Supprimer un salon (admin) |
| GET | `/api/channels/:id/messages` | Historique messages texte |

### Users & DM
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/users` | Liste des utilisateurs |
| PATCH | `/api/users/:id/role` | Changer le rôle (admin) |
| DELETE | `/api/users/:id` | Supprimer un compte (admin) |
| GET | `/api/users/dm/conversations` | Mes conversations DM |
| GET | `/api/users/dm/:partnerId` | Historique DM avec un utilisateur |
| GET | `/api/users/dm/unread/count` | Nombre de DM non lus |

---

## ⚡ Événements Socket.io

### Chat texte
| Événement | Direction | Description |
|---|---|---|
| `chat:join` | client→server | Rejoindre un salon texte |
| `chat:leave` | client→server | Quitter un salon texte |
| `chat:message` | bidirectionnel | Envoyer/recevoir un message |
| `chat:delete` | client→server | Supprimer un message (mod/admin) |
| `chat:deleted` | server→client | Notification suppression |

### DM
| Événement | Direction | Description |
|---|---|---|
| `dm:send` | client→server | Envoyer un DM |
| `dm:message` | server→client | Recevoir un DM |

### Vocal
| Événement | Direction | Description |
|---|---|---|
| `voice:join` | client→server | Rejoindre salon vocal permanent |
| `voice:leave` | client→server | Quitter salon vocal |
| `voice:peer:joined` | server→client | Nouveau pair dans la salle |
| `voice:peer:left` | server→client | Pair parti |
| `voice:peers` | server→client | Liste des pairs existants |
| `voice:members` | server→broadcast | Mise à jour compteur membres |

### Mediasoup (SFU signaling)
| Événement | Description |
|---|---|
| `ms:getRouterCapabilities` | RTP capabilities du routeur |
| `ms:createTransport` | Créer transport WebRTC |
| `ms:connectTransport` | Connecter transport (DTLS) |
| `ms:produce` | Publier flux audio |
| `ms:consume` | Consommer flux d'un pair |
| `ms:newProducer` | Notification nouveau producteur |

### Éphémère
| Événement | Direction | Description |
|---|---|---|
| `ephemeral:create` | client→server | Créer salon éphémère |
| `ephemeral:join` | client→server | Rejoindre salon éphémère |
| `ephemeral:leave` | client→server | Quitter salon éphémère |
| `ephemeral:message` | bidirectionnel | Message texte éphémère |
| `ephemeral:list` | server→broadcast | Liste des salons éphémères |
| `ephemeral:created` | server→client | Confirmation création |

---

## 🛡️ Rôles & Permissions

| Action | Utilisateur | Modérateur | Admin |
|---|:---:|:---:|:---:|
| Chat texte & vocal | ✅ | ✅ | ✅ |
| Messages privés | ✅ | ✅ | ✅ |
| Créer salon éphémère | ✅ | ✅ | ✅ |
| Supprimer des messages | ❌ | ✅ | ✅ |
| Expulser un utilisateur | ❌ | ✅ | ✅ |
| Créer/Supprimer salons | ❌ | ❌ | ✅ |
| Changer les rôles | ❌ | ❌ | ✅ |
| Supprimer des comptes | ❌ | ❌ | ✅ |

---

## 🖥️ Stack Technique

| Composant | Technologie |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework HTTP | Express 4 |
| Temps réel | Socket.io 4 |
| WebRTC SFU | mediasoup 3 |
| Base de données | SQLite (better-sqlite3) |
| Authentification | JWT (jsonwebtoken) + bcryptjs |
| Frontend | Vanilla JS + CSS (pas de framework) |
| Client WebRTC | mediasoup-client (CDN) |
| Reverse Proxy | Nginx |
| Process Manager | systemd |
| SSL | Let's Encrypt (certbot) |

---

## ⚙️ Variables d'environnement

Voir `.env.example` pour la liste complète.

```env
PORT=3000
DOMAIN=onkoz.fr
JWT_SECRET=<générer avec: openssl rand -hex 32>
DB_PATH=./data/onkoz.db
MEDIASOUP_ANNOUNCED_IP=<IP PUBLIQUE DE VOTRE VPS>
RTC_MIN_PORT=40000
RTC_MAX_PORT=49999
MEDIASOUP_NUM_WORKERS=4
```

---

## 📊 Performances VPS OVH

| Ressource | Recommandé | Votre VPS |
|---|---|---|
| vCores | 4+ | 6 ✅ |
| RAM | 4+ Go | 12 Go ✅ |
| SSD | 20+ Go | 100 Go ✅ |
| Bande passante | 100 Mbit/s | 1 Gbit/s ✅ |

Avec cette configuration, ONKOZ peut supporter **150-200 utilisateurs simultanés** et **plusieurs salons vocaux** avec 30-50 personnes chacun.
