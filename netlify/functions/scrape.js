'use strict';

// ─────────────────────────────────────────────────────────────
// Barrios conocidos
// ─────────────────────────────────────────────────────────────
const BARRIOS = [
  'Puerto Madero','Palermo Hollywood','Palermo Soho','Palermo',
  'Recoleta','Belgrano','Núñez','Colegiales','Villa Crespo',
  'San Telmo','Almagro','Caballito','Flores','Barracas','La Boca',
];

function findBarrio(text) {
  const low = text.toLowerCase();
  return BARRIOS.find(b => low.includes(b.toLowerCase())) || '';
}

// ─────────────────────────────────────────────────────────────
// Parsear texto plano del listing
// ─────────────────────────────────────────────────────────────
function parseText(text, id, url) {
  const low = text.toLowerCase();

  const habM = text.match(/(\d+)\s*habitaci[oó]n/i);
  const ambM = text.match(/(\d+)\s*[Aa]mbientes?/);
  let ambientes = null;
  if (habM)      ambientes = parseInt(habM[1]) + 1;
  else if (ambM) ambientes = parseInt(ambM[1]);

  const banoM = text.match(/(\d+)\s*ba[ñn]o/i);
  const banos = banoM ? parseInt(banoM[1]) : null;

  const metM = text.match(/(\d{2,3})\s*(?:m[²2]|metros?\s*cuadrados?|pies\s*cuadrados?)/i);
  const metros = metM ? parseInt(metM[1]) : null;

  let precio = null;
  const pm1 = text.match(/[Pp]recio[^$\d\n]*?(?:USD?\s*)?([\d.]+)/);
  const pm2 = text.match(/\$\s*([\d.,]+)\s*(?:\/\s*mes|al\s+mes)/i);
  const pm3 = text.match(/USD?\s+([\d.]{4,})/i);
  const pm4 = text.match(/US\$\s*([\d.,]+)/i);
  const rawP = (pm4?.[1] || pm1?.[1] || pm2?.[1] || pm3?.[1] || '').replace(/\./g,'').replace(/,/g,'');
  if (rawP && parseInt(rawP) > 100) precio = `US$${parseInt(rawP).toLocaleString('es-AR')}`;

  const expM = text.match(/[Ee]xpensas?\s*\$\s*([\d.,]+)/i);
  const expensas = expM ? `$ ${expM[1]}` : null;

  const barrio    = findBarrio(text);
  const addrM     = text.match(/(?:[Uu]bicaci[oó]n|[Dd]irecci[oó]n)[:\s]+([A-ZÁÉÍÓÚa-záéíóúñÑ][^\n,]{4,40})/i);
  const direccion = (addrM ? addrM[1].trim() : barrio) || 'Buenos Aires';

  const amenities = [];
  if (/pileta|piscina|pool/.test(low))                                 amenities.push('pool');
  if (/gimnasio|\bgym\b/.test(low))                                    amenities.push('gym');
  if (/\bmascotas?\b|se aceptan perros|acepta animales/i.test(low))    amenities.push('mascotas');
  if (/\bcochera\b|garage propio|estacionamiento cubierto/i.test(low)) amenities.push('cochera');

  return { id, url, barrio, ambientes, banos, metros, amenities, precio, expensas, direccion, photo: null };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
// facebookexternalhit hace que FB devuelva metadata social (og:image) sin login
const FB_UA      = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function extractOgImage(html) {
  const m = html.match(/property="og:image"[^>]*content="([^"]+)"/i) ||
            html.match(/content="([^"]+)"[^>]*property="og:image"/i);
  return m?.[1]?.replace(/&amp;/g, '&') || null;
}

function extractMeta(html, prop) {
  const m = html.match(new RegExp(`property="${prop}"[^>]*content="([^"]+)"`, 'i')) ||
            html.match(new RegExp(`content="([^"]+)"[^>]*property="${prop}"`, 'i'));
  return m?.[1] ? decodeHTMLEntities(m[1]) : '';
}

function decodeHTMLEntities(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
}

// ─────────────────────────────────────────────────────────────
// MercadoLibre
// ─────────────────────────────────────────────────────────────
async function scrapeML(url) {
  const m = url.match(/MLA-?(\d+)/i);
  const id = m ? 'MLA' + m[1] : null;
  if (!id) return null;

  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'es-AR,es;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const html = res.ok ? await res.text() : '';

  const photo = extractOgImage(html);

  // Texto para parsear: og:title + og:description + JSON-LD
  const title = extractMeta(html, 'og:title');
  const desc  = extractMeta(html, 'og:description');
  let ldText  = '';

  const ldMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  let ldProduct = null;
  for (const lm of ldMatches) {
    try {
      const parsed = JSON.parse(lm[1]);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const product = candidates.find(p => p['@type'] === 'Product');
      if (product) { ldProduct = product; ldText = lm[1]; break; }
    } catch {}
  }

  const data = parseText([title, desc, ldText].join('\n'), id, url);
  data.photo = photo;

  // Precio desde JSON-LD si no se detectó en texto
  if (!data.precio && ldProduct?.offers) {
    const offer  = Array.isArray(ldProduct.offers) ? ldProduct.offers[0] : ldProduct.offers;
    const price  = parseInt(offer?.price);
    const cur    = offer?.priceCurrency || 'USD';
    if (price > 100) data.precio = `${cur === 'USD' ? 'US$' : '$'}${price.toLocaleString('es-AR')}`;
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Facebook Marketplace
// ─────────────────────────────────────────────────────────────
async function scrapeFacebook(url) {
  const m = url.match(/facebook\.com\/marketplace\/item\/(\d+)/);
  if (!m) return null;
  const id = 'FB' + m[1];

  // facebookexternalhit → FB devuelve og:image y og:description sin login
  const res = await fetch(url, {
    headers: {
      'User-Agent': FB_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-AR,es;q=0.9',
    },
  });
  const html = res.ok ? await res.text() : '';

  const photo = extractOgImage(html);
  const title = extractMeta(html, 'og:title');
  const desc  = extractMeta(html, 'og:description');

  const data  = parseText([title, desc].join('\n'), id, url);
  data.photo  = photo;
  return data;
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const url = event.queryStringParameters?.url;
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'url requerida' }) };

  try {
    let data = null;
    if (/mercadolibre\.|meli\.com/i.test(url))        data = await scrapeML(url);
    else if (/facebook\.com\/marketplace/i.test(url)) data = await scrapeFacebook(url);
    if (!data) return { statusCode: 200, headers, body: JSON.stringify({ error: 'URL no soportada' }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    console.error('[scrape]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
