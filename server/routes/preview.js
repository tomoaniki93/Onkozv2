'use strict';
/* ── /server/routes/preview.js ────────────────────────────────────────────────
   GET /api/preview?url=https://...
   Récupère les métadonnées Open Graph d'une URL pour afficher une prévisualisation.
   Protection SSRF : l'IP réellement contactée est validée (anti-rebinding),
   redirections re-validées à chaque saut, taille de réponse plafonnée.
   ─────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const dns     = require('dns');
const http    = require('http');
const https   = require('https');
const { requireAuth } = require('../middleware/auth');

const router  = express.Router();

// Cache simple en mémoire (url → preview, TTL 30min)
const cache   = new Map();
const CACHE_TTL = 30 * 60 * 1000;

// ── Protection SSRF ───────────────────────────────────────────────────────────
// Le domaine public reboucle vers l'app via nginx → on l'interdit, ainsi que
// l'IP publique du VPS (pour empêcher un contournement en visant l'IP directement).
const DOMAIN = (process.env.DOMAIN || 'onkoz.fr').toLowerCase();
const BLOCKED_HOSTNAMES = ['localhost', DOMAIN, 'www.' + DOMAIN];
const SELF_IPS = new Set(
  [process.env.MEDIASOUP_ANNOUNCED_IP, process.env.PUBLIC_IP]
    .filter(ip => ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
);

// Vrai si l'IP appartient à une plage privée / réservée / de bouclage
function isPrivateIp(ip) {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) ip = v4[1];
  if (SELF_IPS.has(ip)) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const p = ip.split('.').map(Number);
    if (p.some(n => n > 255)) return true;             // malformé → bloquer
    const a = p[0], b = p[1];
    if (a === 0 || a === 127) return true;             // 0.0.0.0/8, loopback
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 169 && b === 254) return true;           // link-local / métadonnées cloud
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                         // multicast / réservé
    return false;
  }

  const l = ip.toLowerCase();
  if (l === '::1' || l === '::') return true;          // loopback / non spécifié
  if (l.startsWith('fe80')) return true;               // link-local IPv6
  if (l.startsWith('fc') || l.startsWith('fd')) return true; // ULA fc00::/7
  if (l.startsWith('ff')) return true;                 // multicast IPv6
  return false;
}

// Contrôle synchrone : protocole + politique de domaine + IP littérale
function isBlockedUrl(u) {
  try {
    const url = (u instanceof URL) ? u : new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.some(b => host === b || host.endsWith('.' + b))) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
      if (isPrivateIp(host)) return true;
    }
    return false;
  } catch { return true; }
}

// Résolution DNS validante : on vérifie l'IP EXACTE à laquelle on va se connecter.
// Gère les deux formes du callback (all:false → adresse unique, all:true → tableau,
// utilisé par autoSelectFamily de Node 20+). Toute IP privée/réservée est écartée.
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    if (Array.isArray(address)) {
      const safe = address.filter(a => !isPrivateIp(a.address));
      if (safe.length === 0) return cb(new Error('Adresse IP non autorisée (SSRF)'));
      return cb(null, safe);
    }
    if (isPrivateIp(address)) return cb(new Error('Adresse IP non autorisée (SSRF)'));
    cb(null, address, family);
  });
}

// GET sûr : redirections re-validées à chaque saut, corps plafonné
function safeFetch(startUrl, opts = {}) {
  const timeout      = opts.timeout      || 6000;
  const maxBytes     = opts.maxBytes     || 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects || 4;

  return new Promise((resolve, reject) => {
    let redirects = 0, settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };

    function go(urlStr) {
      let u;
      try { u = new URL(urlStr); } catch { return done(reject, new Error('URL invalide')); }
      if (isBlockedUrl(u)) return done(reject, new Error('URL non autorisée'));

      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, {
        method: 'GET',
        lookup: safeLookup,
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ONKOZ/1.0; +https://' + DOMAIN + ')',
          'Accept': 'text/html,application/xhtml+xml,image/*,*/*;q=0.8',
        },
      }, (res) => {
        const status = res.statusCode || 0;

        // Redirection → on re-valide la cible avant de suivre
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= maxRedirects) return done(reject, new Error('Trop de redirections'));
          redirects++;
          let next;
          try { next = new URL(res.headers.location, u).href; }
          catch { return done(reject, new Error('Redirection invalide')); }
          return go(next);
        }

        const contentType = (res.headers['content-type'] || '').toLowerCase();
        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          if (settled) return;
          total += c.length;
          chunks.push(c);
          if (total > maxBytes) {                 // plafond atteint → on coupe
            req.destroy();
            done(resolve, { url: u.href, status, contentType, body: Buffer.concat(chunks).toString('utf8') });
          }
        });
        res.on('end',   () => done(resolve, { url: u.href, status, contentType, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => done(reject, e));
      });

      req.on('timeout', () => req.destroy(new Error('Timeout')));
      req.on('error',   (e) => done(reject, e));
      req.end();
    }

    go(startUrl);
  });
}

// ── Extraction YouTube via oEmbed ─────────────────────────────────────────────
async function fetchYouTube(url) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();

  // Extraire l'ID pour la vignette HD
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const thumb = match
    ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`
    : data.thumbnail_url;

  return {
    title:       data.title,
    description: `Par ${data.author_name}`,
    image:       thumb,
    siteName:    'YouTube',
    favicon:     'https://www.youtube.com/favicon.ico',
    type:        'video',
    videoId:     match?.[1] || null,
    url,
  };
}

// ── Extraction Open Graph générique ──────────────────────────────────────────
function extractOG(html, baseUrl) {
  const get = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
           || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
    return m ? m[1].trim() : null;
  };

  const title = get('og:title')
    || html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim()
    || null;

  const description = get('og:description') || get('description') || null;
  const image       = get('og:image') || get('twitter:image') || null;
  const siteName    = get('og:site_name') || new URL(baseUrl).hostname.replace('www.', '');
  const type        = get('og:type') || 'website';

  // Résoudre les URLs relatives
  let resolvedImage = image;
  if (image && !image.startsWith('http')) {
    try {
      resolvedImage = new URL(image, baseUrl).href;
    } catch { resolvedImage = null; }
  }

  // Favicon
  const faviconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i);
  let favicon = faviconMatch?.[1];
  if (favicon && !favicon.startsWith('http')) {
    try { favicon = new URL(favicon, baseUrl).href; } catch { favicon = null; }
  }
  if (!favicon) favicon = `${new URL(baseUrl).origin}/favicon.ico`;

  return title ? { title, description, image: resolvedImage, siteName, type, favicon, url: baseUrl } : null;
}

// ── Route principale ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url manquante' });
  if (isBlockedUrl(url)) return res.status(403).json({ error: 'URL non autorisée' });

  // Cache hit
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    let data = null;

    // YouTube (hôte fixe, pas de risque SSRF côté serveur)
    if (/youtube\.com\/watch|youtu\.be\//.test(url)) {
      data = await fetchYouTube(url);
    }

    // Fallback générique Open Graph (fetch validé anti-SSRF)
    if (!data) {
      const r = await safeFetch(url);

      if (r.contentType.startsWith('image/')) {
        data = { title: null, image: url, type: 'image', url, siteName: new URL(url).hostname };
      } else if (r.contentType.includes('text/html')) {
        data = extractOG(r.body, r.url || url);
      }
    }

    if (!data) return res.status(204).end();

    // Mettre en cache
    cache.set(url, { data, ts: Date.now() });
    // Nettoyage cache si trop grand
    if (cache.size > 500) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      cache.delete(oldest[0]);
    }

    res.json(data);
  } catch (err) {
    // Timeout, SSRF bloquée ou erreur réseau → pas de preview, ne pas bloquer l'UX
    res.status(204).end();
  }
});

module.exports = router;
