/**
 * Where loading time goes. `step(label)` closes the step that was running and starts
 * `label`; `report()` prints every step once the app is ready, longest first. Cheap
 * enough to leave in: a handful of clock reads per load. Read in the console, or by the
 * load check (window.__loadTimes).
 */
const t0 = performance.now();
let current = null, at = t0;
const steps = [];

export function step(label) {
  const now = performance.now();
  if (current) steps.push([current, now - at]);
  current = label; at = now;
}

export function report() {
  step(null);
  const total = performance.now() - t0;
  window.__loadTimes = { total, steps: steps.map(([l, ms]) => [l, Math.round(ms)]) };
  const top = [...steps].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, ms]) => `${l} ${(ms / 1000).toFixed(1)} s`).join(', ');
  console.info(`[sharir] ready in ${(total / 1000).toFixed(1)} s. Longest: ${top}`);
}
