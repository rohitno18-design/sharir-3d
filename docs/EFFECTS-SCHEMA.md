# Effects Simulator — Content Schema (v1)

This app shows, on a 3D human body, **what happens inside the body when you do X** (drink 5 L water/day, take creatine, run daily, eat sugar daily, take steroids, a medicine…) across a fixed timeline:

`1d` (1 day) → `1w` (1 week) → `30d` → `60d` → `6m` → `1y` → `5y`

Each intervention is ONE JSON file: `src/data/effects/<category>/<id>.json`.

Audience: **Indian general public** (health-app content, Instagram reels, explainer videos). Must be **accurate, evidence-based, dose-specific, honest about uncertainty**. Never sensational. Never invent numbers. When a number is a typical range from literature, say so ("typically", "~"). Physiology first, then the visible effect. Write like a sharp doctor explaining to a smart friend.

## File format

```json
{
  "id": "creatine-5g-daily",
  "name": { "en": "Creatine 5 g every day", "hi": "रोज़ 5 ग्राम क्रिएटिन" },
  "category": "supplement",
  "icon": "🧪",
  "dose": "5 g creatine monohydrate daily with a meal or drink, no loading phase. Any time of day.",
  "molecule": "creatine",
  "summary": {
    "en": "2–3 sentences. What it is, what it does at the mechanism level, what a person will actually notice.",
    "hi": "वही बात हिंदी में, सरल भाषा। (2–3 वाक्य)"
  },
  "indian_context": "1–3 sentences specific to India: vegetarian diets (low natural creatine/B12), heat & humidity, South-Asian phenotype (higher visceral fat at lower BMI, insulin resistance), typical Indian foods/habits, availability, price, myths common in India.",
  "evidence": "strong",
  "sources": [
    "Kreider RB et al. ISSN position stand: creatine supplementation. J Int Soc Sports Nutr. 2017",
    "ICMR-NIN Dietary Guidelines for Indians 2024"
  ],
  "caution": "Who should not do this / when to see a doctor. Keep it real. Empty string if none.",
  "timeline": [
    {
      "t": "1d",
      "headline": "Short line for the timeline header (≤ 70 chars)",
      "effects": [
        {
          "target": "skeletal-muscle",
          "kind": "positive",
          "intensity": 0.2,
          "note": "1–2 sentences: what is physically happening here right now.",
          "metric": { "label": "Muscle creatine stores", "value": "+1–2%" }
        }
      ]
    },
    { "t": "1w", "headline": "...", "effects": [ ... ] },
    { "t": "30d", "headline": "...", "effects": [ ... ] },
    { "t": "60d", "headline": "...", "effects": [ ... ] },
    { "t": "6m", "headline": "...", "effects": [ ... ] },
    { "t": "1y", "headline": "...", "effects": [ ... ] },
    { "t": "5y", "headline": "...", "effects": [ ... ] }
  ]
}
```

### Field rules

- `id`: kebab-case, unique, equals the filename without `.json`.
- `category`: one of `food`, `drink`, `supplement`, `exercise`, `habit`, `sleep`, `drug`, `medicine`, `substance`.
- `icon`: one emoji.
- `molecule`: optional. Only use a key from this list (these have real 3D structures in the app): `creatine, glucose, sucrose, fructose, caffeine, ethanol, testosterone, nicotine, water, cholesterol, vitamin-d3, leucine, ibuprofen, paracetamol, metformin, cortisol, melatonin, dopamine, serotonin, adrenaline, epa, dha, vitamin-c, vitamin-b12, ferrous, calcium-carbonate, sodium-chloride, lactic-acid, urea, atp, beta-alanine, whey-bcaa-valine, isoleucine, trans-fat-elaidic, palmitic-acid, oleic-acid, carbon-monoxide, nandrolone, oxandrolone, stanozolol, thc, morphine, aspirin, omeprazole, amlodipine, atorvastatin, salbutamol, ashwagandha-withaferin, curcumin, piperine, capsaicin, msg-glutamate, sodium-bicarbonate, taurine, glycine, carnitine, hemoglobin-heme, oxygen, carbon-dioxide, glycogen-unit-maltose, cortisone, estradiol, progesterone, thyroxine`. Omit the field if none fits.
- `evidence`: `strong` | `moderate` | `limited` | `mixed`.
- `sources`: 2–5 real, checkable references (author/org, title, journal/body, year). No URLs required. Do NOT fabricate; if unsure of a citation, cite a guideline body (WHO, ICMR-NIN, ACSM, ISSN, NIH, Cochrane) generically.
- `timeline`: MUST contain all 7 steps in order: `1d, 1w, 30d, 60d, 6m, 1y, 5y`. Each step MUST have 1–6 effects. If nothing changes at a step, say so honestly in the headline and carry 1 effect with `kind: "neutral"` and low intensity — but usually something *is* happening (adaptation, plateau, cumulative risk).
- `effects[].target`: MUST be one of the TARGET KEYS below. Use the most specific one that is true. Use 1–6 per step; the first effect is the "hero" for that step.
- `effects[].kind`: `positive` (benefit), `negative` (harm/damage), `strain` (load/stress, not yet damage), `neutral` (change with no clear valence, e.g. adaptation, water shift).
- `effects[].intensity`: 0.1–1.0. How strongly the viewer should glow. Cumulative harm grows over years; acute effects can be high on day 1 and fade.
- `effects[].visual` (optional): `{ "scale": 1.06 }` for real size change (muscle hypertrophy, liver enlargement, heart wall thickening), `{ "opacity": 0.6 }` for density/mass loss (bone, muscle atrophy). Only use when the physical change is real and directionally correct. Range: scale 0.85–1.15, opacity 0.35–1.
- `effects[].metric` (optional): one honest number or range with a label. Prefer well-known figures (e.g., "Resting heart rate −5 to −10 bpm", "VO₂max +10–15%", "HbA1c −0.5 to −1.0%").
- `effects[].note`: 1–2 sentences, plain English, mechanism → visible effect. No Hindi here.

### Language

- `name.hi` and `summary.hi` in Devanagari Hindi (natural, spoken Hindi, not Sanskritised). Everything else English.

### Tone

- Confident, specific, non-preachy. Never "consult your doctor" boilerplate on every step; put it once in `caution` where warranted.
- For illegal or dangerous items (anabolic steroids, gutkha, smoking, alcohol binge): describe the real physiology honestly, both the effects people chase AND the damage. This is education, not endorsement.
- For medicines: describe what the drug does when taken as prescribed, and what long-term use does. Never give dosing advice beyond the standard label range.

## TARGET KEYS (use exactly these strings)

Whole / surface: `whole-body`, `skin`, `hair`, `face`, `hands`, `feet`, `adipose` (body fat, shown on abdominal/gluteal skin regions)

Nervous: `brain`, `cerebral-cortex`, `prefrontal-cortex`, `hippocampus`, `hypothalamus`, `amygdala`, `basal-ganglia`, `cerebellum`, `brainstem`, `spinal-cord`, `peripheral-nerves`, `sciatic-nerve`, `vagus-nerve`, `autonomic-nerves`, `eyes`, `retina`, `ears`, `pituitary`, `pineal`

Cardiovascular: `heart`, `heart-muscle`, `coronary-arteries`, `aorta`, `arteries`, `veins`, `carotid-arteries`, `cerebral-arteries`, `leg-veins`, `blood-vessels`

Respiratory: `lungs`, `airways`, `diaphragm`

Digestive: `mouth`, `teeth`, `tongue`, `salivary-glands`, `esophagus`, `stomach`, `small-intestine`, `large-intestine`, `rectum`, `liver`, `gallbladder`, `pancreas`

Urinary: `kidneys`, `bladder`, `ureters`, `urethra`

Endocrine: `thyroid`, `adrenal-glands`

Reproductive: `testes`, `prostate`, `penis`, `uterus`, `ovaries`, `vagina`, `breasts`

Muscles: `skeletal-muscle` (all), `biceps`, `triceps`, `forearm-muscles`, `deltoids`, `pectorals`, `lats`, `trapezius`, `abs`, `erector-spinae`, `glutes`, `quadriceps`, `hamstrings`, `calves`, `hip-flexors`, `rotator-cuff`, `pelvic-floor`

Skeleton & joints: `bones`, `bone-marrow`, `spine`, `skull`, `ribs`, `pelvis`, `femur`, `tibia`, `joints`, `hip-joint`, `knee-joint`, `shoulder-joint`, `elbow-joint`, `wrist`, `ankle`, `cartilage`, `ligaments`, `tendons`

Immune: `immune-system`, `lymph-nodes`, `spleen`, `thymus`, `tonsils`

## Quality bar (self-check before finishing each file)

1. Every timeline step present, in order, with ≥1 effect.
2. Every `target` is from the list. Every `kind` valid. Intensities in range.
3. No invented statistics. Ranges hedged. Mechanisms correct.
4. Indian context is specific, not generic.
5. Hindi reads like a real person talking.
6. JSON is valid (no trailing commas, no comments).
