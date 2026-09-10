/** User-facing body systems (ordered). `glb` = which model file feeds it. */
export const SYSTEMS = [
  { key: 'skeletal',      label: 'Skeleton',          hi: 'कंकाल तंत्र',        color: '#e9dfc9', glb: 'skeletal',       vis: true,  op: 1 },
  { key: 'joints',        label: 'Joints & ligaments', hi: 'जोड़ और स्नायु',     color: '#dfe6ea', glb: 'joints',         vis: false, op: 1 },
  { key: 'muscular',      label: 'Muscles',           hi: 'पेशी तंत्र',         color: '#a6403a', glb: 'muscular',       vis: true,  op: 1 },
  { key: 'nervous',       label: 'Nervous system',    hi: 'तंत्रिका तंत्र',     color: '#e9c95c', glb: 'nervous',        vis: true,  op: 1 },
  { key: 'senses',        label: 'Sense organs',      hi: 'ज्ञानेंद्रियाँ',      color: '#f2f2f2', glb: 'nervous',        vis: true,  op: 1 },
  { key: 'cardiovascular',label: 'Heart & vessels',   hi: 'हृदय और रक्त वाहिकाएँ', color: '#c7332f', glb: 'cardiovascular', vis: true,  op: 1 },
  { key: 'lymphoid',      label: 'Lymph & immune',    hi: 'लसीका तंत्र',        color: '#79b06a', glb: 'lymphoid',       vis: false, op: 1 },
  { key: 'respiratory',   label: 'Lungs & airways',   hi: 'श्वसन तंत्र',        color: '#d99ba1', glb: 'visceral',       vis: true,  op: 1 },
  { key: 'digestive',     label: 'Digestive',         hi: 'पाचन तंत्र',         color: '#d8a291', glb: 'visceral',       vis: true,  op: 1 },
  { key: 'urinary',       label: 'Urinary',           hi: 'मूत्र तंत्र',        color: '#7c2e2a', glb: 'visceral',       vis: true,  op: 1 },
  { key: 'reproductive',  label: 'Reproductive',      hi: 'प्रजनन तंत्र',       color: '#c26d80', glb: 'visceral',       vis: true,  op: 1 },
  { key: 'endocrine',     label: 'Endocrine glands',  hi: 'अंतःस्रावी ग्रंथियाँ', color: '#d9b262', glb: 'visceral',       vis: true,  op: 1 },
  { key: 'cavities',      label: 'Membranes & cavities', hi: 'झिल्लियाँ और गुहाएँ', color: '#e8dccb', glb: 'visceral',    vis: false, op: 0.5 },
  { key: 'integumentary', label: 'Skin & hair',       hi: 'त्वचा और बाल',       color: '#a8673f', glb: 'regions',        vis: true,  op: 0.16 },
  { key: 'references',    label: 'Reference lines',   hi: 'संदर्भ रेखाएँ',      color: '#8fb3ff', glb: 'references',     vis: false, op: 0.8 },
];

export const SYSTEM_BY_KEY = Object.fromEntries(SYSTEMS.map(s => [s.key, s]));

export const GLB_FILES = ['skeletal', 'muscular', 'nervous', 'cardiovascular', 'visceral', 'joints', 'lymphoid', 'regions', 'references', 'extra'];

/** Presets for the Systems panel */
export const PRESETS = [
  { key: 'all',      label: 'Everything',      hi: 'सब कुछ',    on: SYSTEMS.filter(s => !['references'].includes(s.key)).map(s => s.key) },
  { key: 'skeleton', label: 'Skeleton only',   hi: 'सिर्फ़ कंकाल', on: ['skeletal'] },
  { key: 'muscles',  label: 'Muscles',         hi: 'पेशियाँ',    on: ['skeletal', 'muscular'] },
  { key: 'nervous',  label: 'Nervous',         hi: 'तंत्रिका',   on: ['nervous', 'senses'] },
  { key: 'cardio',   label: 'Circulation',     hi: 'रक्त संचार', on: ['cardiovascular'] },
  { key: 'organs',   label: 'Organs',          hi: 'अंग',        on: ['respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine'] },
  { key: 'immune',   label: 'Immune',          hi: 'प्रतिरक्षा', on: ['lymphoid'] },
  { key: 'skin',     label: 'Skin',            hi: 'त्वचा',      on: ['integumentary'] },
];

/** Indian skin tones (Fitzpatrick IV–VI) for the skin layer */
export const SKIN_TONES = [
  { key: 'wheatish', label: 'Wheatish',  hex: '#c58c5b' },
  { key: 'medium',   label: 'Medium',    hex: '#a8673f' },
  { key: 'dusky',    label: 'Dusky',     hex: '#7f4a2c' },
  { key: 'deep',     label: 'Deep',      hex: '#5a331f' },
];
