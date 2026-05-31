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

  const habM     = text.match(/(\d+)\s*habitaci[oó]n/i);
  const ambM     = text.match(/(\d+)\s*[Aa]mbientes?/);
  const ambShortM = text.match(/(\d+)\s*[Aa]mb\b/i);   // "3 Amb" (título/slug ML)
  let ambientes = null;
  if (habM)           ambientes = parseInt(habM[1]) + 1;
  else if (ambM)      ambientes = parseInt(ambM[1]);
  else if (ambShortM) ambientes = parseInt(ambShortM[1]);

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

  // ML devuelve una challenge page estática que SÍ contiene og:image y og:title
  const res = await fetch(`https://articulo.mercadolibre.com.ar/MLA-${m[1]}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
  });
  const html = res.ok ? await res.text() : '';

  // Foto desde og:image (presente en la challenge page; formato cambió de D_NQ_NP_... a D_XXXXX-MLA...)
  const photo = extractOgImage(html);

  // Título og:title → tiene ambientes y amenities (ej: "3 Ambientes Con Cochera ...")
  const titleM = html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
                 html.match(/content="([^"]+)"[^>]*property="og:title"/i);
  const title = titleM ? decodeHTMLEntities(titleM[1]) : '';

  // Slug de la URL → tiene barrio, ambientes, metros
  const slug = decodeURIComponent(url)
    .split('/').pop()
    .toLowerCase()
    .replace(/_jm.*/i, '')
    .replace(/-/g, ' ');

  // Parsear slug + título juntos para maximizar datos extraídos
  const data = parseText(slug + '\n' + title, id, url);
  data.photo = photo;
  // Precio no está disponible en HTML estático (requiere JS rendering o API con auth)
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
