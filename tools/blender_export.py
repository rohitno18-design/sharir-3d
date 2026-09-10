"""
Blender headless script: FBX -> GLB + hierarchy JSON.
Usage: blender -b -P blender_export.py -- <in.fbx> <out.glb> <out.json>
"""
import bpy, sys, json, os, math

argv = sys.argv[sys.argv.index("--") + 1:]
src, out_glb, out_json = argv[0], argv[1], argv[2]

# Fresh scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, use_custom_normals=True, ignore_leaf_bones=True, automatic_bone_orientation=False)

objs = list(bpy.data.objects)
print(f"[import] {len(objs)} objects from {os.path.basename(src)}")

def mat_color(obj):
    if obj.type != 'MESH' or not obj.data.materials:
        return None
    m = obj.data.materials[0]
    if m is None:
        return None
    c = None
    if m.use_nodes and m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                c = list(n.inputs['Base Color'].default_value)[:4]
                break
    if c is None:
        c = list(m.diffuse_color)[:4]
    return [round(x, 4) for x in c], m.name

records = []
for o in objs:
    bb = None
    verts = 0
    if o.type == 'MESH':
        verts = len(o.data.vertices)
        mw = o.matrix_world
        pts = [mw @ v.co for v in o.data.vertices] if verts and verts < 200000 else [mw @ o.data.vertices[i].co for i in range(0, verts, max(1, verts // 20000))]
        if pts:
            xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
            bb = [[round(min(xs),4), round(min(ys),4), round(min(zs),4)], [round(max(xs),4), round(max(ys),4), round(max(zs),4)]]
    mc = mat_color(o)
    records.append({
        "name": o.name,
        "type": o.type,
        "parent": o.parent.name if o.parent else None,
        "verts": verts,
        "bbox": bb,
        "color": mc[0] if mc else None,
        "material": mc[1] if mc else None,
    })

with open(out_json, "w", encoding="utf-8") as f:
    json.dump({"source": os.path.basename(src), "objects": records}, f, ensure_ascii=False)

# Export GLB (names preserved, no animation, no cameras/lights)
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_materials='EXPORT',
    export_normals=True,
    export_texcoords=False,
    export_skins=False,
    export_morph=False,
    export_extras=False,
    use_selection=False,
    export_hierarchy_flatten_objs=False,
)
print(f"[export] wrote {out_glb} ({os.path.getsize(out_glb)/1e6:.1f} MB)")
