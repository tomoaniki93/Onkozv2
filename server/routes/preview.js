'use strict';
/* ── /server/routes/preview.js ────────────────────────────────────────────────
   GET /api/preview?url=https://...
   Récupère les métadonnées Open Graph d'une URL pour afficher une prévisualisation.
   ─────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router  = express.Router();

// Cache simple en mémoire (url → preview, TTL 30min)
const cache   = new Map();
const CACHE_TTL = 30 * 60 * 1000;

// Domaines et IPs bloqués (SSRF protection)
const BLOCKED_HOSTNAMES = ['localhost', 'onkoz.fr'];
const BLOCKED_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|::1|fc00:|fe80:)/;

function isBlocked(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return true;
    if (BLOCKED_HOSTNAMES.some(b => hostname === b || hostname.endsWith('.' + b))) return true;
    if (BLOCKED_IP_RE.test(hostname)) return true;
    return false;
  } catch { return true; }
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
  if (isBlocked(url)) return res.status(403).json({ error: 'URL non autorisée' });

  // Cache hit
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    let data = null;

    // YouTube
    if (/youtube\.com\/watch|youtu\.be\//.test(url)) {
      data = await fetchYouTube(url);
    }

    // Fallback générique Open Graph
    if (!data) {
      const fetchRes = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ONKOZ/1.0; +https://onkoz.fr)',
          'Accept': 'text/html',
        },
        redirect: 'follow',
      });

      const contentType = fetchRes.headers.get('content-type') || '';

      // Si c'est une image directe
      if (contentType.startsWith('image/')) {
        data = { title: null, image: url, type: 'image', url, siteName: new URL(url).hostname };
      } else if (contentType.includes('text/html')) {
        const html = await fetchRes.text();
        data = extractOG(html, fetchRes.url || url);
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
    // Timeout ou erreur réseau → pas de preview, ne pas bloquer
    res.status(204).end();
  }
});

module.exports = router;
