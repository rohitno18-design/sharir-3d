"""
Validate every intervention file in src/data/effects/** against docs/EFFECTS-SCHEMA.md,
and check that each `target` actually resolves to real meshes in the built registry.

Usage:  python tools/validate_effects.py [--strict]
        --strict also reports style warnings (long headlines, missing metrics).
Exit code 1 if any hard error is found.
"""
import json, glob, os, re, sys, ast

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EFFECTS = os.path.join(ROOT, 'src', 'data', 'effects')
TARGETS_JS = os.path.join(ROOT, 'src', 'data', 'targets.js')
REGISTRY = os.path.join(ROOT, 'public', 'data', 'registry.json')
STRICT = '--strict' in sys.argv

STEPS = ['1d', '1w', '30d', '60d', '6m', '1y', '5y']
CATEGORIES = {'food', 'drink', 'supplement', 'exercise', 'habit', 'sleep', 'drug', 'medicine', 'substance'}
KINDS = {'positive', 'negative', 'strain', 'neutral'}
EVIDENCE = {'strong', 'moderate', 'limited', 'mixed'}

errors, warnings = [], []


def err(f, msg): errors.append(f'{f}: {msg}')
def warn(f, msg): warnings.append(f'{f}: {msg}')


# ---- target vocabulary, parsed straight out of targets.js so the two can't drift ----
src = open(TARGETS_JS, encoding='utf-8').read()
body = src[src.index('export const TARGETS'):src.index('export const TIMELINE_STEPS')]
TARGET_KEYS = set(re.findall(r"^\s*'([a-z0-9-]+)':\s*\{", body, re.M))
if not TARGET_KEYS:
    print('FATAL: could not parse TARGETS from targets.js'); sys.exit(1)

# ---- molecules that actually have 3D structures ----
mol_path = os.path.join(ROOT, 'public', 'data', 'molecules.json')
MOLECULES = set(json.load(open(mol_path, encoding='utf-8')).keys()) if os.path.exists(mol_path) else set()

files = sorted(glob.glob(os.path.join(EFFECTS, '*', '*.json')))
ids = {}

for path in files:
    f = os.path.relpath(path, ROOT).replace('\\', '/')
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception as e:
        err(f, f'invalid JSON — {e}'); continue

    stem = os.path.splitext(os.path.basename(path))[0]
    if d.get('id') != stem: err(f, f"id {d.get('id')!r} != filename {stem!r}")
    if d.get('id') in ids: err(f, f"duplicate id, also in {ids[d['id']]}")
    ids[d.get('id')] = f

    for k in ('name', 'category', 'summary', 'timeline'):
        if k not in d: err(f, f'missing required field `{k}`')
    if d.get('category') not in CATEGORIES: err(f, f"category {d.get('category')!r} not allowed")
    if 'evidence' in d and d['evidence'] not in EVIDENCE: err(f, f"evidence {d['evidence']!r} not allowed")
    if d.get('molecule') and MOLECULES and d['molecule'] not in MOLECULES:
        err(f, f"molecule {d['molecule']!r} has no 3D structure")
    for k in ('name', 'summary'):
        v = d.get(k)
        if isinstance(v, dict):
            if not v.get('en'): err(f, f'{k}.en missing')
            if not v.get('hi'): err(f, f'{k}.hi missing')
            elif not re.search(r'[ऀ-ॿ]', v['hi']): err(f, f'{k}.hi is not Devanagari')
    srcs = d.get('sources', [])
    if not isinstance(srcs, list) or not (2 <= len(srcs) <= 5): warn(f, f'{len(srcs)} sources (expected 2–5)')
    if d.get('category') in ('drug', 'medicine', 'substance') and not d.get('caution'):
        err(f, 'caution is required for drug/medicine/substance')

    tl = d.get('timeline', [])
    got = [s.get('t') for s in tl]
    if got != STEPS: err(f, f'timeline steps are {got}, expected {STEPS}')
    for step in tl:
        t = step.get('t')
        fx = step.get('effects', [])
        if not (1 <= len(fx) <= 6): err(f, f'step {t}: {len(fx)} effects (expected 1–6)')
        if STRICT and len(step.get('headline', '')) > 70:
            warn(f, f"step {t}: headline {len(step['headline'])} chars (>70)")
        for e in fx:
            tg = e.get('target')
            if tg not in TARGET_KEYS: err(f, f'step {t}: unknown target {tg!r}')
            if e.get('kind') not in KINDS: err(f, f'step {t}: bad kind {e.get("kind")!r}')
            i = e.get('intensity')
            if not isinstance(i, (int, float)) or not (0.1 <= i <= 1.0):
                err(f, f'step {t}/{tg}: intensity {i!r} out of range 0.1–1.0')
            if not e.get('note'): err(f, f'step {t}/{tg}: missing note')
            v = e.get('visual') or {}
            if 'scale' in v and not (0.85 <= v['scale'] <= 1.15):
                err(f, f'step {t}/{tg}: visual.scale {v["scale"]} out of range 0.85–1.15')
            if 'opacity' in v and not (0.35 <= v['opacity'] <= 1):
                err(f, f'step {t}/{tg}: visual.opacity {v["opacity"]} out of range 0.35–1')
            m = e.get('metric')
            if m is not None and (not m.get('label') or not m.get('value')):
                err(f, f'step {t}/{tg}: metric needs both label and value')

# ---- do the targets used actually hit meshes? ----
unresolved = []
if os.path.exists(REGISTRY):
    parts = json.load(open(REGISTRY, encoding='utf-8'))['parts']
    meshes = [p for p in parts if p['k'] == 'mesh']

    def js_regex_to_py(rx):
        return rx.replace('\\b', r'\b')

    rules = {}
    for m in re.finditer(r"^\s*'([a-z0-9-]+)':\s*\{(.+?)\},?\s*$", body, re.M | re.S):
        key, cfg = m.group(1), m.group(2)
        sysm = re.search(r"sys:\s*\[([^\]]*)\]", cfg)
        rem = re.search(r"re:\s*/(.+?)/([a-z]*),", cfg) or re.search(r"re:\s*/(.+?)/([a-z]*)\s*\}", cfg)
        exm = re.search(r"ex:\s*/(.+?)/([a-z]*)\s*[,}]", cfg)
        subm = re.search(r"sub:\s*'([^']*)'", cfg)
        if not sysm or not rem: continue
        systems = [s.strip().strip("'\"") for s in sysm.group(1).split(',') if s.strip()]
        try:
            rx = re.compile(js_regex_to_py(rem.group(1)), re.I)
            ex = re.compile(js_regex_to_py(exm.group(1)), re.I) if exm else None
        except re.error:
            continue
        rules[key] = (systems, rx, ex, subm.group(1) if subm else None)

    used = set()
    for path in files:
        try: d = json.load(open(path, encoding='utf-8'))
        except Exception: continue
        for s in d.get('timeline', []):
            for e in s.get('effects', []):
                if e.get('target'): used.add(e['target'])

    for key in sorted(used):
        if key not in rules: continue
        systems, rx, ex, sub = rules[key]
        n = 0
        for p in meshes:
            if p['sys'] not in systems: continue
            if sub and p.get('sub') != sub: continue
            if not rx.search(p['n']): continue
            if ex and ex.search(p['n']): continue
            n += 1
        if n == 0: unresolved.append(key)

# ---- report ----
print(f'checked {len(files)} intervention files across {len(set(os.path.dirname(f) for f in files))} categories')
print(f'target vocabulary: {len(TARGET_KEYS)} keys')
for e in errors: print('  ERROR  ' + e)
if STRICT:
    for w in warnings: print('  warn   ' + w)
if unresolved:
    print(f'  ERROR  targets that match no mesh in the registry: {unresolved}')
if not errors and not unresolved:
    print('OK — all files valid, every target resolves to real geometry')
sys.exit(1 if (errors or unresolved) else 0)
