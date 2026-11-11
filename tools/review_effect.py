"""
Review sheet for one "What happens if" file: everything a reviewer has to check, on one
screen, with the places mistakes have actually been found marked.

    python tools/review_effect.py <id>            one file
    python tools/review_effect.py <id> --strict   exit 1 if anything is marked
    python tools/review_effect.py --all --strict  every file (marks only)

The validator (validate_effects.py) checks the shape of a file. It cannot know whether a
number is true. This cannot either, but it knows where the untrue ones were hiding in the
2026-11-10 audit, and it puts every claim in front of the reviewer so none is skipped:

  LOSS      the body is drawn losing tissue (shrunk or thinned). Is that the typical result
            at THIS dose and THIS time, or only the worst case?
  DOSE      the number is borrowed from heavier users, athletes or patients than the file
            is about. The label must say whose number it is.
  TIME      a risk that takes decades, shown at an early step.
  BIG       a large number (a multiple, or 40% and over). It needs a named source.
  HEADLINE  the headline carries a number. It must agree with the metrics under it.
  HARM      a strong red glow early on. Harm from a habit builds; check it is not front-loaded.
  ABSOLUTE  "always", "never", "cures". Bodies vary; say how often.
  SOURCE    fewer than two sources, or a source with no year.
  NEUTRAL   "does not build" or "does not improve" shown as harm. Not helping is not harming.
"""
import json, glob, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EFFECTS = os.path.join(ROOT, 'src', 'data', 'effects')
STRICT = '--strict' in sys.argv
ALL = '--all' in sys.argv
ids = [a for a in sys.argv[1:] if not a.startswith('--')]
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

BORROWED = re.compile(r'\b(heavy|chronic|long-term|lifelong|competitive|elite|athletes?|racquet|professional|patients?|in users|daily users|dependent)\b', re.I)
DECADES = re.compile(r'\b(cancer|cirrhosis|copd|emphysema|dementia|stroke|heart attack|mortality|death|osteoporosis|fracture)\b', re.I)
ABSOLUTE = re.compile(r'\b(always|never|cures?|guaranteed|everyone|nobody|all people|no risk|completely safe|100%)\b', re.I)
NOT_HELPING = re.compile(r'\b(does not (build|stimulate|improve|increase)|no (benefit|stimulus|gain)|unchanged|leaves .* where it started)\b', re.I)
BIG = re.compile(r'(\d+(\.\d+)?\s*[×x]\b)|((?<![\d.])([4-9]\d|\d{3,})\s*%)')
KIND = {'positive': '+', 'negative': '-', 'strain': '~', 'neutral': '='}
EARLY = {'1d', '1w', '30d', '60d'}


def review(path):
    d = json.load(open(path, encoding='utf-8'))
    marks, lines = [], []
    dose = d.get('dose', '')
    lines.append(f"## {d['id']}  [{d.get('category')} | evidence: {d.get('evidence')}]")
    lines.append(f"   {d['name']['en']}")
    lines.append(f"   DOSE: {dose}")
    lines.append(f"   SUMMARY: {d['summary']['en']}")
    src = d.get('sources', [])
    for s in src:
        lines.append(f"   SOURCE: {s}")
    if len(src) < 2:
        marks.append('SOURCE   fewer than two sources')
    for s in src:
        if not re.search(r'(19|20)\d\d', s):
            marks.append(f'SOURCE   no year: "{s[:70]}"')
    if ABSOLUTE.search(d['summary']['en']):
        marks.append(f'ABSOLUTE in the summary: "{ABSOLUTE.search(d["summary"]["en"]).group(0)}"')
    for step in d['timeline']:
        t = step['t']
        lines.append(f"\n   {t:>4}  \"{step['headline']}\"")
        if re.search(r'\d', step['headline']):
            marks.append(f'HEADLINE {t}: "{step["headline"]}" carries a number; check it against the metrics below it')
        seen = set()
        for e in step['effects']:
            vis = e.get('visual') or {}
            m = e.get('metric')
            bit = f"{e['target']}{KIND.get(e['kind'], '?')}{e['intensity']}"
            if vis:
                bit += ' ' + json.dumps(vis).replace('"', '')
            lines.append(f"         {bit}" + (f"   {{{m['label']}: {m['value']}}}" if m else ''))
            lines.append(f"            {e['note']}")
            where = f"{t} {e['target']}"
            if e['target'] in seen:
                marks.append(f'{where}: the same target twice in one step')
            seen.add(e['target'])
            if (vis.get('scale', 1) < 1 or vis.get('opacity', 1) < 0.85) and e['kind'] in ('negative', 'strain'):
                marks.append(f"LOSS     {where}: drawn {json.dumps(vis)}. Typical at this dose and time, or the worst case?")
            if e['kind'] == 'negative' and e['intensity'] >= 0.75 and t in EARLY:
                marks.append(f"HARM     {where}: intensity {e['intensity']} already at {t}")
            text = e['note'] + ' ' + (m['label'] + ' ' + m['value'] if m else '')
            if m and BORROWED.search(m['label'] + ' ' + e['note']) and not BORROWED.search(m['label']):
                marks.append(f"DOSE     {where}: the note speaks of {BORROWED.search(e['note']).group(0)!r} but the label \"{m['label']}\" does not say whose number it is")
            if m and BIG.search(m['value']):
                marks.append(f"BIG      {where}: \"{m['label']}: {m['value']}\". Which source is this from?")
            if DECADES.search(text) and t in EARLY | {'6m', '1y'} and e['kind'] == 'negative' and m:
                marks.append(f"TIME     {where}: \"{m['label']}: {m['value']}\" names a long-term outcome at {t}")
            if ABSOLUTE.search(e['note']):
                marks.append(f"ABSOLUTE {where}: \"{ABSOLUTE.search(e['note']).group(0)}\"")
            if e['kind'] == 'negative' and NOT_HELPING.search(e['note']):
                marks.append(f"NEUTRAL  {where}: the note says it does not help, but it is shown as harm")
    return d['id'], lines, marks


files = sorted(glob.glob(os.path.join(EFFECTS, '*', '*.json')))
if not ALL:
    if not ids:
        print(__doc__); sys.exit(2)
    files = [f for f in files if os.path.splitext(os.path.basename(f))[0] in ids]
    if not files:
        print('No such file. Ids are the file names in src/data/effects/*/ without .json'); sys.exit(2)

total = 0
for f in files:
    eid, lines, marks = review(f)
    if not ALL:
        print('\n'.join(lines))
        print('\n   ---- marked for the reviewer ----' if marks else '\n   Nothing marked. Every number above still has to be checked against its source.')
    if marks:
        if ALL:
            print(f'\n{eid}')
        for m in marks:
            print('   ' + m)
    total += len(marks)
if ALL:
    print(f'\n{len(files)} files, {total} marks. A mark is a place to look, not a mistake.')
sys.exit(1 if STRICT and total else 0)
