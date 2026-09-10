# Age Timeline — Content Schema (v1)

The app has an **age slider (0–90 years)** and a **sex toggle (male/female)**. As the slider moves, the 3D body changes size/proportion and the affected systems glow, with text explaining what is changing at that age. Built for an **Indian audience** — use Indian reference data where it exists (IAP 2015 growth charts, ICMR-NIN 2020/2024 reference body weights, NFHS-5 adult heights: men ~165 cm, women ~152 cm; Indian puberty timing; earlier onset of diabetes/CVD in South Asians; high vitamin D & B12 deficiency prevalence; menopause median ~46 yrs in India vs ~51 in the West).

Output ONE file: `src/data/age.json`

```json
{
  "anthro": {
    "male":   [ { "age": 0, "height_cm": 50, "weight_kg": 2.9, "head_ratio": 0.25 }, { "age": 1, ... }, ... up to 90 ],
    "female": [ ... ]
  },
  "stages": [
    {
      "id": "newborn",
      "from": 0, "to": 1,
      "name": { "en": "Newborn & infant", "hi": "नवजात और शिशु" },
      "summary": { "en": "2–3 sentences on what the body is doing at this age.", "hi": "..." },
      "indian_context": "1–2 sentences.",
      "changes": [
        {
          "target": "skull",
          "sex": "both",
          "kind": "neutral",
          "intensity": 0.6,
          "note": "Fontanelles open; skull bones unfused; brain grows fastest here.",
          "visual": { "opacity": 0.85 },
          "metric": { "label": "Brain weight", "value": "~350 g → ~900 g by age 1" }
        }
      ]
    }
  ]
}
```

### Rules

- `anthro`: give a value for every integer age 0–20, then every 5 years (25, 30, … 90). `height_cm` and `weight_kg` = **Indian median** (IAP 2015 for 0–18; ICMR-NIN reference adult; then gradual adult decline: height −1 cm/decade after 40, more after 70; weight peaks 40–55 then falls). `head_ratio` = head height ÷ total height (newborn ~0.25, age 6 ~0.17, adult ~0.13).
- `stages`: cover the whole life, contiguous, ~14–16 stages: newborn (0–1), toddler (1–3), early childhood (3–6), childhood (6–10), pre-puberty (10–12), puberty (12–15; note Indian girls' menarche ~12.5, boys later), adolescence (15–18), young adult (18–25), prime (25–35), 35–45, 45–55 (perimenopause/menopause for women; andropause trend for men), 55–65, 65–75, 75–85, 85–90.
- Each stage: 5–12 `changes`, spanning systems (bones, muscle, brain, heart, skin, hormones, reproductive, immune, senses, teeth). Use `sex`: `male` | `female` | `both`.
- `target`: MUST be one of the target keys listed in `docs/EFFECTS-SCHEMA.md` (same vocabulary). `kind`: `positive` (growth/gain), `negative` (loss/decline), `strain`, `neutral` (change). `intensity` 0.1–1.0.
- `visual` optional: `{ "scale": 0.9–1.1 }` for real size changes at that age (e.g. thymus involution scale 0.6 after 40; muscle 0.92 at 70; prostate 1.1 after 60), `{ "opacity": 0.35–1 }` for density loss (bone after 50, esp. postmenopausal women: 0.7–0.8; 0.6 at 80).
- `metric` optional but encouraged: real numbers (bone mass peak ~25–30; muscle −3–8% per decade after 30; brain volume −0.2–0.5%/yr after 40; max HR ≈ 220−age; VO₂max decline ~10%/decade; lens presbyopia ~40+; teeth: 20 milk teeth by 3 yrs, permanent from ~6, wisdom 17–25).
- Hindi in `name.hi` and `summary.hi` only. Devanagari, natural spoken Hindi.
- No invented data. If Indian-specific numbers are unavailable, use WHO/global and say "global" in the note.
- Valid JSON, no comments, no trailing commas.
