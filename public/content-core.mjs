// RodoPicks · núcleo de contenido público para Instagram / ChatGPT
// Usa los mismos cálculos que el tablero (forma, proyección, defensa rival, niveles,
// sorpresas, trampas y sleepers), pero sin ninguna liga: no lee usuarios, ligas,
// plantillas ni identificadores personales. Solo datos públicos de jugadores NFL.
// Lo importan la Netlify Function (/api/content/latest) y el botón de exportar del sitio.

export const SCHEMA = 'rodopicks.content.v1';
const API = 'https://api.sleeper.app/v1';
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const RANK_POS = ['QB', 'RB', 'WR', 'TE'];
const RANK_DEPTH = { QB: 24, RB: 40, WR: 50, TE: 24 };
const BADINJ = ['IR', 'Out', 'PUP', 'Sus', 'Doubtful', 'COV', 'DNR'];
const ELIG = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], FLEX: ['RB', 'WR', 'TE'] };
// Supuestos de una liga estándar (el endpoint es público y no depende de ninguna liga)
const LIGA = { equipos: 12, alineacion: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'], puntuacion: 'PPR' };
export const BYE2026 = { ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11, DAL: 14, DEN: 10, DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5, LV: 13, LAC: 7, LAR: 11, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8, NYJ: 13, PHI: 10, PIT: 9, SF: 8, SEA: 11, TB: 10, TEN: 9, WAS: 7 };
const TIER_TXT = { elite: 'Arráncalo sin pensar', start: 'Arráncalo', duda: 'Flex / duda', sit: 'Siéntalo' };

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const r1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

async function getJSON(f, url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await f(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function tryJSON(f, url, ms) {
  try { return await getJSON(f, url, ms); } catch (e) { return { __error: String((e && e.message) || e) }; }
}
const isErr = (x) => !!(x && x.__error);
function normStats(a) {
  if (Array.isArray(a)) { const m = {}; a.forEach((o) => { if (o && o.player_id) m[String(o.player_id)] = o.stats || {}; }); return m; }
  return a && typeof a === 'object' ? a : {};
}
function normProj(a) {
  const m = {};
  if (Array.isArray(a)) a.forEach((o) => { if (o && o.player_id) m[String(o.player_id)] = { st: o.stats || {}, opp: o.opponent || null, week: o.week ?? null }; });
  else if (a && typeof a === 'object') for (const id in a) m[id] = { st: a[id] || {}, opp: null, week: null };
  return m;
}
function startersPerPos() {
  const c = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const fx = { FLEX: { RB: 0.45, WR: 0.45, TE: 0.1 } };
  LIGA.alineacion.forEach((s) => { if (c[s] != null) c[s]++; else if (fx[s]) for (const k in fx[s]) c[k] += fx[s][k]; });
  for (const k in c) c[k] *= LIGA.equipos;
  return c;
}

export async function buildContent({ fetch: f = globalThis.fetch, week = null, top = null, now = new Date() } = {}) {
  const faltantes = [];
  const chequeos = [];
  const fuentes = [];
  const ok = (chequeo, pasa, detalle, critico = true) => chequeos.push({ chequeo, ok: !!pasa, critico, detalle });

  // ---- 1. Estado de la NFL según Sleeper
  const state = await getJSON(f, `${API}/state/nfl`);
  const season = String(state.league_season || state.season);
  const cur = Number(state.display_week || state.week) || 1;
  const wk = week != null && week !== '' ? Number(week) : cur;
  if (!Number.isInteger(wk) || wk < 1 || wk > 18) throw new Error('La semana debe ser un número del 1 al 18');
  ok('temporada_regular', state.season_type === 'regular', `Sleeper reporta temporada ${season}, tipo "${state.season_type}"`);
  ok('semana_seleccionada', wk === cur || wk === cur + 1, wk === cur ? `Semana ${wk}: es la semana actual según Sleeper` : `Semana ${wk} pedida; la semana actual según Sleeper es ${cur}`);
  fuentes.push({ nombre: 'Sleeper', uso: 'estado de la temporada, jugadores, estadísticas, proyecciones, calendario y tendencias', url: 'https://docs.sleeper.com', estado: 'ok' });

  // ---- 2. Datos públicos (en paralelo)
  const done = []; for (let w = 1; w < wk; w++) done.push(w);
  const [players, projA, sched, trAdd, trDrop, market, ...wkStats] = await Promise.all([
    tryJSON(f, `${API}/players/nfl`, 9000),
    tryJSON(f, `https://api.sleeper.app/projections/nfl/${season}/${wk}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`),
    tryJSON(f, `https://api.sleeper.app/schedule/nfl/regular/${season}`),
    tryJSON(f, `${API}/players/nfl/trending/add?lookback_hours=24&limit=50`),
    tryJSON(f, `${API}/players/nfl/trending/drop?lookback_hours=24&limit=50`),
    tryJSON(f, 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1'),
    ...done.map((w) => tryJSON(f, `${API}/stats/nfl/regular/${season}/${w}`)),
  ]);
  if (isErr(players)) throw new Error('No se pudo leer la base de jugadores de Sleeper (' + players.__error + ')');
  let proj = projA;
  if (isErr(proj) || !Object.keys(normProj(proj)).length) proj = await tryJSON(f, `${API}/projections/nfl/regular/${season}/${wk}`);

  // ---- 3. Jugadores (solo datos públicos de la NFL)
  const P = {};
  for (const id in players) {
    const p = players[id]; const pos = p.position === 'DEF' || p.position === 'DST' ? 'DEF' : p.position;
    if (!POS.includes(pos)) continue;
    const name = pos === 'DEF' ? (`${p.first_name || ''} ${p.last_name || ''}`.trim() || id) : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim());
    P[id] = { id, name, pos, team: p.team || (pos === 'DEF' ? id : null), inj: p.injury_status || null, weekly: {}, gp: {} };
  }

  // ---- 4. Estadísticas por semana (puntos PPR)
  const statsOk = [];
  done.forEach((w, i) => {
    const raw = wkStats[i];
    if (isErr(raw)) { faltantes.push({ campo: `estadisticas.semana_${w}`, motivo: 'Sleeper no respondió' }); return; }
    const m = normStats(raw); let cnt = 0;
    for (const id in m) {
      const pl = P[id]; if (!pl) continue; const st = m[id];
      if (typeof st.pts_ppr !== 'number' && !(st.gp > 0)) continue;
      const pts = Math.round((st.pts_ppr || 0) * 100) / 100; const gp = (st.gp || 0) > 0 || pts !== 0;
      if (!gp) continue; pl.weekly[w] = pts; pl.gp[w] = 1; cnt++;
    }
    if (cnt) statsOk.push(w); else faltantes.push({ campo: `estadisticas.semana_${w}`, motivo: 'Sleeper respondió sin datos' });
  });
  const lastStats = statsOk.length ? Math.max(...statsOk) : null;
  ok('estadisticas_completas', statsOk.length === done.length, statsOk.length === done.length ? `Semanas 1 a ${wk - 1} con estadísticas` : `Faltan estadísticas de las semanas ${done.filter((w) => !statsOk.includes(w)).join(', ')}`);
  ok('datos_al_dia', wk === 1 || lastStats === wk - 1, lastStats ? `Última semana con estadísticas: ${lastStats}` : 'Sin estadísticas de semanas anteriores');

  Object.values(P).forEach((p) => {
    const gw = statsOk.filter((w) => p.gp[w]); p.games = gw.length;
    p.total = statsOk.reduce((a, w) => a + (p.weekly[w] || 0), 0); p.avg = p.games ? p.total / p.games : 0;
    const l3 = gw.slice(-3); p.l3 = l3.length ? l3.reduce((a, w) => a + (p.weekly[w] || 0), 0) / l3.length : 0;
    p.form = p.games ? (l3.length >= 2 ? p.l3 * 0.6 + p.avg * 0.4 : p.avg) : 0;
    p.bye = season === '2026' ? BYE2026[p.team] || null : null;
  });

  // ---- 5. Calendario, rival y defensa contra la posición (igual que el tablero)
  const oppW = {};
  if (!isErr(sched) && Array.isArray(sched)) sched.forEach((g) => { const w = g.week; if (!w || !g.home || !g.away) return; (oppW[w] = oppW[w] || {})[g.home] = g.away; oppW[w][g.away] = g.home; });
  const schedOk = !!(oppW[wk] && Object.keys(oppW[wk]).length);
  ok('calendario_de_la_semana', schedOk, schedOk ? `${Object.keys(oppW[wk]).length / 2} partidos en la semana ${wk}` : 'Sleeper no entregó el calendario: no hay rival ni lectura de la defensa rival');
  fuentes.push({ nombre: 'Sleeper (calendario)', uso: 'rivales de la semana y puntos que permite cada defensa', url: 'https://api.sleeper.app', estado: schedOk ? 'ok' : 'no disponible' });
  const dvp = {}; let dvpOk = false;
  if (schedOk) {
    const allow = {}, gms = {};
    statsOk.forEach((w) => { const om = oppW[w]; if (!om) return; Object.values(P).forEach((p) => { if (!p.gp[w] || !p.team) return; const d = om[p.team]; if (!d) return; allow[d] = allow[d] || {}; allow[d][p.pos] = (allow[d][p.pos] || 0) + (p.weekly[w] || 0); (gms[d] = gms[d] || new Set()).add(w); }); });
    const avgA = {}; for (const d in allow) { avgA[d] = {}; POS.forEach((ps) => (avgA[d][ps] = (allow[d][ps] || 0) / Math.max(1, gms[d].size))); }
    POS.forEach((ps) => Object.keys(avgA).sort((a, b) => avgA[b][ps] - avgA[a][ps]).forEach((d, i) => { (dvp[d] = dvp[d] || {})[ps] = { rk: i + 1, pts: avgA[d][ps] }; }));
    dvpOk = Object.keys(dvp).length >= 20;
  }

  // ---- 6. Proyecciones PPR de la semana
  const PJ = isErr(proj) ? {} : normProj(proj);
  let projCount = 0, projWrongWeek = 0, rivalMismatch = 0;
  Object.values(P).forEach((p) => {
    p.opp = schedOk && p.team ? oppW[wk][p.team] || null : null;
    const pr = PJ[p.id];
    if (pr && typeof pr.st.pts_ppr === 'number') {
      if (pr.week != null && Number(pr.week) !== wk) { projWrongWeek++; p.proj = null; }
      else { p.proj = r1(pr.st.pts_ppr); projCount++; }
      if (pr.opp && p.opp && pr.opp !== p.opp) rivalMismatch++;
      if (!p.opp && pr.opp) p.opp = pr.opp;
    } else p.proj = null;
    p.dvp = dvpOk && p.opp && dvp[p.opp] ? dvp[p.opp][p.pos] : null;
  });
  const projOk = projCount > 0 && projWrongWeek === 0;
  ok('proyecciones_de_la_semana', projOk, projOk ? `${projCount} jugadores con proyección PPR de la semana ${wk}` : (projWrongWeek ? `${projWrongWeek} proyecciones eran de otra semana y se descartaron` : 'Sleeper no entregó proyecciones: se usa la forma reciente ajustada por el rival'));
  ok('rivales_coinciden', rivalMismatch === 0, rivalMismatch ? `${rivalMismatch} jugadores con rival distinto entre proyección y calendario` : 'Rival del calendario y de la proyección coinciden', false);
  fuentes.push({ nombre: 'Sleeper (proyecciones)', uso: `proyecciones PPR de la semana ${wk}`, url: 'https://api.sleeper.app', estado: projOk ? 'ok' : 'no disponible' });

  // ---- 7. Mercado (opcional, solo para la señal de tendencia de sleepers)
  const mk = {};
  if (!isErr(market) && Array.isArray(market)) market.forEach((o) => { const id = o && o.player && o.player.sleeperId; if (id && o.value > 0) mk[String(id)] = { v: o.value, tr: o.trend30Day || 0 }; });
  const mkOk = Object.keys(mk).length > 0;
  fuentes.push({ nombre: 'FantasyCalc', uso: 'tendencia del valor de mercado (redraft, 1 QB, PPR, 12 equipos)', url: 'https://fantasycalc.com', estado: mkOk ? 'ok' : 'no disponible' });
  ok('mercado', mkOk, mkOk ? 'Valores de FantasyCalc disponibles' : 'FantasyCalc no respondió: los sleepers no usan la señal de mercado', false);
  const trendOk = !isErr(trAdd) && Array.isArray(trAdd);
  ok('tendencias_24h', trendOk, trendOk ? `${trAdd.length} jugadores en tendencia de altas` : 'Sleeper no entregó tendencias: waivers sin datos de altas', false);
  const addMap = {}, dropMap = {};
  if (trendOk) trAdd.forEach((x) => (addMap[x.player_id] = x.count));
  if (!isErr(trDrop) && Array.isArray(trDrop)) trDrop.forEach((x) => (dropMap[x.player_id] = x.count));

  // ---- 8. Cálculos de la app (mismas reglas)
  const isHurt = (p) => BADINJ.includes(p.inj);
  const onBye = (p) => !!(p.bye && p.bye === wk);
  const ssPr = (p) => { if (p.proj != null) return p.proj; let v = p.form; if (p.dvp) v *= 1 + ((16.5 - p.dvp.rk) / 16.5) * 0.12; return v; };
  const per = startersPerPos();
  const g = {};
  POS.forEach((ps) => {
    const list = Object.values(P).filter((p) => p.pos === ps && p.team && !isHurt(p) && !onBye(p) && (p.games > 0 || (p.proj != null && p.proj > 0)))
      .map((p) => { p._pr = ssPr(p); return p; }).filter((p) => p._pr > 0).sort((a, b) => b._pr - a._pr);
    const N = Math.max(1, per[ps]);
    list.forEach((p, i) => { p._rk = i + 1; p._tier = i < N * 0.5 ? 'elite' : i < N ? 'start' : i < N * 1.5 ? 'duda' : 'sit'; });
    g[ps] = list;
  });
  const avgRk = {};
  POS.forEach((ps) => Object.values(P).filter((p) => p.pos === ps && p.games >= 3).sort((a, b) => b.avg - a.avg).forEach((p, i) => (avgRk[p.id] = i + 1)));
  const sorp = [], tramp = [];
  POS.forEach((ps) => {
    const N = Math.max(1, per[ps]);
    g[ps].forEach((p) => {
      if (p.games < 3) return; const d = p._pr - p.avg, th = Math.max(2, 0.15 * p.avg), ar = avgRk[p.id] || 999;
      if (d >= th && p._rk <= N * 1.2 && ar > N) sorp.push(p);
      if (-d >= th && ar <= N && p._rk > ar) tramp.push(p);
    });
  });
  sorp.sort((a, b) => (b._pr - b.avg) - (a._pr - a.avg));
  tramp.sort((a, b) => (a._pr - a.avg) - (b._pr - b.avg));

  // ---- 9. Salida pública
  const dvpTxt = (p) => (!p.dvp ? null : p.dvp.rk <= 8 ? 'favorable' : p.dvp.rk >= 25 ? 'difícil' : 'neutral');
  const out = (p) => {
    const falta = [];
    if (p.proj == null) falta.push('proyeccionPPR');
    if (!p.opp) falta.push('rival');
    if (!p.dvp) falta.push('defensaRival');
    return {
      jugador: p.name, posicion: p.pos, equipo: p.team || null,
      rival: p.opp || null,
      proyeccionPPR: p.proj,
      puntosEstimados: r1(p._pr ?? ssPr(p)),
      origenEstimado: p.proj != null ? 'proyeccion_sleeper' : 'forma_reciente_ajustada_por_rival',
      promedioPPR: p.games ? r1(p.avg) : null,
      ultimos3PPR: p.games ? r1(p.l3) : null,
      partidosJugados: p.games,
      defensaRival: p.dvp ? { lugarQueMasPermite: p.dvp.rk, puntosPermitidosPorPartido: r1(p.dvp.pts), lectura: dvpTxt(p) } : null,
      lesion: p.inj || null,
      semanaDescanso: p.bye,
      camposFaltantes: falta,
    };
  };
  const vsTxt = (p) => (p.opp ? ` contra ${p.opp}${p.dvp ? ` (defensa ${dvpTxt(p)}: ${p.dvp.rk}° que más puntos permite a ${p.pos}, ${r1(p.dvp.pts)} por partido)` : ''}` : '');
  const estTxt = (p) => (p.proj != null ? `proyección de ${r1(p.proj)} pts PPR` : `estimado de ${r1(p._pr)} pts por forma reciente`);

  const rankings = {};
  RANK_POS.forEach((ps) => {
    rankings[ps] = g[ps].slice(0, top ? Math.min(top, RANK_DEPTH[ps]) : RANK_DEPTH[ps]).map((p) => ({
      rank: p._rk, ...out(p), nivel: TIER_TXT[p._tier],
      justificacion: `${ps}${p._rk} de la semana por ${estTxt(p)}${vsTxt(p)}; promedia ${r1(p.avg)} en ${p.games} partidos y ${r1(p.l3)} en los últimos 3.`,
    }));
    if (!rankings[ps].length) faltantes.push({ campo: `rankings.${ps}`, motivo: 'sin jugadores con datos suficientes' });
  });

  const arrancar = sorp.slice(0, 10).map((p) => ({ ...out(p), rankSemana: `${p.pos}${p._rk}`, recomendacion: 'Arrancar', nivel: TIER_TXT[p._tier],
    justificacion: `${cap(estTxt(p))}${vsTxt(p)}, ${r1(p._pr - p.avg)} pts arriba de su promedio de ${r1(p.avg)}. Esta semana queda como ${p.pos}${p._rk}, nivel titular en una liga de ${LIGA.equipos}.` }));
  const sentar = tramp.filter((p) => p._tier === 'duda' || p._tier === 'sit').slice(0, 10).map((p) => ({ ...out(p), rankSemana: `${p.pos}${p._rk}`, recomendacion: 'Sentar', nivel: TIER_TXT[p._tier],
    justificacion: `Suele ser ${p.pos}${avgRk[p.id]} por promedio (${r1(p.avg)}), pero esta semana: ${estTxt(p)}${vsTxt(p)}. Cae a ${p.pos}${p._rk}, por debajo de lo que alinea una liga de ${LIGA.equipos}.` }));
  const riesgo = tramp.filter((p) => p._tier === 'elite' || p._tier === 'start').slice(0, 10).map((p) => ({ ...out(p), rankSemana: `${p.pos}${p._rk}`, recomendacion: 'Arrancar con expectativas bajas', nivel: TIER_TXT[p._tier],
    justificacion: `Promedia ${r1(p.avg)} (${p.pos}${avgRk[p.id]} por promedio), pero esta semana: ${estTxt(p)}${vsTxt(p)}, ${r1(p.avg - p._pr)} pts menos de lo normal. Sigue siendo titular, con riesgo de decepcionar.` }));

  // Sleepers: mismas señales que el tablero. Sin liga no se sabe quién está libre,
  // así que se consideran jugadores fuera del nivel titular por promedio.
  const injStar = {};
  Object.values(P).filter((p) => isHurt(p) && p.team && ((mk[p.id] && mk[p.id].v >= 3000) || (avgRk[p.id] || 999) <= per[p.pos])).forEach((p) => { const k = p.team + '|' + p.pos; if (!injStar[k] || (injStar[k].avg || 0) < p.avg) injStar[k] = p; });
  const sleepers = Object.values(P).filter((p) => !isHurt(p) && p.team && (p.games > 0 || mk[p.id]) && (avgRk[p.id] || 999) > per[p.pos] * 1.5 && RANK_POS.includes(p.pos))
    .map((p) => {
      const why = []; let sc = 0;
      if (p.games >= 3 && p.avg > 0 && p.l3 >= p.avg * 1.3 && p.l3 >= 6) { why.push(`Últimos 3 partidos: ${r1(p.l3)} pts vs ${r1(p.avg)} de promedio`); sc += p.l3 - p.avg; }
      if (mk[p.id] && mk[p.id].tr > 0) { why.push('Su valor de mercado viene subiendo (FantasyCalc, últimos 30 días)'); sc += Math.min(6, mk[p.id].tr / 100); }
      if ((addMap[p.id] || 0) >= 1000) { why.push(`${addMap[p.id].toLocaleString('es-MX')} altas en Sleeper en 24 h`); sc += Math.min(6, Math.log10(addMap[p.id])); }
      const st = injStar[p.team + '|' + p.pos]; if (st && st.id !== p.id) { why.push(`${st.name} (${st.inj}) está fuera: puede heredar carga de trabajo`); sc += 5; }
      if (p.proj != null && p.proj >= Math.max(8, p.avg * 1.2)) { why.push(`Proyección de ${r1(p.proj)} pts PPR esta semana`); sc += 2; }
      return { p, why, sc };
    }).filter((x) => x.why.length >= 2 || (x.why.length === 1 && x.sc >= 5)).sort((a, b) => b.sc - a.sc).slice(0, 10)
    .map(({ p, why }) => ({ ...out(p), senales: why, justificacion: why.join('. ') + '.' }));

  const waivers = trendOk ? trAdd.map((x) => P[x.player_id]).filter((p) => p && !isHurt(p) && RANK_POS.concat(['K', 'DEF']).includes(p.pos))
    .slice(0, 15).map((p) => ({ ...out(p), altas24h: addMap[p.id] || 0, bajas24h: dropMap[p.id] || 0, descansaEstaSemana: onBye(p),
      justificacion: `${(addMap[p.id] || 0).toLocaleString('es-MX')} altas en Sleeper en las últimas 24 h${p.games ? `; promedia ${r1(p.avg)} pts PPR y ${r1(p.l3)} en los últimos 3` : ''}${p.proj != null ? `; proyección de ${r1(p.proj)} esta semana` : ''}${onBye(p) ? '; ojo: descansa esta semana' : ''}.` })) : [];
  if (!waivers.length) faltantes.push({ campo: 'waivers', motivo: trendOk ? 'sin jugadores sanos en tendencia' : 'Sleeper no entregó tendencias' });
  if (!sleepers.length) faltantes.push({ campo: 'sleepers', motivo: 'ningún jugador cumple las señales esta semana' });
  if (!projOk) faltantes.push({ campo: 'proyeccionPPR', motivo: 'Sleeper no entregó proyecciones de la semana; se usan estimados por forma (campo origenEstimado)' });
  if (!schedOk) faltantes.push({ campo: 'rival / defensaRival', motivo: 'Sleeper no entregó el calendario' });

  const criticosFallan = chequeos.filter((c) => c.critico && !c.ok);
  return {
    esquema: SCHEMA,
    app: 'RodoPicks Fantasy NFL',
    sitio: 'https://rodopicks.netlify.app',
    temporada: season,
    semana: wk,
    tipoTemporada: state.season_type || null,
    generadoEn: now.toISOString(),
    datosHasta: { ultimaSemanaConEstadisticas: lastStats, proyeccionesDeLaSemana: projOk ? wk : null },
    formato: {
      puntuacion: 'PPR (1 punto por recepción)',
      supuestosLiga: { equipos: LIGA.equipos, alineacion: LIGA.alineacion },
      nota: 'Contenido general para difusión: no usa ninguna liga ni usuario. Los niveles (titular, flex, banca) suponen una liga de 12 equipos.',
    },
    validacion: {
      estado: criticosFallan.length ? 'parcial' : 'ok',
      resumen: criticosFallan.length ? `Revisar: ${criticosFallan.map((c) => c.chequeo).join(', ')}` : 'Todos los chequeos críticos pasaron',
      chequeos, camposFaltantes: faltantes,
    },
    fuentes,
    descansan: { semana: wk, equipos: season === '2026' ? Object.keys(BYE2026).filter((t) => BYE2026[t] === wk) : null },
    rankings,
    startSit: { arrancar, sentar, criterio: 'Arrancar: proyectados muy arriba de su promedio y en nivel titular. Sentar: titulares habituales que esta semana caen a nivel flex o banca.' },
    waivers,
    sleepers,
    riesgoDeDecepcionar: riesgo,
    avisoLegal: 'Datos públicos de Sleeper y FantasyCalc. Contenido de entretenimiento; las proyecciones no son garantía.',
  };
}
