/**
 * Feature switches.
 *
 * Nothing here deletes data or code. The female anatomy still ships in extra.glb, the Hindi
 * names still ship in hindi.json, the cell and molecule models and every "What happens if"
 * file are still in the repo. These flags only decide whether the UI offers them. Flip one
 * back and the feature returns exactly as it was.
 *
 *   female:     the female meshes are procedural stand-ins, not scanned anatomy. Off until
 *               there is a real female dataset behind them.
 *   hindi:      the Hindi names cover ~78% of parts, so the rest fall back to English and the
 *               labels read half-translated. Off until the coverage is complete.
 *   micro:      the "Tissue & cell level" buttons in the inspector, which open the cell and
 *               tissue models. Off until those models have been reviewed for accuracy.
 *   molecules:  "The molecule in 3D" on a "What happens if" page. Off until the molecule
 *               structures have been reviewed.
 */
export const FEATURES = {
  female: false,
  hindi: false,
  micro: false,
  molecules: false,
};

/**
 * "What happens if" categories kept out of the app. The files stay in src/data/effects/;
 * they are left out of the list, the search and any saved combination. Empty the list to
 * bring them back.
 *
 *   medicine, drug: not yet reviewed under the authoring playbook (docs/AUTHORING.md,
 *                   part B). A wrong number on a prescription medicine or a steroid is the
 *                   costliest mistake the app could make.
 */
export const HIDDEN_EFFECT_CATEGORIES = ['medicine', 'drug'];
