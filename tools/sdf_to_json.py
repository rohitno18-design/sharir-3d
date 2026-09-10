"""Convert PubChem SDF molecules into compact JSON for the web viewer."""
import glob, json, os
SRC = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'molecules')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'molecules.json')
mols = {}
for f in sorted(glob.glob(os.path.join(SRC, '*.sdf'))):
    name = os.path.splitext(os.path.basename(f))[0]
    lines = open(f, encoding='utf-8', errors='ignore').read().splitlines()
    if len(lines) < 4: continue
    counts = lines[3]
    try:
        na, nb = int(counts[0:3]), int(counts[3:6])
    except ValueError:
        continue
    if na > 400:  # skip macromolecules (insulin, semaglutide)
        print('skip large', name, na); continue
    atoms, bonds = [], []
    for i in range(4, 4 + na):
        p = lines[i].split()
        atoms.append([round(float(p[0]), 3), round(float(p[1]), 3), round(float(p[2]), 3), p[3]])
    for i in range(4 + na, 4 + na + nb):
        l = lines[i]
        a, b, o = int(l[0:3]), int(l[3:6]), int(l[6:9])
        bonds.append([a - 1, b - 1, o])
    # detect 2D (all z == 0)
    is2d = all(abs(a[2]) < 1e-6 for a in atoms)
    # formula
    from collections import Counter
    c = Counter(a[3] for a in atoms)
    order = ['C', 'H'] + sorted(k for k in c if k not in ('C', 'H'))
    formula = ''.join(f"{k}{c[k] if c[k] > 1 else ''}" for k in order if k in c)
    mols[name] = {"atoms": atoms, "bonds": bonds, "formula": formula, "is2d": is2d}
json.dump(mols, open(OUT, 'w'), separators=(',', ':'))
print('wrote', len(mols), 'molecules ->', OUT, round(os.path.getsize(OUT) / 1e3), 'KB')
print({k: v['formula'] for k, v in list(mols.items())[:12]})
