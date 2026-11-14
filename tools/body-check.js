const s = await import('/src/dev/inside.js');
const { stretched } = await import('/src/dev/posecheck.js');
const { EXERCISES } = await import('/src/data/exercises.js');
app.setMode('move');
const sys = ['nervous', 'cardiovascular'];
const agg = { skin: new Map(), muscle: new Map(), apart: new Map(), stretch: new Map() };
const add = (m, k, val, id) => { const e = m.get(k) || { v: 0, in: new Set() }; e.v = Math.max(e.v, val); e.in.add(id); m.set(k, e); };
const nm = (p) => p.n + (p.side ? '.' + p.side : '');
const T0 = performance.now();
const ONLY = window.__only || null;
for (const ex of EXERCISES) {
  if (ONLY && !ONLY.includes(ex.id)) continue;
  app.setExercise(ex.id); await new Promise(r => setTimeout(r, 30));
  for (const t of (window.__moments || [0.25, 0.5])) {
    app.exercise.seek(t);
    for (const r of s.outOfBody(app, sys)) if (r.mm >= 8) add(agg.skin, nm(r.part), r.n * r.mm, ex.id);
    for (const r of s.outOfBody(app, sys, { ref: 'muscular', limit: 0.012 })) if (r.mm >= 15) add(agg.muscle, nm(r.part), r.n * r.mm, ex.id);
    for (const r of s.pulledApart(app, sys)) add(agg.apart, r.pair, r.mm, ex.id);
    for (const q of sys) for (const p of stretched(app, q, { ratio: 2.0 }).parts) add(agg.stretch, p.replace(/ \d+$/, ''), +p.match(/(\d+)$/)[1], ex.id);
  }
}
const top = (m, n) => [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, n).map(([k, e]) => `${e.v}\t${k}\t(${e.in.size})`).join('\n');
const tot = (m) => [...m.values()].reduce((a, e) => a + e.v, 0);
return `secs ${Math.round((performance.now() - T0) / 1000)}\nTOTALS skin ${tot(agg.skin)} muscle ${tot(agg.muscle)} apart ${tot(agg.apart)} stretch ${tot(agg.stretch)}\n== out of skin\n${top(agg.skin, 15)}\n== off the muscles\n${top(agg.muscle, 25)}\n== pulled apart (mm)\n${top(agg.apart, 20)}\n== stretched edges\n${top(agg.stretch, 15)}`;
