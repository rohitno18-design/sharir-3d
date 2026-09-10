import bpy, sys, json, re
argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
recs = []
def walk(col, path):
    p = path + [col.name]
    for o in col.objects:
        recs.append({"name": o.name, "type": o.type, "col": "/".join(p), "verts": len(o.data.vertices) if o.type=='MESH' else 0, "hide": o.hide_viewport or o.hide_render, "parent": o.parent.name if o.parent else None})
    for c in col.children:
        walk(c, p)
walk(bpy.context.scene.collection, [])
json.dump(recs, open(out, "w", encoding="utf-8"), ensure_ascii=False)
fem = re.compile(r'uterus|ovar|vagina|clitor|mammary|breast|female|woman|labium maj|labium min|fallopian|uterine', re.I)
print("TOTAL objects:", len(recs), "meshes:", sum(1 for r in recs if r['type']=='MESH'))
cols = sorted({r['col'].split('/')[1] if '/' in r['col'] else r['col'] for r in recs})
print("TOP COLLECTIONS:", cols)
f = [r for r in recs if fem.search(r['name'])]
print("FEMALE-TERM objects:", len(f))
for r in f[:40]: print("  ", r['type'], r['name'], "|", r['col'], r['verts'])
