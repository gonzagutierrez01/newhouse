'use strict';
const express    = require('express');
const { execSync } = require('child_process');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');

const app  = express();
const PORT = 4444;
app.use(express.static(__dirname));

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
// Parsear texto plano del listing (sirve para ML y FB)
// ─────────────────────────────────────────────────────────────
function parseText(text, id, url) {
  const low = text.toLowerCase();

  // Ambientes: "2 habitaciones" → +1 living = 3 amb
  const habM = text.match(/(\d+)\s*habitaci[oó]n/i);
  const ambM = text.match(/(\d+)\s*[Aa]mbientes?/);
  let ambientes = null;
  if (habM)      ambientes = parseInt(habM[1]) + 1;
  else if (ambM) ambientes = parseInt(ambM[1]);

  const banoM = text.match(/(\d+)\s*ba[ñn]o/i);
  const banos = banoM ? parseInt(banoM[1]) : null;

  // "87 pies cuadrados" en listados AR = metros cuadrados
  const metM = text.match(/(\d{2,3})\s*(?:m[²2]|metros?\s*cuadrados?|pies\s*cuadrados?)/i);
  const metros = metM ? parseInt(metM[1]) : null;

  // Precio
  let precio = null;
  const pm1 = text.match(/[Pp]recio[^$\d\n]*?(?:USD?\s*)?([\d.]+)/);
  const pm2 = text.match(/\$\s*([\d.,]+)\s*(?:\/\s*mes|al\s+mes)/i);
  const pm3 = text.match(/USD?\s+([\d.]{4,})/i);
  // FB muestra "US$ 1.200" o "US$1200"
  const pm4 = text.match(/US\$\s*([\d.,]+)/i);
  const rawP = (pm4?.[1] || pm1?.[1] || pm2?.[1] || pm3?.[1] || '').replace(/\./g, '').replace(/,/g, '');
  if (rawP && parseInt(rawP) > 100) precio = `US$${parseInt(rawP).toLocaleString('es-AR')}`;

  // Expensas
  const expM = text.match(/[Ee]xpensas?\s*\$\s*([\d.,]+)/i);
  const expensas = expM ? `$ ${expM[1]}` : null;

  const barrio    = findBarrio(text);
  const addrM     = text.match(/(?:[Uu]bicaci[oó]n|[Dd]irecci[oó]n)[:\s]+([A-ZÁÉÍÓÚa-záéíóúñÑ][^\n,]{4,40})/i);
  const addrClean = addrM && !/(información|zona|característica|buscar)/i.test(addrM[1]) ? addrM[1].trim() : null;
  // Calle + número: "Migueletes 1617", "Av. Santa Fe 3500", etc.
  const streetM   = text.match(/\b((?:Av(?:enida)?\.?\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚa-záéíóúñÑ][a-záéíóúñ]+){0,2})\s+(\d{3,5})\b(?!\s*m)/);
  const streetAddr = streetM && !/baño|piso|hab|amb|planta|nivel/i.test(streetM[1])
    ? `${streetM[1].trim()} ${streetM[2]}`
    : null;
  const direccion = addrClean || (streetAddr ? `${streetAddr}${barrio ? ', ' + barrio : ''}` : barrio) || 'Buenos Aires';

  const amenities = [];
  if (/pileta|piscina|pool/.test(low))                              amenities.push('pool');
  if (/gimnasio|\bgym\b/.test(low))                                 amenities.push('gym');
  if (/\bmascotas?\b|se aceptan perros|acepta animales/i.test(low)) amenities.push('mascotas');
  if (/\bcochera\b|garage propio|estacionamiento cubierto/i.test(low)) amenities.push('cochera');

  return { id, url, barrio, ambientes, banos, metros, amenities, precio, expensas, direccion, photo: null };
}

// ─────────────────────────────────────────────────────────────
// Leer una página usando el Chrome del usuario (ya logueado)
// vía AppleScript → devuelve document.body.innerText
// ─────────────────────────────────────────────────────────────
function readWithChrome(url, delay = 4) {
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = [
    'tell application "Google Chrome"',
    `  set t to make new tab at end of tabs of window 1 with properties {URL:"${safeUrl}"}`,
    `  delay ${delay}`,
    '  set txt to execute t javascript "document.body.innerText"',
    '  close t',
    '  return txt',
    'end tell',
  ].join('\n');
  return execSync(`osascript <<'APPL'\n${script}\nAPPL`, { encoding: 'utf8', timeout: 40000 });
}

// Versión extendida: devuelve { photo, text } en un solo tab de Chrome.
// Usa JS con comillas simples internamente para no romper el string AppleScript.
function readFullPageWithChrome(url, delay = 6) {
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const SEP = '|||SPLIT|||';
  // JS usando solo single-quotes → no choca con el string AppleScript de double-quotes
  const jsPhoto = "var ms=document.querySelectorAll('meta'),r='';for(var i=0;i<ms.length;i++){if(ms[i].getAttribute('property')==='og:image'){r=ms[i].getAttribute('content')||'';break;}}r";
  const script = [
    'tell application "Google Chrome"',
    `  set t to make new tab at end of tabs of window 1 with properties {URL:"${safeUrl}"}`,
    `  delay ${delay}`,
    `  set p to execute t javascript "${jsPhoto}"`,
    '  set b to execute t javascript "document.body.innerText"',
    '  close t',
    `  return p & "${SEP}" & b`,
    'end tell',
  ].join('\n');
  const raw = execSync(`osascript <<'APPL'\n${script}\nAPPL`, { encoding: 'utf8', timeout: 50000 });
  const idx = raw.indexOf(SEP);
  if (idx === -1) return { photo: null, text: raw };
  return { photo: raw.slice(0, idx).trim() || null, text: raw.slice(idx + SEP.length) };
}

// ─────────────────────────────────────────────────────────────
// ML – foto desde HTML público + texto via Chrome
// ─────────────────────────────────────────────────────────────
function parseMLId(url) {
  const m = url.match(/MLA-?(\d+)/i);
  return m ? 'MLA' + m[1] : null;
}

async function scrapeML(url) {
  const id = parseMLId(url);
  if (!id) return null;

  // Foto desde og:image (disponible en la challenge page estática)
  const htmlRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36', 'Accept-Language': 'es-AR,es;q=0.9' }
  });
  const html  = htmlRes.ok ? await htmlRes.text() : '';
  const photoM = html.match(/property="og:image"[^>]*content="([^"]+)"/i) ||
                 html.match(/content="([^"]+)"[^>]*property="og:image"/i);
  const rawPhoto = photoM?.[1]?.replace(/&amp;/g, '&') || null;
  // Convertir -O.jpg a -V.webp (sin marca de agua)
  const photo = rawPhoto ? rawPhoto.replace(/-[A-Z](?:-null)?\.jpg$/, '-V.webp') : null;

  // Chrome abre el tab y espera a que la challenge page de ML resuelva el PoW y redirija
  // 12s da tiempo suficiente para que cargue el listing real con precio y detalles
  const text = readWithChrome(url, 12);
  const data  = parseText(text, id, url);
  data.photo  = photo;
  return data;
}

// ─────────────────────────────────────────────────────────────
// FB Marketplace – texto + foto via Chrome (ya logueado)
// ─────────────────────────────────────────────────────────────
async function scrapeFacebook(url) {
  const m = url.match(/facebook\.com\/marketplace\/item\/(\d+)/);
  if (!m) return null;
  const id = 'FB' + m[1];

  // Usamos Chrome (logueado) para obtener foto og:image + texto en un solo tab
  const { photo, text } = readFullPageWithChrome(url, 6);

  const data = parseText(text, id, url);
  data.photo = photo?.replace(/&amp;/g, '&') || null;
  return data;
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────
app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    let data = null;
    if (/mercadolibre\.|meli\.com/i.test(url))        data = await scrapeML(url);
    else if (/facebook\.com\/marketplace/i.test(url)) data = await scrapeFacebook(url);
    if (!data) return res.json({ error: 'URL no soportada' });
    res.json(data);
  } catch (e) {
    console.error('[scrape]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`NewHouse  →  http://localhost:${PORT}`));
