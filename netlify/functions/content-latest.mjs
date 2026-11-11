// GET /api/content/latest[?week=N][&top=N]
// Endpoint público de solo lectura con el análisis Fantasy de RodoPicks.
// No usa claves, no lee ligas ni usuarios. Se guarda en la caché de Netlify
// 30 minutos para no consultar Sleeper en cada visita.
import { buildContent } from '../../public/content-core.mjs';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'x-content-type-options': 'nosniff',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== 'GET') return json({ error: 'Solo se permite GET' }, 405);

  const url = new URL(req.url);
  const w = url.searchParams.get('week');
  if (w != null && (!/^\d{1,2}$/.test(w) || +w < 1 || +w > 18)) return json({ error: 'El parámetro week debe ser un número del 1 al 18' }, 400);
  const t = url.searchParams.get('top');
  if (t != null && (!/^\d{1,2}$/.test(t) || +t < 1 || +t > 50)) return json({ error: 'El parámetro top debe ser un número del 1 al 50' }, 400);

  try {
    const data = await buildContent({ week: w == null ? null : Number(w), top: t == null ? null : Number(t) });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...HEADERS,
        'cache-control': 'public, max-age=300',
        'netlify-cdn-cache-control': 'public, durable, s-maxage=1800, stale-while-revalidate=86400',
        'netlify-vary': 'query=week|top',
      },
    });
  } catch (e) {
    return json({ error: 'No se pudo generar el contenido', detalle: String((e && e.message) || e), generadoEn: new Date().toISOString() }, 502);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...HEADERS, 'cache-control': 'no-store' } });
}

export const config = { path: '/api/content/latest' };
