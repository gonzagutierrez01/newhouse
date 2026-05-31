'use strict';

const BARRIOS = [
  'Puerto Madero','Palermo Hollywood','Palermo Soho','Palermo',
  'Recoleta','Belgrano','Núñez','Colegiales','Villa Crespo',
  'San Telmo','Almagro','Caballito','Flores','Barracas','La Boca',
];

function findBarrio(text) {
  const low = text.toLowerCase();
  return BARRIOS.find(b => low.includes(b.toLowerCase())) || '';
}

function parseText(text, id, url) {
  const low = text.toLowerCase();

  const habM      = text.match(/(\d+)\s*habitaci[oó]n/i);
  const ambM      = text.match(/(\d+)\s*[Aa]mbientes?/);
  const ambShortM = text.match(/(\d+)\s*[Aa]mb\b/i);
  let ambientes = null;
  if (habM)           ambientes = parseInt(habM[1]) + 1;
  else if (ambM)      ambientes = parseInt(ambM[1]);
  else if (ambShortM) ambientes = parseInt(ambShortM[1]);

  const banoM  = text.match(/(\d+)\s*ba[ñn]o/i);
  const banos  = banoM ? parseInt(banoM[1]) : null;

  const metM   = text.match(/(\d{2,3})\s*(?:m[²2]|metros?\s*cuadrados?|pies\s*cuadrados?)/i);
  const metros = metM ? parseInt(metM[1]) : null;

  let precio = null;
  const pm1  = text.match(/[Pp]recio[^$\d\n]*?(?:USD?\s*)?([\d.]+)/);
  const pm2  = text.match(/\$\s*([\d.,]+)\s*(?:\/\s*mes|al\s+mes)/i);
  const pm3  = text.match(/USD?\s+([\d.]{4,})/i);
  const pm4  = text.match(/US\$\s*([\d.,]+)/i);
  const rawP = (pm4?.[1] || pm1?.[1] || pm2?.[1] || pm3?.[1] || '').replace(/\./g,'').replace(/,/g,'');
  if (rawP && parseInt(rawP) > 100) precio = `US$${parseInt(rawP).toLocaleString('es-AR')}`;

  const expM     = text.match(/[Ee]xpensas?\s*\$\s*([\d.,]+)/i);
  const expensas = expM ? `$ ${expM[1]}` : null;

  const barrio    = findBarrio(text);
  const addrM     = text.match(/(?:[Uu]bicaci[oó]n|[Dd]irecci[oó]n)[:\s]+([A-ZÁÉÍÓÚa-záéíóúñÑ][^\n,]{4,40})/i);
  const addrClean = addrM && !/(información|zona|característica|buscar)/i.test(addrM[1]) ? addrM[1].trim() : null;
  const streetM   = text.match(/\b((?:Av(?:enida)?\.?\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚa-záéíóúñÑ][a-záéíóúñ]+){0,2})\s+(\d{3,5})\b(?!\s*m)/);
  const streetAddr = streetM && !/baño|piso|hab|amb|planta|nivel/i.test(streetM[1])
    ? `${streetM[1].trim()} ${streetM[2]}`
    : null;
  const direccion = addrClean || (streetAddr ? `${streetAddr}${barrio ? ', ' + barrio : ''}` : barrio) || 'Buenos Aires';

  const amenities = [];
  if (/pileta|piscina|pool/.test(low))                                 amenities.push('pool');
  if (/gimnasio|\bgym\b/.test(low))                                    amenities.push('gym');
  if (/\bmascotas?\b|se aceptan perros|acepta animales/i.test(low))    amenities.push('mascotas');
  if (/\bcochera\b|garage propio|estacionamiento cubierto/i.test(low)) amenities.push('cochera');

  return { id, url, barrio, ambientes, banos, metros, amenities, precio, expensas, direccion, photo: null };
}

const FB_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

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

async function scrapeML(url) {
  const m = url.match(/MLA-?(\d+)/i);
  const id = m ? 'MLA' + m[1] : null;
  if (!id) return null;

  const res = await fetch(`https://articulo.mercadolibre.com.ar/MLA-${m[1]}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
  });
  const html = res.ok ? await res.text() : '';

  const photo = extractOgImage(html);

  const titleM = html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
                 html.match(/content="([^"]+)"[^>]*property="og:title"/i);
  const title  = titleM ? decodeHTMLEntities(titleM[1]) : '';

  const slug = decodeURIComponent(url).split('/').pop()
    .toLowerCase().replace(/_jm.*/i, '').replace(/-/g, ' ');

  const data = parseText(slug + '\n' + title, id, url);
  data.photo = photo;
  return data;
}

async function scrapeFacebook(url) {
  const m = url.match(/facebook\.com\/marketplace\/item\/(\d+)/);
  if (!m) return null;
  const id = 'FB' + m[1];

  const res = await fetch(url, {
    headers: { 'User-Agent': FB_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' },
  });
  const html  = res.ok ? await res.text() : '';
  const photo = extractOgImage(html);
  const title = extractMeta(html, 'og:title');
  const desc  = extractMeta(html, 'og:description');

  const data = parseText([title, desc].join('\n'), id, url);
  data.photo = photo;
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requerida' });

  try {
    let data = null;
    if (/mercadolibre\.|meli\.com/i.test(url))        data = await scrapeML(url);
    else if (/facebook\.com\/marketplace/i.test(url)) data = await scrapeFacebook(url);
    if (!data) return res.status(200).json({ error: 'URL no soportada' });
    res.status(200).json(data);
  } catch (e) {
    console.error('[scrape]', e.message);
    res.status(500).json({ error: e.message });
  }
};
