"""
Build the part registry + descriptions from Blender-exported JSON + Z-Anatomy descriptions + TA2.
Outputs:
  public/data/registry.json         (all parts, compact)
  public/data/desc/<system>.json    (descriptions per system, lazy loaded)
  build/ref_boxes.json              (reference bboxes for procedural modelling)
"""
import json, re, os, collections, unicodedata
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BUILD = os.path.join(ROOT, 'build')
DESC_DIR = os.path.join(ROOT, 'assets-src', 'zanatomy', 'Resources', 'Descriptions', 'OriginalDescriptions')
TA2 = os.path.join(ROOT, 'assets-src', 'TA2.csv')
OUT_DIR = os.path.join(ROOT, 'public', 'data')
os.makedirs(os.path.join(OUT_DIR, 'desc'), exist_ok=True)

GLBS = ['skeletal', 'joints', 'muscular', 'nervous', 'cardiovascular', 'lymphoid', 'visceral', 'regions', 'references', 'extra']

SUFFIX_RE = re.compile(r'^(?P<base>.+?)(?P<suf>\.(?:l|r|g|j|t|s|i|ol|or|el|er|o|e|e1l|e1r|e2l|e2r))?(?P<dup>\.\d{3})?$')


def parse_name(name):
    m = SUFFIX_RE.match(name)
    base, suf, dup = m.group('base'), (m.group('suf') or '')[1:], m.group('dup')
    return base, suf, dup


def display(base):
    b = base.strip()
    if b.startswith('(') and b.endswith(')'):
        b = b[1:-1]
    return b


def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = s.lower().strip()
    s = re.sub(r'[\(\)\[\]]', '', s)
    s = re.sub(r'\s+', ' ', s)
    return s


# ---------- descriptions ----------
desc_files = {}
for f in os.listdir(DESC_DIR):
    if f.endswith('.txt'):
        desc_files[norm(os.path.splitext(f)[0])] = os.path.join(DESC_DIR, f)

DESC_ALIASES = {
    'caecum': 'cecum', 'fundus of uterus': 'uterus', 'body of uterus': 'uterus',
    'cavity of uterus': 'uterus', 'isthmus of uterus': 'uterus', 'cervix of uterus': 'cervix',
    'external os of uterus': 'cervix', 'isthmus of uterine tube': 'fallopian tube',
    'ampulla of uterine tube': 'fallopian tube', 'infundibulum of uterine tube': 'fallopian tube',
    'fimbriae of uterine tube': 'fallopian tube', 'ovarian follicle': 'ovarian follicle',
    'lumen of vagina': 'vagina', 'fornix of vagina': 'vaginal fornix', 'vaginal orifice': 'vagina',
    'labium majus': 'labia majora', 'labium minus': 'labia minora', 'glans of clitoris': 'clitoris',
    'body of clitoris': 'clitoris', 'crus of clitoris': 'clitoris', 'mons pubis': 'mons pubis',
    'female urethra': 'urethra', 'external urethral orifice': 'urethra',
    'greater vestibular gland': "bartholin's gland", 'bulb of vestibule': 'bulb of vestibule',
    'adipose tissue of breast': 'breast', 'lobule of mammary gland': 'mammary gland',
    'lactiferous duct': 'lactiferous duct', 'suspensory ligament of breast': 'breast',
    'ampulla of rectum': 'rectum', 'transverse fold of rectum': 'rectum',
    'anal columns': 'anal canal', 'ileocaecal orifice': 'ileum', 'perineal body': 'perineum',
    'ligament of ovary': 'ovary', 'suspensory ligament of ovary': 'ovary',
    'broad ligament of uterus': 'broad ligament of the uterus', 'round ligament of uterus': 'round ligament of the uterus',
}

SKIP_SECTIONS = ('references', 'external links', 'see also', 'additional images', 'notes', 'further reading', 'gallery', 'bibliography')


def load_desc(path):
    txt = open(path, encoding='utf-8', errors='ignore').read()
    lines = [l.rstrip() for l in txt.splitlines()]
    i = 0
    while i < len(lines) and (not lines[i].strip() or (lines[i].strip().isupper() and len(lines[i].strip()) < 80)):
        i += 1
    body = '\n'.join(lines[i:]).strip()
    tokens = re.split(r'\n\s*(={2,4})\s*([^=\n]+?)\s*={2,4}\s*\n', '\n' + body + '\n')
    summary = tokens[0].strip()
    sections = []
    j = 1
    while j + 2 < len(tokens):
        head, text = tokens[j + 1].strip(), tokens[j + 2].strip()
        if text and head.lower() not in SKIP_SECTIONS:
            sections.append({'h': head, 't': re.sub(r'\n{3,}', '\n\n', text)})
        j += 3
    summary = re.sub(r'\n{3,}', '\n\n', summary)
    return {'s': summary, 'x': sections}


# ---------- TA2 latin ----------
latin = {}
if os.path.exists(TA2):
    raw = open(TA2, encoding='utf-8-sig').read()
    for line in raw.splitlines()[1:]:
        line = line.strip().strip('"')
        cols = line.split(';')
        if len(cols) >= 3:
            en, la = cols[1].strip(), cols[2].strip()
            if en and la and norm(en) not in latin:
                latin[norm(en)] = la

# ---------- colors ----------
SKIN = '#a8673f'
SYS_COLORS = {
    'skeletal': '#e9dfc9', 'joints': '#dfe6ea', 'muscular': '#a6403a', 'nervous': '#e9c95c',
    'cardiovascular': '#c7332f', 'lymphoid': '#79b06a', 'visceral': '#d8a291', 'regions': SKIN,
    'references': '#8fb3ff', 'female': '#c26d80',
}
NAME_COLORS = [
    (r'cartilage|cartilagin|meniscus|labrum|\bdisc\b|intervertebral', '#d5e3e8'),
    (r'ligament|capsule|retinacul|tendon|aponeurosis', '#efe6d3'),
    (r'pulmonary trunk|pulmonary arter', '#4b62b0'),
    (r'pulmonary vein', '#c7332f'),
    (r'\bvein|venous|vena cava|azygos|jugular', '#3b5ba9'),
    (r'\barter|aorta|arterial', '#c7332f'),
    (r'\bheart\b|atrium|ventricle|myocard|endocard|epicard|valve|papillary|chordae', '#a0332f'),
    (r'white matter|corpus callosum|internal capsule|corona radiata|fornix|\btract\b|fasciculus|lemniscus|peduncle', '#eadada'),
    (r'grey matter|gray matter|nucleus|thalam|hypothalam|putamen|caudate|pallidus|amygdala|hippocamp|colliculus', '#c39a9e'),
    (r'cerebell', '#c9a0a4'),
    (r'brain|cerebr|cortex|gyrus|lobe|hemisphere|frontal|temporal|parietal|occipital|insula', '#cfa5a9'),
    (r'spinal cord|medulla|pons|midbrain|brainstem', '#d9c7c7'),
    (r'mening|dura|arachnoid|pia mater|falx|tentorium', '#b9b0cb'),
    (r'\bnerve|plexus|ganglion|ramus|rami|branch|root', '#e9c95c'),
    (r'\beye|eyeball|cornea|sclera|retina|\blens|iris|choroid', '#f2f2f2'),
    (r'\bear\b|cochlea|tympan|labyrinth|semicircular|vestibul|auricle', '#e6cfc2'),
    (r'lymph|\bnode|thymus|spleen|tonsil', '#79b06a'),
    (r'liver|hepat', '#8b3b2f'),
    (r'gallbladder|bile|cystic duct', '#4d8b4c'),
    (r'stomach|gastric|oesophag|esophag|pharyn', '#d8a291'),
    (r'duoden|jejun|ileum|small intestine', '#d9a48f'),
    (r'colon|caecum|cecum|rectum|anal|appendix|large intestine', '#c99280'),
    (r'pancrea', '#e2c58b'),
    (r'lung|bronch|alveol|pleura', '#d99ba1'),
    (r'trachea|larynx|epiglott|thyroid cartilage|cricoid|arytenoid|vocal', '#dadce1'),
    (r'kidney|renal', '#7c2e2a'),
    (r'bladder|ureter|urethra', '#d9c5a2'),
    (r'testis|testes|epididym|deferens|seminal|prostate|penis|scrot|ejaculatory', '#d6b3a4'),
    (r'uterus|uterine|cervix|vagina|ovar|fallopian|clitor|labium|vulva|mammary|breast|nipple|areola', '#c26d80'),
    (r'thyroid gland|parathyroid', '#b94b5a'),
    (r'suprarenal|adrenal', '#d9b262'),
    (r'hypophys|pituitary|pineal', '#c9a2a2'),
    (r'tooth|teeth|incisor|canine|molar|premolar|enamel|dentin', '#f5f2ea'),
    (r'tongue|lingual', '#d47d7d'),
    (r'salivary|parotid|submandibular|sublingual', '#e8c9a8'),
    (r'peritone|mesent|omentum|fascia|fasciae|mesocolon', '#e8dccb'),
    (r'hair|eyelash|eyebrow', '#1c1613'),
    (r'bursa|sheath', '#c8d6e0'),
    (r'muscle|muscles', '#a6403a'),
]
NAME_COLORS = [(re.compile(p, re.I), c) for p, c in NAME_COLORS]


def color_for(system, disp, sub):
    n = disp.lower()
    if system == 'skeletal':
        if re.search(r'cartilage|meniscus|disc', n): return '#d5e3e8'
        if re.search(r'ligament', n): return '#efe6d3'
        return '#e9dfc9'
    if system == 'joints':
        if re.search(r'ligament|capsule|membrane|retinacul', n): return '#efe6d3'
        if re.search(r'cartilage|meniscus|disc|labrum', n): return '#d5e3e8'
        return '#dfe6ea'
    if system == 'muscular':
        if re.search(r'tendon|aponeurosis|retinacul', n): return '#efe6d3'
        if re.search(r'fascia|fasciae', n): return '#e8dccb'
        if re.search(r'bursa|sheath', n): return '#c8d6e0'
        return '#a6403a'
    if system == 'cardiovascular':
        if re.search(r'pulmonary vein', n): return '#c7332f'
        if re.search(r'pulmonary (trunk|arter)', n): return '#4b62b0'
        if sub == 'heart' or re.search(r'\bheart\b|atrium|ventricle|myocard|valve|papillary|chordae|auricle|trabecul|septum', n): return '#a0332f'
        if sub == 'veins' or re.search(r'\bvein|venous|vena|azygos|jugular|sinus', n): return '#3b5ba9'
        return '#c7332f'
    if system == 'lymphoid': return '#79b06a'
    if system == 'integumentary':
        if re.search(r'hair|eyelash|eyebrow', n): return '#1c1613'
        return SKIN
    if system == 'references': return '#8fb3ff'
    for rx, c in NAME_COLORS:
        if rx.search(n):
            return c
    return SYS_COLORS.get(system, '#cccccc')


# Sex-specific structures. These have to be precise: several neutral structures LOOK
# sex-specific by name — "labial artery" is the LIP, "nasolabial"/"mentolabial" are face
# folds, "vaginal process of sphenoid" is a skull feature, "outer lip of iliac crest" is a
# bone ridge. Tagging those would wrongly delete them from one sex.
NOT_SEXUAL_RE = re.compile(
    r'nasolabial|mentolabial|labial commissure|labial (artery|arteries|vein|veins|branch|nerve|gland|sulcus)'
    r'|vaginal process|lip of iliac crest|labial part of orbicularis', re.I)
FEMALE_RE = re.compile(
    r'uter(us|ine)|ovar(y|ian|ies)|ovul|vagina(l)?|clitor|labium maj|labium min|labia maj|labia min'
    r'|vulva|mammary gland|lactiferous|areola|nipple|breast|fimbri|fallopian|salping'
    r'|endometri|myometri|mons pubis|greater vestibular|bulb of vestibule|vestibule of vagina'
    r'|cervix of uterus|corpus luteum|ovarian follicle|broad ligament|round ligament of uterus'
    r'|suspensory ligament of ovary|female', re.I)
MALE_RE = re.compile(
    r'testis|testes|testicular|epididym|ductus deferens|deferential|seminal|prostat|penis|penile'
    r'|scrot|ejaculatory|spermatic|cremaster|bulbourethral|corpus caverno|corpus spongio|(?<!fe)male', re.I)
MALE_RE = re.compile(r'testis|testes|epididym|deferens|seminal|prostate|penis|scrot|ejaculatory|spermatic|glans penis|corpus caverno|corpus spongio|(?<!fe)male', re.I)



# Geometry that is sex-specific even though its NAME is neutral. The source body is a male
# scan, so "Urogenital region" is literally a penis and scrotum, and "Hairs of head" is a
# man's short crop. Keyed by exact registry id, because the name alone cannot tell you.
SEX_BY_ID = {
    'regions:Urogenital region.l': 'm',
    'regions:Urogenital region.r': 'm',
    'regions:Pubic hairs': 'm',
    'regions:Hairs of head': 'm',
}

def sex_of(system, disp, glb):
    """Which sex a structure belongs to, or None if it exists in both.

    Applies to EVERY system, not just the reproductive one: the vessels and nerves that
    serve the genitals (testicular artery, dorsal vein of penis, uterine artery) are
    filed under cardiovascular/nervous, and leaving them untagged made male vessels
    float inside the female body.
    """
    n = disp
    if NOT_SEXUAL_RE.search(n):
        return None
    if MALE_RE.search(n):
        return 'm'
    if FEMALE_RE.search(n):
        return 'f'
    if system == 'urinary' and re.search(r'female urethra', n, re.I):
        return 'f'
    return None


# ---------- system / subsystem mapping ----------
def classify(glb, root, path_names):
    r = display(parse_name(root)[0]).lower() if root else ''
    if glb == 'skeletal': return 'skeletal', r
    if glb == 'joints': return 'joints', r
    if glb == 'muscular': return 'muscular', r
    if glb == 'lymphoid': return 'lymphoid', r
    if glb == 'regions': return 'integumentary', r
    if glb == 'references': return 'references', r
    if glb == 'extra':
        if r.startswith('female surface'): return 'integumentary', 'female surface'
        if r.startswith('female genital'): return 'reproductive', 'female genital system'
        if r.startswith('breast'): return 'reproductive', 'breast'
        if r.startswith('lower digestive'): return 'digestive', 'lower digestive tract'
        return 'reproductive', r
    if glb == 'nervous':
        if r.startswith('central'): return 'nervous', 'central nervous system'
        if r.startswith('peripheral'): return 'nervous', 'peripheral nervous system'
        if r.startswith('sense'): return 'senses', 'sense organs'
        return 'nervous', r
    if glb == 'cardiovascular':
        pn = [display(parse_name(p)[0]).lower() for p in path_names]
        if 'heart' in pn: return 'cardiovascular', 'heart'
        if r.startswith('arterial'): return 'cardiovascular', 'arteries'
        if r.startswith('venous'): return 'cardiovascular', 'veins'
        return 'cardiovascular', r
    if glb == 'visceral':
        if r.startswith('digestive'): return 'digestive', r
        if r.startswith('respiratory'): return 'respiratory', r
        if r.startswith('urinary'): return 'urinary', r
        if r.startswith('genital'): return 'reproductive', 'male genital system'
        if r.startswith('endocrine'): return 'endocrine', r
        if r.startswith('thoracic') or r.startswith('abdominopelvic'): return 'cavities', r
        return 'visceral', r
    return glb, r


# ---------- build ----------
registry = []
desc_by_sys = collections.defaultdict(dict)
stats = collections.Counter()
missing_desc = []
ref_boxes = {}
REF_NAMES = ('Hip bone.l', 'Hip bone.r', 'Sacrum', 'Urinary bladder', 'Rectum', 'Prostate', 'Pubic symphysis', 'Sternum',
             'Testis.l', 'Testis.r', 'Urethra', 'Kidney.l', 'Heart', 'Femur.l', 'Femur.r', 'Clavicle.l', 'Clavicle.r',
             'Body of sternum', 'Pectoral region.l', 'Pectoral region.r', 'Mammary region.l', 'Mammary region.r',
             'Anal canal', 'Coccyx', 'Fifth lumbar vertebra [L V]', 'Fifth lumbar vertebra', 'Seminal gland.l',
             'Ductus deferens.l', 'Epididymis.l', 'Scrotum', 'Glans penis', 'Corpus cavernosum of penis',
             'Pectoralis major.l', 'Pectoralis major.r', 'Sternal part of pectoralis major muscle.l', 'Xiphoid process', 'Manubrium of sternum')

for glb in GLBS:
    jpath = os.path.join(BUILD, f'{glb}.json')
    if not os.path.exists(jpath):
        continue
    objs = json.load(open(jpath, encoding='utf-8'))['objects']
    byname = {o['name']: o for o in objs}

    def path(o):
        chain = []
        cur = o
        while cur is not None:
            chain.append(cur['name'])
            cur = byname.get(cur['parent']) if cur['parent'] else None
        return chain[::-1]

    for o in objs:
        name = o['name']
        if name.startswith('Cross Section') or name == 'Take a picture' or name.endswith('-path') or name.endswith('-profile'):
            continue
        base, suf, dup = parse_name(name)
        disp = display(base)
        chain = path(o)
        root = chain[0]
        system, sub = classify(glb, root, chain)
        side = 'l' if suf in ('l', 'ol', 'el', 'e1l', 'e2l') else 'r' if suf in ('r', 'or', 'er', 'e1r', 'e2r') else None

        if o['type'] == 'EMPTY':
            kind = 'landmark' if suf in ('t', 's') else 'group'
        else:
            if suf in ('j', 'i'):
                kind = 'marker'
            elif suf in ('ol', 'or'):
                kind = 'origin'
            elif suf in ('el', 'er', 'e1l', 'e1r', 'e2l', 'e2r', 'e', 'o'):
                kind = 'insertion'
            else:
                kind = 'mesh'

        center = None
        if o['bbox']:
            b = o['bbox']
            center = [round((b[0][i] + b[1][i]) / 2, 4) for i in range(3)]

        entry = {
            'id': f'{glb}:{name}',
            'n': disp,
            'b': base,
            'sys': system,
            'sub': sub,
            'k': kind,
            'p': f'{glb}:{o["parent"]}' if o['parent'] else None,
            'g': glb,
        }
        if side: entry['side'] = side
        sx = SEX_BY_ID.get(f'{glb}:{name}')
        if not sx and sub == 'female surface': sx = 'f'   # the whole group is female skin
        if not sx: sx = sex_of(system, disp, glb)
        if sx: entry['sx'] = sx
        if base.startswith('('): entry['paren'] = 1
        if kind in ('mesh', 'origin', 'insertion'):
            entry['c'] = color_for(system, disp, sub)
            entry['v'] = o['verts']
            if o['bbox']: entry['bb'] = o['bbox']
        if kind == 'marker' and center:
            entry['pos'] = center
        if kind in ('origin', 'insertion'):
            entry['muscle'] = disp
            entry['bone'] = display(parse_name(o['parent'])[0]) if o['parent'] else None

        key = norm(disp)
        dpath = desc_files.get(key) or desc_files.get(norm(base))
        if not dpath:
            k2 = re.sub(r'\s*\(.*?\)\s*$', '', key).strip()
            dpath = desc_files.get(k2)
        if not dpath:
            k3 = re.sub(r'\s+(muscle|bone|nerve|artery|vein)$', '', key).strip()
            dpath = desc_files.get(k3)
        if not dpath:
            dpath = desc_files.get(DESC_ALIASES.get(key, ''))
        if dpath:
            entry['d'] = 1
            if key not in desc_by_sys[system]:
                desc_by_sys[system][key] = load_desc(dpath)
        elif kind in ('mesh', 'landmark', 'group'):
            missing_desc.append(disp)
        la = latin.get(key) or latin.get(norm(base))
        if la: entry['la'] = la

        registry.append(entry)
        stats[(glb, kind)] += 1

    for nm in REF_NAMES:
        if nm in byname and byname[nm]['bbox']:
            ref_boxes[f'{glb}:{nm}'] = byname[nm]['bbox']

byid = {e['id']: e for e in registry}
for e in registry:
    if e['k'] == 'marker' and e['p'] in byid:
        parent = byid[e['p']]
        if parent['k'] in ('landmark', 'group') and 'pos' not in parent:
            parent['pos'] = e['pos']

allb = [e['bb'] for e in registry if 'bb' in e and e['g'] != 'references']
mn = [min(b[0][i] for b in allb) for i in range(3)]
mx = [max(b[1][i] for b in allb) for i in range(3)]
print('GLOBAL BBOX', mn, mx)

out = {'v': 1, 'bbox': [mn, mx], 'parts': registry}
json.dump(out, open(os.path.join(OUT_DIR, 'registry.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
for s, d in desc_by_sys.items():
    json.dump(d, open(os.path.join(OUT_DIR, 'desc', f'{s}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump(ref_boxes, open(os.path.join(BUILD, 'ref_boxes.json'), 'w'), indent=1)

print('parts:', len(registry))
for k, v in sorted(stats.items()): print('  ', k, v)
print('systems (meshes):', collections.Counter(e['sys'] for e in registry if e['k'] == 'mesh'))
print('with desc:', sum(1 for e in registry if e.get('d')), 'with latin:', sum(1 for e in registry if e.get('la')))
print('missing desc (unique):', len(set(missing_desc)), sorted(set(missing_desc))[:25])
print('registry size KB:', os.path.getsize(os.path.join(OUT_DIR, 'registry.json')) // 1024)
for s in desc_by_sys: print('  desc', s, len(desc_by_sys[s]), os.path.getsize(os.path.join(OUT_DIR, 'desc', f'{s}.json')) // 1024, 'KB')
