# ONKOZ Desktop — Application Windows

Application desktop Electron qui charge `https://onkoz.fr` dans une fenêtre native.

---

## Prérequis

- [Node.js](https://nodejs.org) v18 ou supérieur
- npm (inclus avec Node.js)

---

## Installation & Développement

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm start
```

---

## Construire le .exe Windows

```bash
# Générer l'installateur NSIS (.exe) pour Windows x64
npm run build:win
```

Le fichier `.exe` sera dans le dossier `dist/`.

> **Note** : Si tu compiles sur Windows, aucune dépendance supplémentaire n'est nécessaire.
> Si tu compiles sur Linux/macOS pour Windows, `wine` et `mono` sont requis.

---

## Fonctionnalités

- ✅ Fenêtre frameless avec barre de titre custom ONKOZ
- ✅ Boutons Réduire / Agrandir / Fermer
- ✅ Fermer → réduit dans la barre des tâches (systray)
- ✅ Double-clic sur l'icône systray → restaure la fenêtre
- ✅ Bouton Recharger dans la titlebar
- ✅ Reconnexion automatique si le serveur est temporairement inaccessible
- ✅ Permissions micro, partage d'écran et notifications accordées automatiquement
- ✅ Liens externes ouverts dans le navigateur par défaut

---

## Structure

```
onkoz-desktop/
├── main.js          ← Processus principal Electron
├── preload.js       ← Bridge IPC sécurisé
├── titlebar.html    ← Barre de titre custom
├── package.json     ← Config + electron-builder
└── assets/
    ├── icon.png     ← Icône app (512x512 recommandé)
    └── logo.png
```
