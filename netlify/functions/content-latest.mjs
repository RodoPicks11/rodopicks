// GET /api/content/latest[?week=N][&top=N][&seccion=rankings,startsit,waivers,sleepers,riesgo][&pos=QB,RB,WR,TE]
// Endpoint público de solo lectura con el análisis Fantasy de RodoPicks.
// No usa claves, no lee ligas ni usuarios. Se guarda en la caché de Netlify
// 30 minutos para no consultar Sleeper en cada visita.
import { buildContent } from '../../public/content-core.mjs';

const SECCIONES = { rankings: 'rankings', startsit: 'startSit', waivers: 'waivers', sleepers: 'sleepers', riesgo: 'riesgoDeDecepcionar' };
const POSICIONES = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const lista = (v) => (v == null ? null : v.split(',').map((x) => x.trim()).filter(Boolean));

// Recorta la respuesta para lectores con límite de tamaño (ChatGPT, Claude):
// conserva siempre los metadatos y la validación.
function recortar(data, secs, pos, base) {
  const out = { ...data };
  if (secs) for (const k of Object.keys(SECCIONES)) if (!secs.includes(k)) delete out[SECCIONES[k]];
  if (pos) {
    const f = (arr) => (Array.isArray(arr) ? arr.filter((x) => pos.includes(x.posicion)) : arr);
    if (out.rankings) out.rankings = Object.fromEntries(Object.entries(out.rankings).filter(([k]) => pos.includes(k)));
    if (out.startSit) out.startSit = { ...out.startSit, arrancar: f(out.startSit.arrancar), sentar: f(out.startSit.sentar) };
    for (const k of ['waivers', 'sleepers', 'riesgoDeDecepcionar']) if (out[k]) out[k] = f(out[k]);
  }
  if (secs || pos) out.filtro = { secciones: secs || 'todas', posiciones: pos || 'todas' };
  const vistasCortas = Object.fromEntries(
    Object.keys(SECCIONES).map((k) => [k, `${base}?seccion=${k}`]).concat(['QB', 'RB', 'WR', 'TE'].map((ps) => [`rankings_${ps}`, `${base}?seccion=rankings&pos=${ps}`])),
  );
  // Las vistas cortas van al inicio para que se vean aunque el lector corte la respuesta.
  const { esquema, app, sitio, ...resto } = out;
  return { esquema, app, sitio, vistasCortas, ...resto };
}

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

  const secs = lista(url.searchParams.get('seccion'));
  if (secs && (!secs.length || secs.some((x) => !SECCIONES[x]))) return json({ error: `El parámetro seccion acepta: ${Object.keys(SECCIONES).join(', ')}` }, 400);
  const pos = lista((url.searchParams.get('pos') || '').toUpperCase() || null);
  if (pos && (!pos.length || pos.some((x) => !POSICIONES.includes(x)))) return json({ error: `El parámetro pos acepta: ${POSICIONES.join(', ')}` }, 400);

  try {
    const full = await buildContent({ week: w == null ? null : Number(w), top: t == null ? null : Number(t) });
    const data = recortar(full, secs, pos, `${url.origin}/api/content/latest`);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...HEADERS,
        'cache-control': 'public, max-age=300',
        'netlify-cdn-cache-control': 'public, durable, s-maxage=1800, stale-while-revalidate=86400',
        'netlify-vary': 'query=week|top|seccion|pos',
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
