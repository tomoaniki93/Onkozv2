# 🎤 ONKOZ — Voice & Chat Platform

> Plateforme de communication vocale et textuelle temps réel — auto-hébergée, sans dépendance cloud

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![mediasoup](https://img.shields.io/badge/mediasoup-3.x-7B5CE5)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-F5A623)
![Responsive](https://img.shields.io/badge/UI-Mobile--first-4FD17A)

---

## ✨ Fonctionnalités

### 💬 Chat textuel
- Messages en temps réel par salon, avec historique persistant
- **Messages privés (DM)** — historique 7 jours, badges non lus
- **Réactions emoji** sur les messages
- **Partage d'images** dans le chat (JPG, PNG, GIF, WEBP — max 10 Mo) avec lightbox
- **Messages épinglés** par canal (mod/admin)
- **Aperçus de liens** automatiques — Open Graph + oEmbed YouTube (miniature + titre)
- Suppression de messages (mod/admin)

### 🔊 Vocal
- **WebRTC SFU** via mediasoup — 30–50+ personnes par salon sans dégradation
- **Présence vocale sidebar** — mini-avatars des membres affichés en temps réel sous chaque canal vocal
- **Partage d'écran** avec aperçu local (overlay fullscreen) et vue spectateur multi-pairs
- **Salons éphémères** — créés à la demande, disparaissent quand le dernier membre part (option : salon texte lié)
- **Panneau vocal persistant** dans la sidebar pendant toute la session (mute / screen / quitter)
- Indicateurs **speaking** (bordure verte animée) sur les cartes pairs

### 🎙️ Traitement audio
- **Pipeline complet** appliqué systématiquement avant mediasoup :
  ```
  Microphone → HighPassFilter → LowPassFilter → DynamicsCompressor → NoiseGate (AudioWorklet) → mediasoup
  ```
- **RNNoise WASM** optionnel — suppression de bruit par réseau de neurones (IA)
- **Loopback micro** avec délai réglable pour test en conditions réelles
- NoiseGate paramétrique : seuil, attack, release configurables dans les paramètres audio
- Le stream `processedStream` (traité) est **toujours** envoyé à mediasoup — jamais le stream brut

### 🎨 Interface
- **Thème sombre profond** — palette `#080710 / #0D0C18`, accent violet `#7B5CE5`
- **Typographie** — DM Sans (corps) · Syne (titres) · JetBrains Mono (éléments mono)
- **Entièrement responsive** — Mobile, Tablette, Desktop (voir section dédiée)
- **Catégories de canaux** avec collapse, boutons d'administration au survol
- **Système de rôles** visuel : 🔴 Admin · 🟢 Modérateur · 🟡 Utilisateur
- **Profils utilisateurs** — avatar personnalisé (upload), statut personnalisé, popup profil
- **Modération** — kick, changement de rôle, suppression de message, suppression de compte

### 🔒 Sécurité
- **Rate limiting** sur toutes les routes d'authentification (express-rate-limit)
- **Protection SSRF** sur les aperçus de liens (blocage IPs privées / RFC1918)
- Authentification **JWT** sur toutes les routes API et connexions Socket.io
- Bypass admin configurable pour les routes de modération

---

## 📱 Responsive — 3 breakpoints

| Écran | Layout |
|---|---|
| **Desktop > 900px** | 3 colonnes : sidebar canaux · zone centrale · panel membres |
| **Tablette ≤ 900px** | Sidebar réduite (200px) · panel membres en overlay flottant |
| **Mobile ≤ 640px** | Sidebar drawer · topbar native · bottom nav 4 onglets |

### Mobile en détail
- **Drawer sidebar** — swipe depuis le bord gauche (`< 24px → dx > 56px`), bouton hamburger, fermeture par `Escape` ou tap overlay
- **Topbar** — affiche l'icône et le nom du canal actif, bouton membres
- **Bottom nav** — 4 onglets : Canaux · Chat · Vocal · Membres
- Le panneau "Voix connectée" remonte au-dessus de la bottom nav
- Scroll-bar réduite à 2px, paddings adaptés

---

## 🗂️ Structure

```
onkoz/
├── package.json
├── tailwind.config.js           Thème couleurs · polices DM Sans/Syne/JetBrains · responsive
├── .env.example
├── Installation.md
├── README.md
│
├── server/
│   ├── index.js                 Express + Socket.io + bootstrap
│   │
│   ├── db/
│   │   ├── schema.sql           Tables : users, categories, channels, messages, reactions, pins, DMs
│   │   ├── database.js          Init DB, helpers, purge DMs > 7 jours
│   │   └── migrate.js           Migrations incrémentales
│   │
│   ├── middleware/
│   │   └── auth.js              JWT : signToken, requireAuth, requireRole, verifySocketToken
│   │
│   ├── routes/
│   │   ├── auth.js              setup / register / login — rate limiting
│   │   ├── categories.js        CRUD catégories de canaux (admin)
│   │   ├── channels.js          CRUD canaux, messages, réactions, pins
│   │   ├── users.js             Liste, rôles, DM, kick, suppression
│   │   ├── preview.js           Aperçus Open Graph / oEmbed — protection SSRF
│   │   └── upload.js            Upload images (multer), resize, stockage local
│   │
│   ├── mediasoup/
│   │   └── worker.js            Workers, rooms, transports, producers audio+video (VP8/H264), consumers
│   │
│   └── socket/
│       └── handlers.js          Tous les événements Socket.io
│
├── client/
│   ├── index.html               SPA — layout flex responsive, topbar mobile, bottom nav
│   │
│   ├── assets/
│   │   ├── icon.png             Icône (favicon + sidebar)
│   │   └── logo.png             Logo full (auth screen + welcome)
│   │
│   ├── css/
│   │   ├── input.css            Source Tailwind + composants custom + responsive CSS
│   │   └── style.css            CSS compilé (généré par npm run build:css)
│   │
│   └── js/
│       ├── api.js               Wrapper fetch REST
│       ├── auth.js              Login / register / setup — session JWT
│       ├── ui.js                Avatars, modal, sidebar membres, menus contextuels
│       ├── app.js               Orchestrateur — socket events, navigation, présence, responsive
│       ├── voice.js             Client mediasoup — WebRTC, micro, screen share, consumers
│       ├── chat.js              Messages, DM, réactions, pins, aperçus liens, images
│       ├── noise-reducer.js     Pipeline audio : HighPass → LowPass → Compressor → NoiseGate
│       ├── noise-gate-processor.js   AudioWorklet — gate paramétrique
│       ├── rnnoise-processor.js      AudioWorklet — débruitage RNNoise WASM
│       ├── rnnoise-sync.js           Loader synchrone WASM
│       ├── audio-settings.js    Interface paramètres audio (seuils, loopback, test micro)
│       ├── profile.js           Profils, avatar upload, statut, popup
│       └── emoji-picker.js      Sélecteur emoji
│
└── nginx/
    ├── onkoz.conf               Reverse proxy HTTPS, WebSocket, SSL
    └── onkoz.service            Unité systemd
```

---

## 🔌 API REST

### Auth
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/setup` | Créer le premier compte admin |
| POST | `/api/auth/register` | S'inscrire |
| POST | `/api/auth/login` | Se connecter |
| GET  | `/api/auth/me` | Profil courant |
| GET  | `/api/auth/check-username/:name` | Vérifier disponibilité pseudo |

### Catégories
| Méthode | Route | Description |
|---|---|---|
| GET    | `/api/categories` | Catégories + canaux |
| POST   | `/api/categories` | Créer catégorie (admin) |
| PATCH  | `/api/categories/:id` | Renommer (admin) |
| DELETE | `/api/categories/:id` | Supprimer (admin) |

### Canaux & Messages
| Méthode | Route | Description |
|---|---|---|
| GET    | `/api/channels` | Liste canaux |
| POST   | `/api/channels` | Créer un canal (admin) |
| DELETE | `/api/channels/:id` | Supprimer un canal (admin) |
| GET    | `/api/channels/:id/messages` | Historique messages |
| POST   | `/api/channels/:id/messages/:msgId/react` | Ajouter/retirer réaction |
| POST   | `/api/channels/:id/messages/:msgId/pin` | Épingler (mod) |
| DELETE | `/api/channels/:id/messages/:msgId/pin` | Désépingler (mod) |
| GET    | `/api/channels/:id/pins` | Messages épinglés |

### Upload & Preview
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/upload/image` | Upload image (max 10 Mo) |
| GET  | `/api/preview?url=…` | Aperçu Open Graph / oEmbed |

### Users & DM
| Méthode | Route | Description |
|---|---|---|
| GET    | `/api/users` | Liste des utilisateurs |
| PATCH  | `/api/users/:id/role` | Changer le rôle (admin) |
| DELETE | `/api/users/:id` | Supprimer un compte (admin) |
| GET    | `/api/users/dm/conversations` | Mes conversations DM |
| GET    | `/api/users/dm/:partnerId` | Historique DM |
| GET    | `/api/users/dm/unread/count` | DM non lus |

---

## ⚡ Événements Socket.io

### Chat texte
| Événement | Direction | Description |
|---|---|---|
| `chat:join` | client→server | Rejoindre un salon texte |
| `chat:leave` | client→server | Quitter un salon texte |
| `chat:message` | bidirectionnel | Envoyer / recevoir un message (texte ou image) |
| `chat:delete` | client→server | Supprimer un message (mod/admin) |
| `chat:deleted` | server→client | Notification suppression |
| `chat:pinned` | server→client | Message épinglé |
| `chat:unpinned` | server→client | Message désépinglé |
| `reaction:update` | server→broadcast | Mise à jour des réactions |
| `text:viewers` | server→broadcast | Présence texte (liste des viewers) |

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
| `voice:peer:joined` | server→client | Nouveau pair |
| `voice:peer:left` | server→client | Pair parti |
| `voice:peers` | server→client | Pairs existants à la connexion |
| `voice:members` | server→broadcast | Membres connectés → mise à jour avatars sidebar |
| `screen:started` | server→broadcast | Début partage d'écran |
| `screen:stopped` | server→broadcast | Fin partage d'écran |

### Mediasoup SFU
| Événement | Description |
|---|---|
| `ms:getRouterCapabilities` | RTP capabilities du routeur |
| `ms:createTransport` | Créer transport WebRTC (send/recv) |
| `ms:connectTransport` | Connecter transport (DTLS) |
| `ms:produce` | Publier flux audio ou vidéo (screen) |
| `ms:consume` | Consommer flux d'un pair |
| `ms:newProducer` | Nouveau producteur disponible |
| `ms:producerClosed` | Producteur fermé |

### Éphémère
| Événement | Direction | Description |
|---|---|---|
| `ephemeral:create` | client→server | Créer salon éphémère |
| `ephemeral:join` | client→server | Rejoindre salon éphémère |
| `ephemeral:leave` | client→server | Quitter salon éphémère |
| `ephemeral:message` | bidirectionnel | Message texte éphémère |
| `ephemeral:list` | server→broadcast | Liste des salons éphémères actifs |
| `ephemeral:created` | server→client | Confirmation création |

---

## 🎙️ Pipeline Audio

```
Microphone (getUserMedia)
        │
        ▼
NoiseReducer.process()
  ├─ HighPassFilter     (80–120 Hz)    — supprime rumbles, vibrations de bureau
  ├─ LowPassFilter      (5500–7500 Hz) — supprime sifflements haute fréquence
  ├─ DynamicsCompressor                — lisse les pics de volume
  ├─ NoiseGate (AudioWorklet)          — coupe le signal sous le seuil configurable
  └─ [RNNoise WASM optionnel]          — débruitage par réseau de neurones
        │
        ▼
processedStream.getAudioTracks()[0]
        │
        ▼
mediasoup sendTransport.produce()
        │
        ▼
SFU → tous les pairs
```

> **Important** : `processedStream` (traité) est **toujours** utilisé pour mediasoup. Le `localStream` brut n'est jamais envoyé directement.

---

## 🛡️ Rôles & Permissions

| Action | Utilisateur | Modérateur | Admin |
|---|:---:|:---:|:---:|
| Chat texte & vocal | ✅ | ✅ | ✅ |
| Messages privés | ✅ | ✅ | ✅ |
| Réactions & images | ✅ | ✅ | ✅ |
| Créer salon éphémère | ✅ | ✅ | ✅ |
| Supprimer des messages | ❌ | ✅ | ✅ |
| Épingler des messages | ❌ | ✅ | ✅ |
| Expulser un utilisateur | ❌ | ✅ | ✅ |
| Créer / Supprimer catégories & canaux | ❌ | ❌ | ✅ |
| Changer les rôles | ❌ | ❌ | ✅ |
| Supprimer des comptes | ❌ | ❌ | ✅ |

---

## 🖥️ Stack Technique

| Composant | Technologie |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework HTTP | Express 4 |
| Temps réel | Socket.io 4 |
| WebRTC SFU | mediasoup 3 (VP8 + H264 + Opus) |
| Base de données | SQLite (better-sqlite3) |
| Authentification | JWT + bcryptjs |
| CSS Framework | Tailwind CSS 3 (thème custom) |
| Polices | DM Sans · Syne · JetBrains Mono (Google Fonts) |
| Frontend | Vanilla JS modulaire (aucun framework) |
| Audio | Web Audio API · AudioWorklet · RNNoise WASM |
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
JWT_SECRET=<openssl rand -hex 32>
DB_PATH=./data/onkoz.db
MEDIASOUP_ANNOUNCED_IP=<IP PUBLIQUE VPS>
RTC_MIN_PORT=40000
RTC_MAX_PORT=49999
MEDIASOUP_NUM_WORKERS=4
```

---

## 🚀 Déploiement

```bash
# 1. Dépendances
npm install

# 2. Compiler le CSS Tailwind
npm run build:css

# 3. Configurer l'environnement
cp .env.example .env && nano .env

# 4. Lancer
node server/index.js

# Ou via systemd (production)
cp nginx/onkoz.service /etc/systemd/system/
systemctl enable --now onkoz
```

Voir [`Installation.md`](./Installation.md) pour le guide complet avec Nginx + SSL + certbot.

---

## 📊 Performances

| Ressource | Recommandé | VPS testé |
|---|---|---|
| vCores | 4+ | 6 ✅ |
| RAM | 4+ Go | 12 Go ✅ |
| SSD | 20+ Go | 100 Go ✅ |
| Bande passante | 100 Mbit/s | 1 Gbit/s ✅ |

Avec cette configuration : **150–200 utilisateurs simultanés**, plusieurs salons vocaux avec 30–50 personnes chacun.
