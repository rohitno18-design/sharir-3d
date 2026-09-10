"""
Blender headless: build the structures the Z-Anatomy/BodyParts3D male source is missing —
the complete female reproductive system, the breast, and the missing lower digestive tract
(caecum, ileum, rectum, anal canal).

Every position is derived from the reference bounding boxes measured on the source model,
so the new organs sit correctly inside the real pelvis and chest.

Blender axes here: metres, Z up, +X = anatomical LEFT, -Y = anterior (front).

Usage: blender -b -P build_extra.py -- <out.glb> <out.json>
"""
import bpy, bmesh, sys, json, math, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_GLB, OUT_JSON = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- materials
MATS = {}
def mat(name, hex_color, rough=0.42):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    r = int(hex_color[1:3], 16) / 255.0
    g = int(hex_color[3:5], 16) / 255.0
    bl = int(hex_color[5:7], 16) / 255.0
    def srgb(c):  # to linear
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    b.inputs['Base Color'].default_value = (srgb(r), srgb(g), srgb(bl), 1.0)
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (srgb(r), srgb(g), srgb(bl), 1.0)
    MATS[name] = m
    return m

C_REPRO   = '#c26d80'   # uterus, tubes
C_OVARY   = '#d9959f'
C_VAGINA  = '#c9808f'
C_LIG     = '#efe6d3'
C_GLAND   = '#e8b9c4'
C_DUCT    = '#f0dcc8'
C_FAT     = '#f6e3a1'
C_SKIN    = '#a8673f'
C_COLON   = '#c99280'
C_ILEUM   = '#d9a48f'
C_URETH   = '#d9c5a2'

# ---------------------------------------------------------------- helpers
created = []

def finish(obj, parent, material):
    obj.data.materials.append(material)
    if parent: obj.parent = parent
    for p in obj.data.polygons: p.use_smooth = True
    created.append(obj)
    return obj

def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    if parent: e.parent = parent
    created.append(e)
    return e

def ellipsoid(name, center, radii, parent=None, color=C_REPRO, segs=32, rings=18, rot=None, taper=None):
    """taper = (axis_index, factor_at_min, factor_at_max) squashes one end."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    for v in bm.verts:
        if taper:
            ax, f0, f1 = taper
            t = (v.co[ax] + 1.0) / 2.0
            f = f0 + (f1 - f0) * t
            for i in range(3):
                if i != ax: v.co[i] *= f
        v.co.x *= radii[0]; v.co.y *= radii[1]; v.co.z *= radii[2]
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if rot: o.rotation_euler = rot
    o.location = Vector(center)
    return finish(o, parent, mat(color, color))

def tube(name, pts, radius, parent=None, color=C_REPRO, res=20, ring=12, radii=None, flatten=None, closed=False):
    """pts: list of (x,y,z). radii: optional per-point radius list."""
    cu = bpy.data.curves.new(name + '_c', 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = 6
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        if radii: sp.points[i].radius = radii[i] / radius
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(pts))
    cu.bevel_depth = radius
    cu.bevel_resolution = max(2, ring // 4)
    cu.use_fill_caps = True
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    if flatten:
        for v in o.data.vertices:
            v.co.x *= flatten[0]; v.co.y *= flatten[1]; v.co.z *= flatten[2]
    return finish(o, parent, mat(color, color))

def sheet(name, corners, thickness, parent=None, color=C_LIG, subdiv=8, sag=0.0):
    """Bilinear patch between 4 corners, solidified."""
    a, b, c, d = [Vector(p) for p in corners]
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    grid = []
    n = subdiv
    for i in range(n + 1):
        row = []
        u = i / n
        for j in range(n + 1):
            v = j / n
            p = (a.lerp(b, u)).lerp(d.lerp(c, u), v)
            p.z -= sag * math.sin(math.pi * u) * math.sin(math.pi * v)
            row.append(bm.verts.new(p))
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for i in range(n):
        for j in range(n):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    sol = o.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = thickness; sol.offset = 0
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='sol')
    return finish(o, parent, mat(color, color))

def torus(name, center, major, minor, parent=None, color=C_REPRO, rot=(0, 0, 0), scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, radius=1, segments=3)
    bm.free()
    bm = bmesh.new()
    for i in range(40):
        a = i / 40 * math.tau
        for j in range(14):
            b = j / 14 * math.tau
            r = major + minor * math.cos(b)
            bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b)))
    bm.verts.ensure_lookup_table()
    for i in range(40):
        for j in range(14):
            v0 = bm.verts[i * 14 + j]; v1 = bm.verts[i * 14 + (j + 1) % 14]
            v2 = bm.verts[((i + 1) % 40) * 14 + (j + 1) % 14]; v3 = bm.verts[((i + 1) % 40) * 14 + j]
            bm.faces.new((v0, v1, v2, v3))
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.location = Vector(center); o.rotation_euler = rot; o.scale = Vector(scale)
    return finish(o, parent, mat(color, color))

def mirror_x(obj, new_name, parent=None):
    me = obj.data.copy()
    for v in me.vertices: v.co.x = -v.co.x
    me.flip_normals()
    o = bpy.data.objects.new(new_name, me)
    scene.collection.objects.link(o)
    o.location = Vector((-obj.location.x, obj.location.y, obj.location.z))
    o.rotation_euler = obj.rotation_euler
    o.scale = obj.scale
    if parent: o.parent = parent
    created.append(o)
    return o

def chest_wall_y(x, z):
    """
    Anterior surface of the thorax over which the breast is laid.
    Fitted to this model's own measurements (anterior extents, metres):
      sternum 0.111 · pectoralis major 0.116 · pectoral-region skin 0.129,
    i.e. the sternocostal plate is close to FLAT out to about x=0.13 and only then
    wraps round toward the axilla. An ellipse falls away far too fast and buries the
    lateral half of the breast inside the chest.
    """
    ax = abs(x)
    front = 0.112 + 0.010 * math.sin(min(1.0, ax / 0.13) * math.pi)   # slight pectoral fullness
    if ax > 0.13:
        t = min(1.0, (ax - 0.13) / 0.075)
        front -= 0.075 * (t ** 1.6)                                   # wrap toward the axilla
    front -= 0.030 * max(0.0, 1.205 - z) * 6.0                        # below the costal margin
    front -= 0.022 * max(0.0, z - 1.345) * 5.0                        # above the 2nd rib
    return -max(0.020, front)


def fold(name, pts, half_w, half_h, parent=None, color=C_SKIN, ring=18, taper=True, power=0.42):
    """Sweep an ellipse (half_w medio-lateral, half_h perpendicular) along a polyline.
    This is how a real labial / preputial fold is shaped — long, thin and arched —
    which an ellipsoid cannot represent."""
    P = [Vector(p) for p in pts]
    n = len(P)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(P):
        t = i / (n - 1)
        if i == 0: tan = P[1] - P[0]
        elif i == n - 1: tan = P[-1] - P[-2]
        else: tan = P[i + 1] - P[i - 1]
        if tan.length < 1e-9: tan = Vector((0, -1, 0))
        tan.normalize()
        side = tan.cross(Vector((0, 0, 1)))
        if side.length < 1e-6: side = Vector((1, 0, 0))
        side.normalize()
        nrm = side.cross(tan).normalized()
        s = (math.sin(math.pi * t) ** power) if taper else 1.0
        s = max(s, 0.07)
        hw = (half_w[i] if isinstance(half_w, (list, tuple)) else half_w) * s
        hh = (half_h[i] if isinstance(half_h, (list, tuple)) else half_h) * s
        rv = []
        for j in range(ring):
            a = j / ring * math.tau
            rv.append(bm.verts.new(p + side * (hw * math.cos(a)) + nrm * (hh * math.sin(a))))
        rings.append(rv)
    bm.verts.ensure_lookup_table()
    for i in range(n - 1):
        for j in range(ring):
            j2 = (j + 1) % ring
            bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return finish(o, parent, mat(color, color))


def breast_body(name, sx, parent, color, k=1.0, proj=0.040, rx=0.060, rz=0.058,
                xc=0.094, zc=1.270, back=0.004, tail=0.30):
    """
    Parametric breast. A base ellipse lying on the curved chest wall (ribs 2–6, sternal
    edge to mid-axillary line) lifted forward into a teardrop: fuller lower pole, apex
    slightly below centre, and the axillary tail of Spence running up toward the armpit.
    """
    rx *= k; rz *= k; proj *= k
    NU, NS = 48, 26
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()

    def surf(sv, a):
        """sv: 0 = front apex .. 0.5 = rim .. 1 = back apex."""
        ca, sa = math.cos(a), math.sin(a)
        fullness = 1.0 + 0.17 * (-sa)                                   # lower pole fuller
        tl = 1.0 + tail * max(0.0, ca) * (max(0.0, sa) ** 0.7)          # tail of Spence
        if sv <= 0.5:
            t = 1.0 - sv * 2.0                                          # 1 at apex → 0 at rim
            r = (1.0 - t) * fullness * tl
            # A quarter-sine leaves a hard rim where the shell meets the chest. Blend it
            # into a smoothstep over the upper and medial margins (where a real breast
            # merges seamlessly into the chest) while keeping the sharper meeting at the
            # lower pole — that crease is the inframammary fold and should stay.
            crease = max(0.0, -sa)
            smooth = t * t * (3.0 - 2.0 * t)
            depth = -proj * ((1.0 - crease) * smooth + crease * math.sin(t * math.pi / 2))
        else:
            t = (sv - 0.5) * 2.0                                        # 0 at rim → 1 at back
            r = (1.0 - t) * fullness * tl
            depth = back * math.sin(t * math.pi / 2)
        x = xc + rx * r * ca
        z = zc + rz * r * sa - 0.007 * (1.0 - min(1.0, abs(sv - 0.5) * 2.0))
        yw = chest_wall_y(x, z)
        return Vector((sx * x, yw + depth, z))

    front_apex = bm.verts.new(surf(0.0, 0.0))
    back_apex = bm.verts.new(surf(1.0, 0.0))
    rings = []
    for i in range(1, NS):
        sv = i / NS
        rings.append([bm.verts.new(surf(sv, j / NU * math.tau)) for j in range(NU)])
    bm.verts.ensure_lookup_table()
    for j in range(NU):
        j2 = (j + 1) % NU
        bm.faces.new((front_apex, rings[0][j], rings[0][j2]))
        bm.faces.new((back_apex, rings[-1][j2], rings[-1][j]))
    for i in range(len(rings) - 1):
        for j in range(NU):
            j2 = (j + 1) % NU
            bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return finish(o, parent, mat(color, color))


def breast_apex(sx, k=1.0, proj=0.040, xc=0.094, zc=1.270):
    """World position of the nipple for a given breast shell."""
    z = zc - 0.007
    return (sx * xc, chest_wall_y(xc, z) - proj * k, z)


# ================================================================ FEMALE GENITAL SYSTEM
g_fem   = empty('Female genital system.g')
g_int   = empty('Female internal genitalia.g', g_fem)
g_ext   = empty('Female external genitalia.g', g_fem)
g_ut    = empty('Uterus.g', g_int)
g_brst  = empty('Breast.g')
g_dig   = empty('Lower digestive tract.g')

# ---- Uterus (anteverted, anteflexed, sitting on top of the bladder) ----
# fundus anterosuperior, cervix posteroinferior
ellipsoid('Fundus of uterus', (0.0, -0.0195, 0.8955), (0.0225, 0.0125, 0.0105), g_ut, C_REPRO,
          rot=(math.radians(-32), 0, 0))
ellipsoid('Body of uterus', (0.0, -0.0075, 0.8790), (0.0215, 0.0120, 0.0245), g_ut, C_REPRO,
          rot=(math.radians(-32), 0, 0), taper=(2, 0.62, 1.0))
tube('Cavity of uterus', [(0.0, 0.0155, 0.8480), (0.0, 0.0045, 0.8690), (0.0, -0.0080, 0.8830), (0.0, -0.0170, 0.8925)],
     0.0022, g_ut, '#8f3f4f', flatten=(1.9, 0.35, 1.0))
ellipsoid('Endometrium', (0.0, -0.0075, 0.8790), (0.0150, 0.0055, 0.0185), g_ut, '#9c4353',
          rot=(math.radians(-32), 0, 0), taper=(2, 0.6, 1.0))
tube('Isthmus of uterus', [(0.0, 0.0100, 0.8570), (0.0, 0.0135, 0.8510)], 0.0090, g_ut, C_REPRO)
tube('Cervix of uterus', [(0.0, 0.0140, 0.8515), (0.0, 0.0175, 0.8430)], 0.0110, g_int, C_REPRO)
ellipsoid('External os of uterus', (0.0, 0.0180, 0.8420), (0.0075, 0.0060, 0.0035), g_int, '#a8505f')

# ---- Uterine (Fallopian) tubes + ovaries ----
for side, sx, suf in (('l', 1.0, '.l'), ('r', -1.0, '.r')):
    isth = [(sx * 0.0205, -0.0155, 0.8880), (sx * 0.0300, -0.0140, 0.8925)]
    amp = [(sx * 0.0300, -0.0140, 0.8925), (sx * 0.0400, -0.0060, 0.8975), (sx * 0.0455, 0.0055, 0.8975)]
    inf = [(sx * 0.0455, 0.0055, 0.8975), (sx * 0.0500, 0.0130, 0.8935), (sx * 0.0510, 0.0180, 0.8895)]
    tube('Isthmus of uterine tube' + suf, isth, 0.0022, g_int, C_REPRO)
    tube('Ampulla of uterine tube' + suf, amp, 0.0038, g_int, C_REPRO, radii=[0.0026, 0.0040, 0.0036])
    tube('Infundibulum of uterine tube' + suf, inf, 0.0040, g_int, C_REPRO, radii=[0.0036, 0.0046, 0.0052])
    for k in range(7):
        a = -0.9 + k * 0.3
        base = Vector((sx * 0.0510, 0.0180, 0.8895))
        tip = base + Vector((sx * 0.0055 * math.cos(a), 0.0075 * math.sin(a) + 0.0035, 0.0060 * math.sin(a * 1.7)))
        tube('Fimbriae of uterine tube' + suf if k == 0 else f'Fimbriae of uterine tube{suf}.{k:03d}',
             [tuple(base), tuple(base.lerp(tip, 0.6)), tuple(tip)], 0.0009, g_int, '#d08f9c')
    ellipsoid('Ovary' + suf, (sx * 0.0530, 0.0245, 0.8890), (0.0075, 0.0055, 0.0135), g_int, C_OVARY,
              rot=(0, 0, math.radians(sx * 12)))
    ellipsoid('Ovarian follicle' + suf, (sx * 0.0565, 0.0225, 0.8945), (0.0030, 0.0028, 0.0032), g_int, '#f0d9b0')
    ellipsoid('Corpus luteum' + suf, (sx * 0.0555, 0.0275, 0.8830), (0.0032, 0.0030, 0.0034), g_int, '#e8c06a')
    # ligaments
    tube('Ligament of ovary' + suf, [(sx * 0.0215, -0.0100, 0.8850), (sx * 0.0380, 0.0090, 0.8875), (sx * 0.0480, 0.0220, 0.8880)], 0.0022, g_int, C_LIG)
    tube('Suspensory ligament of ovary' + suf, [(sx * 0.0545, 0.0270, 0.8960), (sx * 0.0620, 0.0300, 0.9250), (sx * 0.0650, 0.0290, 0.9520)], 0.0026, g_int, C_LIG)
    tube('Round ligament of uterus' + suf, [(sx * 0.0205, -0.0180, 0.8870), (sx * 0.0340, -0.0330, 0.8760), (sx * 0.0470, -0.0455, 0.8640)], 0.0024, g_int, C_LIG)
    sheet('Broad ligament of uterus' + suf,
          [(sx * 0.0060, 0.0180, 0.8450), (sx * 0.0530, 0.0250, 0.8830),
           (sx * 0.0520, -0.0110, 0.8930), (sx * 0.0075, -0.0195, 0.8900)], 0.0016, g_int, C_LIG, sag=0.004)
    tube('Uterine artery' + suf, [(sx * 0.0480, 0.0230, 0.8600), (sx * 0.0280, 0.0195, 0.8520), (sx * 0.0130, 0.0130, 0.8620), (sx * 0.0175, -0.0060, 0.8850)], 0.0016, g_int, '#c7332f')
    tube('Ovarian artery' + suf, [(sx * 0.0620, 0.0300, 0.9500), (sx * 0.0580, 0.0285, 0.9100), (sx * 0.0545, 0.0260, 0.8940)], 0.0013, g_int, '#c7332f')

# ---- Vagina ----
tube('Vagina', [(0.0, 0.0175, 0.8425), (0.0, 0.0090, 0.8220), (0.0, -0.0040, 0.8010), (0.0, -0.0175, 0.7850), (0.0, -0.0225, 0.7790)],
     0.0135, g_int, C_VAGINA, flatten=(1.0, 1.0, 1.0), radii=[0.0150, 0.0140, 0.0130, 0.0125, 0.0120])
tube('Lumen of vagina', [(0.0, 0.0165, 0.8420), (0.0, 0.0080, 0.8215), (0.0, -0.0050, 0.8005), (0.0, -0.0215, 0.7800)], 0.0032, g_int, '#8f3f4f', flatten=(2.4, 1.0, 0.5))
torus('Fornix of vagina', (0.0, 0.0165, 0.8440), 0.0128, 0.0028, g_int, C_VAGINA, rot=(math.radians(24), 0, 0))
ellipsoid('Vaginal orifice', (0.0, -0.0245, 0.7775), (0.0080, 0.0035, 0.0075), g_ext, '#b8606f')

# ---- Vulva ----
# The vulvar axis runs obliquely: anterior/superior at the clitoris (z≈0.806, y≈-0.048)
# down and backwards to the posterior fourchette (z≈0.771, y≈-0.006). Every structure
# below is a swept fold along that axis, not a sphere.
C_LABMAJ = '#9c6242'
C_LABMIN = '#b8707d'
C_VEST   = '#a8505f'

for side, sx, suf in (('l', 1.0, '.l'), ('r', -1.0, '.r')):
    # Labium majus — the outer fold, hair-bearing skin over fat, running from the mons
    # anteriorly to the posterior commissure.
    fold('Labium majus' + suf,
         [(sx * 0.0140, -0.0510, 0.8135), (sx * 0.0175, -0.0500, 0.7995),
          (sx * 0.0190, -0.0420, 0.7880), (sx * 0.0182, -0.0300, 0.7800),
          (sx * 0.0150, -0.0170, 0.7752), (sx * 0.0092, -0.0062, 0.7722)],
         half_w=[0.0052, 0.0082, 0.0092, 0.0090, 0.0074, 0.0044],
         half_h=[0.0060, 0.0100, 0.0112, 0.0106, 0.0086, 0.0050],
         parent=g_ext, color=C_LABMAJ, power=0.30)

    # Labium minus — thin hairless inner fold; its anterior limb splits into the
    # prepuce (over the glans) and the frenulum (under it).
    fold('Labium minus' + suf,
         [(sx * 0.0048, -0.0468, 0.8038), (sx * 0.0068, -0.0432, 0.7952),
          (sx * 0.0080, -0.0350, 0.7876), (sx * 0.0078, -0.0252, 0.7812),
          (sx * 0.0064, -0.0158, 0.7768), (sx * 0.0040, -0.0098, 0.7742)],
         half_w=[0.0014, 0.0022, 0.0026, 0.0026, 0.0021, 0.0013],
         half_h=[0.0038, 0.0064, 0.0076, 0.0072, 0.0058, 0.0034],
         parent=g_ext, color=C_LABMIN, power=0.30)

    # Prepuce of the clitoris (clitoral hood) — anterior continuation of the labium minus
    fold('Prepuce of clitoris' + suf,
         [(sx * 0.0046, -0.0466, 0.8036), (sx * 0.0044, -0.0492, 0.8062),
          (sx * 0.0026, -0.0500, 0.8082), (sx * 0.0006, -0.0496, 0.8088)],
         half_w=[0.0016, 0.0022, 0.0024, 0.0022],
         half_h=[0.0034, 0.0040, 0.0042, 0.0038],
         parent=g_ext, color=C_LABMIN, power=0.35)

    # Erectile tissue deep to the labia
    fold('Bulb of vestibule' + suf,
         [(sx * 0.0092, -0.0430, 0.7962), (sx * 0.0122, -0.0356, 0.7898),
          (sx * 0.0128, -0.0268, 0.7852), (sx * 0.0106, -0.0186, 0.7818)],
         half_w=[0.0030, 0.0052, 0.0055, 0.0040],
         half_h=[0.0034, 0.0058, 0.0060, 0.0044],
         parent=g_ext, color=C_VEST, power=0.35)

    ellipsoid('Greater vestibular gland' + suf, (sx * 0.0135, -0.0175, 0.7790), (0.0042, 0.0038, 0.0040), g_ext, C_GLAND)
    # Crus — the clitoral root running back along the ischiopubic ramus
    tube('Crus of clitoris' + suf,
         [(sx * 0.0048, -0.0468, 0.8046), (sx * 0.0150, -0.0432, 0.7972),
          (sx * 0.0252, -0.0356, 0.7880), (sx * 0.0330, -0.0262, 0.7808)],
         0.0034, g_ext, C_VEST, radii=[0.0030, 0.0038, 0.0034, 0.0024])

# Clitoris — glans is the small exposed tip; the body angles back under the prepuce
ellipsoid('Glans of clitoris', (0.0, -0.0505, 0.8046), (0.0034, 0.0032, 0.0030), g_ext, '#b8606f')
tube('Body of clitoris', [(0.0, -0.0498, 0.8052), (0.0, -0.0470, 0.8060), (0.0, -0.0440, 0.8042)],
     0.0028, g_ext, C_VEST, radii=[0.0026, 0.0030, 0.0028])

# Vestibule — the cleft between the labia minora into which the urethra and vagina open
fold('Vestibule of vagina',
     [(0.0, -0.0430, 0.7960), (0.0, -0.0330, 0.7876), (0.0, -0.0212, 0.7800), (0.0, -0.0120, 0.7752)],
     half_w=[0.0030, 0.0044, 0.0046, 0.0030], half_h=[0.0018, 0.0024, 0.0024, 0.0016],
     parent=g_ext, color=C_VEST, power=0.4)

# Commissures
fold('Posterior commissure of labia',
     [(-0.0090, -0.0064, 0.7724), (0.0, -0.0048, 0.7714), (0.0090, -0.0064, 0.7724)],
     half_w=0.0030, half_h=0.0034, parent=g_ext, color=C_LABMAJ, power=0.4)
fold('Anterior commissure of labia',
     [(-0.0140, -0.0512, 0.8136), (0.0, -0.0530, 0.8168), (0.0140, -0.0512, 0.8136)],
     half_w=0.0044, half_h=0.0052, parent=g_ext, color=C_LABMAJ, power=0.4)

# Mons pubis — fat pad over the symphysis, flattened against the body, not a ball
ellipsoid('Mons pubis', (0.0, -0.0455, 0.8290), (0.0260, 0.0115, 0.0185), g_ext, C_SKIN, taper=(2, 1.0, 0.55))
tube('Female urethra', [(0.0, -0.0040, 0.8265), (0.0, -0.0140, 0.8080), (0.0, -0.0250, 0.7930), (0.0, -0.0300, 0.7855)], 0.0038, g_int, C_URETH)
ellipsoid('External urethral orifice', (0.0, -0.0310, 0.7845), (0.0035, 0.0025, 0.0028), g_ext, C_URETH)
ellipsoid('Perineal body', (0.0, -0.0025, 0.7770), (0.0090, 0.0075, 0.0080), g_ext, C_LIG)

# ================================================================ BREAST
# Built as a teardrop lying on the curved chest wall over ribs 2–6, from the sternal edge
# to the mid-axillary line, with the axillary tail of Spence — not a sphere on the ribs.
BR_XC, BR_ZC, BR_PROJ = 0.094, 1.270, 0.040
for side, sx, suf in (('l', 1.0, '.l'), ('r', -1.0, '.r')):
    # Subcutaneous fat is the outer shell; the glandular cone sits inside it.
    breast_body('Adipose tissue of breast' + suf, sx, g_brst, C_FAT,
                k=1.0, proj=BR_PROJ, rx=0.060, rz=0.058, xc=BR_XC, zc=BR_ZC, tail=0.30)
    breast_body('Mammary gland' + suf, sx, g_brst, C_GLAND,
                k=0.80, proj=BR_PROJ * 0.86, rx=0.060, rz=0.058, xc=BR_XC, zc=BR_ZC, tail=0.34)

    ax, ay, az = breast_apex(sx, 1.0, BR_PROJ, BR_XC, BR_ZC)
    # 12 lobes radiating to the nipple, each draining by one lactiferous duct
    for k in range(12):
        a = k / 12 * math.tau
        ca, sa = math.cos(a), math.sin(a)
        lx = BR_XC + 0.034 * ca
        lz = BR_ZC + 0.032 * sa - 0.004
        ly = chest_wall_y(lx, lz) - BR_PROJ * 0.20
        p0 = (sx * lx, ly, lz)
        p1 = (sx * (BR_XC + 0.017 * ca), (ly + ay) / 2 - 0.004, BR_ZC + 0.016 * sa - 0.005)
        p2 = (ax, ay + 0.004, az)
        nm = 'Lactiferous duct' + suf if k == 0 else f'Lactiferous duct{suf}.{k:03d}'
        tube(nm, [p0, p1, p2], 0.0015, g_brst, C_DUCT, radii=[0.0011, 0.0016, 0.0013])
        nm2 = 'Lobule of mammary gland' + suf if k == 0 else f'Lobule of mammary gland{suf}.{k:03d}'
        ellipsoid(nm2, p0, (0.0085, 0.0072, 0.0085), g_brst, '#dfa7b4')

    # Nipple sits at the apex and projects a few mm further; areola is a flat disc on it
    tube('Nipple' + suf, [(ax, ay + 0.0010, az), (ax, ay - 0.0060, az)], 0.0055, g_brst, '#8f5060',
         radii=[0.0058, 0.0050])
    ellipsoid('Areola' + suf, (ax, ay + 0.0016, az), (0.0170, 0.0030, 0.0165), g_brst, '#9c5a68')

    # Cooper's ligaments — fibrous strands slinging the gland to the skin
    for k, a in enumerate((0.9, 2.2, 3.6, 5.0)):
        ca, sa = math.cos(a), math.sin(a)
        sxp = BR_XC + 0.052 * ca
        szp = BR_ZC + 0.050 * sa
        nm = 'Suspensory ligament of breast' + suf if k == 0 else f'Suspensory ligament of breast{suf}.{k:03d}'
        tube(nm, [(sx * sxp, chest_wall_y(sxp, szp), szp),
                  (sx * (BR_XC + 0.028 * ca), chest_wall_y(BR_XC + 0.028 * ca, BR_ZC + 0.027 * sa) - BR_PROJ * 0.42, BR_ZC + 0.027 * sa),
                  (ax, ay + 0.003, az)],
             0.0016, g_brst, C_LIG, radii=[0.0020, 0.0015, 0.0010])

# ================================================================ LOWER DIGESTIVE TRACT
# Caecum + ileocaecal junction (right lower quadrant, under the ascending colon)
ellipsoid('Caecum', (-0.0810, -0.0085, 0.9330), (0.0260, 0.0235, 0.0250), g_dig, C_COLON, taper=(2, 0.78, 1.0))
tube('Ileocaecal orifice', [(-0.0620, -0.0090, 0.9385), (-0.0700, -0.0090, 0.9375)], 0.0060, g_dig, '#b07d6c')
# Ileum — coiled loops filling the right iliac fossa and pelvis
ileum_pts = []
for k in range(46):
    t = k / 45
    a = t * math.tau * 2.6
    r = 0.052 * (1 - 0.45 * t)
    ileum_pts.append((0.020 - 0.095 * t + r * 0.55 * math.cos(a),
                      -0.048 + 0.030 * t + 0.016 * math.sin(a * 1.3),
                      0.975 - 0.040 * t + r * 0.42 * math.sin(a)))
tube('Ileum', ileum_pts, 0.0105, g_dig, C_ILEUM, res=6)
# Rectum — follows the sacral curve, with the ampulla
rect_pts = [(0.0080, 0.0530, 0.9010), (0.0035, 0.0570, 0.8790), (0.0000, 0.0545, 0.8560),
            (0.0000, 0.0460, 0.8320), (0.0000, 0.0370, 0.8090), (0.0000, 0.0300, 0.7930)]
tube('Rectum', rect_pts, 0.0165, g_dig, C_COLON, radii=[0.0130, 0.0150, 0.0180, 0.0205, 0.0195, 0.0135])
ellipsoid('Ampulla of rectum', (0.0, 0.0415, 0.8210), (0.0215, 0.0180, 0.0215), g_dig, C_COLON)
for k, z in enumerate((0.8640, 0.8380, 0.8130)):
    nm = 'Transverse fold of rectum' if k == 0 else f'Transverse fold of rectum.{k:03d}'
    torus(nm, (0.0, 0.0480 - k * 0.006, z), 0.0165, 0.0028, g_dig, '#b07d6c', rot=(math.radians(14), 0, 0), scale=(1.0, 0.55, 1.0))
tube('Anal canal', [(0.0, 0.0295, 0.7930), (0.0, 0.0255, 0.7760), (0.0, 0.0230, 0.7620)], 0.0105, g_dig, '#b8705f', radii=[0.0125, 0.0105, 0.0080])
torus('Anal columns', (0.0, 0.0275, 0.7840), 0.0095, 0.0022, g_dig, '#a05a4c', rot=(math.radians(12), 0, 0))
ellipsoid('Anus', (0.0, 0.0228, 0.7605), (0.0090, 0.0085, 0.0035), g_dig, '#8a4a3f')

# ================================================================ FEMALE SKIN SURFACE
# The Z-Anatomy / BodyParts3D body is a MALE scan: its skin carries male genitalia, a male
# chest and male hair. Switching sex could therefore only ever reshape a male surface.
# These meshes are the female skin layer that the source data simply does not contain —
# they replace the male ones when the female body is selected.
C_HAIR = '#1c1613'
g_fskin = empty('Female surface.g')

# ---- breast surface: the same teardrop as the gland, one layer further out, skin coloured
for side, sx, suf in (('l', 1.0, '.l'), ('r', -1.0, '.r')):
    breast_body('Breast surface' + suf, sx, g_fskin, C_SKIN,
                k=1.06, proj=BR_PROJ * 1.10, rx=0.062, rz=0.060, xc=BR_XC, zc=BR_ZC, tail=0.30)
    ax, ay, az = breast_apex(sx, 1.06, BR_PROJ * 1.10, BR_XC, BR_ZC)
    ellipsoid('Areola surface' + suf, (ax, ay + 0.0012, az), (0.0175, 0.0028, 0.0170), g_fskin, '#8f5a52')
    tube('Nipple surface' + suf, [(ax, ay + 0.0008, az), (ax, ay - 0.0055, az)], 0.0052, g_fskin, '#7d4a45',
         radii=[0.0055, 0.0047])

# ---- vulvar surface: mons, labial folds and the cleft between them, as SKIN rather than
# as the internal organs. Sits exactly where the male scan puts the penis and scrotum.
ellipsoid('Mons pubis surface', (0.0, -0.0470, 0.8300), (0.0290, 0.0135, 0.0210), g_fskin, C_SKIN,
          taper=(2, 1.0, 0.55))
for side, sx, suf in (('l', 1.0, '.l'), ('r', -1.0, '.r')):
    fold('Labial surface' + suf,
         [(sx * 0.0130, -0.0520, 0.8150), (sx * 0.0180, -0.0510, 0.7995),
          (sx * 0.0196, -0.0425, 0.7875), (sx * 0.0186, -0.0300, 0.7795),
          (sx * 0.0152, -0.0165, 0.7748), (sx * 0.0090, -0.0055, 0.7716)],
         half_w=[0.0055, 0.0088, 0.0098, 0.0095, 0.0078, 0.0046],
         half_h=[0.0062, 0.0104, 0.0118, 0.0112, 0.0090, 0.0052],
         parent=g_fskin, color=C_SKIN, power=0.30)
# the perineal skin closing the gap behind the labia
fold('Perineal surface',
     [(-0.0100, -0.0060, 0.7716), (0.0, -0.0035, 0.7700), (0.0100, -0.0060, 0.7716)],
     half_w=0.0075, half_h=0.0060, parent=g_fskin, color=C_SKIN, power=0.4)

# ---- female pubic hair: a horizontal upper border, not the male escutcheon that runs
# up toward the navel
ellipsoid('Female pubic hair', (0.0, -0.0555, 0.8330), (0.0265, 0.0070, 0.0135), g_fskin, C_HAIR,
          taper=(2, 1.0, 0.62))

# ---- long head hair -------------------------------------------------------------
# Scalp cap plus hair falling past the shoulders. The male scan's hair is a short crop,
# which is one of the strongest "this is a man" cues on the whole model.
def hair_shell(name, parent, color):
    """
    Long hair: a shell over the top, back and sides of the skull that falls past the
    shoulders, with the face left clear.

    Fitted to this skull (anterior extents, metres): frontal bone 0.038, nose 0.083,
    mandible 0.084, occiput -0.051. The first attempt swept a full sphere and reached
    0.117 forward — in front of the nose — which simply covered the face.
    """
    NU, NV = 46, 34
    CX, CY, CZ = 0.0, 0.020, 1.645          # skull centre (Blender: -y is anterior)
    RX, RY, RZ = 0.084, 0.082, 0.080
    FRONT_LIMIT = -0.034                    # hairline: nothing may sit forward of this

    me = bpy.data.meshes.new(name)
    bm = bmesh.new()

    def pt(u, v):
        a = u * math.tau
        ca, sa = math.cos(a), math.sin(a)
        front = max(0.0, -sa)               # 1 straight ahead, 0 at the back
        # Sweep far down the back and sides, but stop high at the front so the shell
        # ends at the hairline instead of continuing over the face.
        polar = v * math.pi * (0.72 - 0.40 * front)
        sp, cp = math.sin(polar), math.cos(polar)
        x = CX + RX * 1.05 * sp * ca
        y = CY + RY * 1.05 * sp * sa
        z = CZ + RZ * 1.05 * cp

        # Past the scalp the hair falls, mostly behind and to the sides.
        drop = max(0.0, v - 0.54) / 0.46
        if drop > 0:
            back = (1.0 - front) ** 0.6
            z -= drop * 0.34 * (0.55 + 0.45 * back)
            x *= 1.0 + drop * 0.34
            y += drop * 0.030 * back        # sweeps backwards as it falls
            x *= 1.0 - 0.16 * drop * drop   # taper toward the ends
        if y < FRONT_LIMIT:
            y = FRONT_LIMIT                 # never in front of the hairline
        return Vector((x, y, z))

    grid = [[bm.verts.new(pt(i / NU, j / NV)) for i in range(NU)] for j in range(NV + 1)]
    bm.verts.ensure_lookup_table()
    for j in range(NV):
        for i in range(NU):
            i2 = (i + 1) % NU
            bm.faces.new((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    sol = o.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.007; sol.offset = 0
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='sol')
    return finish(o, parent, mat(color, color))


hair_shell('Long head hair', g_fskin, C_HAIR)


# ================================================================ export
bpy.context.view_layer.update()
for o in created:
    o.select_set(False)

records = []
for o in created:
    bb = None
    verts = 0
    if o.type == 'MESH':
        verts = len(o.data.vertices)
        mw = o.matrix_world
        pts = [mw @ v.co for v in o.data.vertices]
        if pts:
            xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
            bb = [[round(min(xs), 4), round(min(ys), 4), round(min(zs), 4)],
                  [round(max(xs), 4), round(max(ys), 4), round(max(zs), 4)]]
    color = None
    matname = None
    if o.type == 'MESH' and o.data.materials:
        m = o.data.materials[0]
        matname = m.name
        c = list(m.diffuse_color)[:4]
        color = [round(x, 4) for x in c]
    records.append({"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None,
                    "verts": verts, "bbox": bb, "color": color, "material": matname})

json.dump({"source": "build_extra.py", "objects": records}, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False)

bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True,
                          export_animations=False, export_cameras=False, export_lights=False,
                          export_materials='EXPORT', export_normals=True, export_texcoords=False,
                          export_skins=False, export_morph=False, export_extras=False, use_selection=False)
print(f"[extra] {len(records)} objects, {sum(r['verts'] for r in records)} verts -> {OUT_GLB} ({os.path.getsize(OUT_GLB)/1e6:.2f} MB)")
