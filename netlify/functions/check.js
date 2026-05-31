'use strict';

// Solo marcamos inactivo si hay señal DEFINITIVA — nunca por ausencia de datos
const ML_INACTIVE = [
  'publicación no encontrada',
  'no existe esta publicación',
  'publicación pausada',
  'esta publicación fue eliminada',
  'no encontramos lo que buscás',
  'listing not found',
  'item not found',
];

async function checkML(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
    redirect: 'follow',
  });

  // 404 definitivo → inactivo
  if (res.status === 404) return { active: false, reason: 'not_found' };

  // Cualquier otro error de red → conservar (no sabemos)
  if (!res.ok) return { active: true, reason: 'http_error_kept' };

  const html = await res.text();
  const low  = html.toLowerCase();

  // Solo inactivo si hay texto explícito de ML diciendo que no existe
  if (ML_INACTIVE.some(m => low.includes(m))) return { active: false, reason: 'paused_or_deleted' };

  // En todos los demás casos (incluyendo sin precio) → conservar
  return { active: true, reason: 'active' };
}

async function checkFacebook(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
    redirect: 'follow',
  });

  // 404 → inactivo
  if (res.status === 404) return { active: false, reason: 'not_found' };

  // Error de red → conservar
  if (!res.ok) return { active: true, reason: 'http_error_kept' };

  // Solo inactivo si FB redirigió completamente fuera del item
  // (FB redirige a /marketplace/ o / cuando el listing no existe)
  const finalUrl = res.url || '';
  if (finalUrl && !finalUrl.includes('/marketplace/item/')) {
    return { active: false, reason: 'redirected_away' };
  }

  return { active: true, reason: 'active' };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const url = event.queryStringParameters?.url;
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'url requerida' }) };

  try {
    let result;
    if      (/mercadolibre\.|meli\.com/i.test(url))       result = await checkML(url);
    else if (/facebook\.com\/marketplace/i.test(url))     result = await checkFacebook(url);
    else                                                   result = { active: true, reason: 'unknown_platform' };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    // Error inesperado → siempre conservar
    return { statusCode: 200, headers, body: JSON.stringify({ active: true, reason: 'fetch_error' }) };
  }
};
