# ONKOZ Desktop — Application Windows

Application desktop Electron qui charge `https://onkoz.fr` dans une fenêtre native.

---

## Prérequis

- [Node.js](https://nodejs.org) v18 ou supérieur
- npm (inclus avec Node.js)

---

## Installation & Développement

```bash
npm install
npm start        # mode développement
```

---

## Construire & Publier une nouvelle version

### 1. Incrémenter la version dans package.json
```json
"version": "1.1.0"
```

### 2. Builder
```bash
npm run build:win
# Génère dist/ONKOZ Setup 1.1.0.exe  +  dist/latest.yml
```

### 3. Déployer sur le VPS
```bash
# Sur le VPS, ajouter dans nginx.conf le bloc /updates/ (voir nginx-updates.conf)
# puis :
mkdir -p /opt/onkoz/client/updates
# Copier les fichiers dist/*.exe et dist/latest.yml dans ce dossier
scp dist/*.exe dist/latest.yml root@51.255.194.141:/opt/onkoz/client/updates/
nginx -s reload
```

Les utilisateurs verront automatiquement la mise à jour disponible dans la titlebar.

---

## Fonctionnement de la mise à jour

```
Démarrage app
     ↓ (3 secondes)
Vérifie https://onkoz.fr/updates/latest.yml
     ↓ nouvelle version trouvée
Téléchargement silencieux en arrière-plan
     ↓ barre de progression dans la titlebar (orange)
Téléchargement terminé
     ↓ badge vert "✅ v1.1.0 prête — Cliquer pour redémarrer"
Clic utilisateur → redémarre et installe
```

- **Téléchargement silencieux** — l'utilisateur n'est pas interrompu
- **Barre de progression** dans la titlebar (couleur orange)
- **Badge vert** quand prête → clic pour redémarrer
- **Bulle systray** à chaque étape
- **Installation au prochain arrêt** si l'utilisateur ne clique pas

---

## Structure

```
onkoz-desktop/
├── main.js               ← Processus principal + auto-updater
├── preload.js            ← Bridge IPC sécurisé
├── titlebar.html         ← Barre de titre + badge mise à jour
├── package.json          ← Config + electron-builder
├── deploy-update.sh      ← Script de déploiement VPS
├── nginx-updates.conf    ← Config nginx à ajouter sur le VPS
└── assets/
    ├── icon.png
    └── logo.png
```
