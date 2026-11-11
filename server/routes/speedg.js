'use strict';

/* ── Jeu SpeedG intégré à ONKOZ ──────────────────────────────────────────────
   Sert la page du jeu (fichier unique jeux/speedg/index.html) et sa musique
   (jeux/speedg/audio/*.ogg), comme Zero-Gravity sert ses pages.

   Pas d'API ici : les records sont gardés dans le navigateur du joueur, et le
   mode en ligne passe par Socket.IO (server/socket/speedg.js).
   ─────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const path    = require('path');

const router   = express.Router();
const GAME_DIR = path.join(__dirname, '..', '..', 'jeux', 'speedg');

router.use(express.static(GAME_DIR, {
  index: 'index.html',
  dotfiles: 'ignore',
  setHeaders: (res, file) => {
    // La page se met à jour dès qu'on la remplace ; la musique, elle, ne change pas.
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else if (file.endsWith('.ogg')) res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));
// Jamais de repli sur l'app ONKOZ ici : une page ou une musique manquante ne
// doit pas charger ONKOZ entier dans l'iframe du jeu.
router.use((req, res) => res.status(404).type('text/plain').send('Introuvable'));

module.exports = router;
