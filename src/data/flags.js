/**
 * Feature switches.
 *
 * Nothing here deletes data. The female anatomy still ships in extra.glb and the Hindi
 * names still ship in hindi.json — these flags only decide whether the UI offers them.
 * Flip one back to true and the feature returns exactly as it was.
 *
 *   female: the female meshes are procedural stand-ins, not scanned anatomy. Off until
 *           there is a real female dataset behind them.
 *   hindi:  the Hindi names cover ~78% of parts, so the rest fall back to English and the
 *           labels read half-translated. Off until the coverage is complete.
 */
export const FEATURES = {
  female: false,
  hindi: false,
};
