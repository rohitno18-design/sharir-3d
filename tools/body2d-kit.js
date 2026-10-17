// Renders the "My Body" art from the real anatomy models in the anatomy-3d
// project (Z-Anatomy, CC BY-SA 4.0 + BodyParts3D). Runs INSIDE that app's page
// (it uses window.app), and posts each image to scripts/body-render/receiver.mjs.
//
// How to regenerate (both are local, nothing leaves the machine):
//   1. node scripts/body-render/receiver.mjs
//   2. copy this file to C:/Users/rohit/Projects/anatomy-3d/tools/body2d-kit.js
//      and open the anatomy-3d dev server (port 5181)
//   3. in the page console:  const k = await import('/tools/body2d-kit.js'); await k.renderAll();
//
// Output: public/body/<sex>/<layer>/<region>.webp + public/body/<sex>/manifest.json
// Every region is rendered alone with one fixed front camera, cropped to its
// bounding box, so the app can stack them exactly and tint / hit-test each one.

import * as THREE from "three";

const W = 760, H = 1400;            // full frame (pixels)
const CY = 0.87, HALF_H = 0.9;      // camera looks at the body's middle, frames ±0.9 m
const CELL = 8;                     // hit-mask cell size (pixels)
const SERVER = "http://127.0.0.1:5199/";

const a = () => window.app;
const R = (t) => a().registry.resolveTarget(t);
const byName = (re, sys) => a().registry.parts.filter(p => (!sys || sys.includes(p.sys)) && re.test(p.n)).map(p => p.id);
const minus = (ids, ...drop) => { const d = new Set(drop.flat()); return ids.filter(i => !d.has(i)); };
const uniq = (ids) => [...new Set(ids)];

/** Skin without hair and without the genital / nipple surfaces (a family app) */
const skinIds = () => byName(/./, ["integumentary"]).filter(id => {
    const n = a().registry.byId.get(id).n;
    return !/hair|urogenital|perine|mons pubis|labial surface|nipple|areola|eyelash|eyebrow/i.test(n);
});

// ── what each region is made of ─────────────────────────────────────────

function regions(sex) {
    const sternum = byName(/sternum|manubrium|xiphoid/i, ["skeletal"]);
    const skull = uniq([...R("skull"), ...byName(/mandible/i, ["skeletal"])]);
    const teeth = R("teeth");
    const spine = R("spine");
    const ribs = uniq([...R("ribs"), ...sternum]);
    const pelvis = R("pelvis");
    const bones = R("bones");
    const coronary = R("coronary-arteries"), carotid = R("carotid-arteries"), cerebral = R("cerebral-arteries"), legVeins = R("leg-veins");
    return {
        organs: {
            base: { skeleton: bones },
            // Drawn back to front. Kidneys, pancreas and gallbladder really sit behind other organs (and
            // the liver covers the bottom of the lungs); like most atlas plates they are drawn in front
            // so they can be seen and tapped.
            order: ["skin", "fat", "nerves", "reproductive", "lungs", "heart", "intestines", "bladder", "liver", "stomach", "pancreas", "gallbladder", "kidneys", "thyroid", "brain", "eyes", "mouth"],
            parts: {
                // the brain itself, not the spinal tracts that the atlas files under it
                brain: R("brain").filter(id => (a().body.boundsOf(id)?.min.y ?? 2) > 1.35), eyes: R("eyes"), mouth: uniq([...R("mouth"), ...R("tongue")]), thyroid: R("thyroid"),
                lungs: uniq([...R("lungs"), ...R("airways")]), heart: R("heart"), liver: R("liver"), gallbladder: R("gallbladder"),
                stomach: uniq([...R("stomach"), ...R("esophagus")]), pancreas: R("pancreas"),
                kidneys: uniq([...R("kidneys"), ...R("adrenal-glands"), ...R("ureters")]),
                intestines: uniq([...R("small-intestine"), ...R("large-intestine"), ...R("rectum")]), bladder: R("bladder"),
                reproductive: sex === "female" ? uniq([...byName(/mammary|lactiferous/i, ["reproductive"]), ...R("uterus"), ...R("ovaries")]) : uniq([...R("prostate"), ...R("testes")]),
                nerves: uniq([...R("peripheral-nerves"), ...R("spinal-cord")]),
                fat: R("adipose"), skin: skinIds(),
            },
            tint: { fat: [242, 196, 92] },
        },
        vessels: {
            occlude: true,
            base: { skin: skinIds(), skeleton: bones, veins: minus(R("veins"), legVeins) },
            order: ["arteries", "legVeins", "carotid", "brainVessels", "blood", "heart", "coronary"],
            parts: {
                arteries: minus(R("arteries"), coronary, carotid, cerebral), legVeins, carotid, brainVessels: cerebral, coronary,
                heart: R("heart"), blood: R("immune-system"),
            },
        },
        bones: {
            occlude: true,
            base: { skin: skinIds() },
            order: ["limbBones", "pelvis", "spine", "ribs", "joints", "skull", "teeth"],
            parts: {
                skull, teeth, spine: spine.filter(id => a().registry.byId.get(id).sys === "skeletal"), ribs, pelvis,
                joints: uniq(["hip-joint", "knee-joint", "shoulder-joint", "elbow-joint", "wrist", "ankle"].flatMap(R)),
                limbBones: minus(bones, skull, teeth, spine, ribs, pelvis),
            },
        },
        muscles: {
            occlude: true,
            base: { skeleton: bones },
            order: ["skeletalMuscle", "core", "hipFlexors", "quads", "legs", "arms", "chest", "traps"],
            parts: {
                skeletalMuscle: R("skeletal-muscle"), traps: R("trapezius"), chest: R("pectorals"),
                arms: uniq(["biceps", "triceps", "deltoids", "forearm-muscles"].flatMap(R)), core: R("abs"),
                hipFlexors: R("hip-flexors"), quads: R("quadriceps"), legs: uniq([...R("calves"), ...R("hamstrings")]),
            },
        },
        musclesBack: {
            back: true,
            occlude: true,
            base: { skeleton: bones },
            order: ["skeletalMuscle", "backMuscles", "glutes"],
            parts: { skeletalMuscle: R("skeletal-muscle"), backMuscles: uniq([...R("erector-spinae"), ...R("lats")]), glutes: R("glutes") },
        },
    };
}

// ── rendering ───────────────────────────────────────────────────────────

const ALL_SYSTEMS = ["skeletal", "joints", "muscular", "nervous", "senses", "cardiovascular", "lymphoid", "respiratory", "digestive", "urinary", "reproductive", "endocrine", "cavities", "integumentary", "references"];

function frame(back) {
    const v = a().viewer, r = v.renderer, cam = v.camera;
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    const dist = HALF_H / Math.tan((cam.fov * Math.PI) / 180 / 2);
    cam.position.set(0, CY, back ? -dist : dist);
    v.controls.target.set(0, CY, 0);
    cam.lookAt(0, CY, 0);
    v._tween = null;
}

function show(ids) {
    const ov = {};
    for (const s of ALL_SYSTEMS) ov[s] = { visible: s !== "references" && s !== "cavities", opacity: 1 };
    a().setSysOverride(ov);
    a().hi.clearEffects();
    a().hi.setSelected([]);
    a().hi.setHover(null);
    a().hi.setIsolate(ids);
    a().hi.applyAll();
}

function snap(back) {
    const v = a().viewer, r = v.renderer;
    frame(back);
    const hidden = [];
    for (const o of v.scene.children) { if (o === v.bodyRoot || o.isLight || !o.visible) continue; o.visible = false; hidden.push(o); }
    r.render(v.scene, v.camera);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").drawImage(r.domElement, 0, 0);
    hidden.forEach(o => (o.visible = true));
    return c;
}

/**
 * Which part is in front at every pixel (the app's own GPU picking pass, full frame).
 * Returns part ids per pixel, top row first; null where there is nothing.
 */
function idBuffer(back) {
    const v = a().viewer, r = v.renderer, body = a().body;
    frame(back);
    const rt = new THREE.WebGLRenderTarget(W, H);
    const buf = new Uint8Array(W * H * 4);
    const hidden = [];
    for (const o of v.scene.children) { if (o === v.bodyRoot || o.isLight || !o.visible) continue; o.visible = false; hidden.push(o); }
    const saved = body.batches.map(b => [b.mesh.material.blending, b.mesh.material.depthWrite]);
    for (const b of body.batches) { b.mesh.material.blending = THREE.NoBlending; b.mesh.material.depthWrite = true; }
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    body.uPick.value = 1;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear();
    r.render(v.scene, v.camera);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null); body.uPick.value = 0; r.setClearColor(clear, alpha);
    body.batches.forEach((b, i) => { b.mesh.material.blending = saved[i][0]; b.mesh.material.depthWrite = saved[i][1]; });
    hidden.forEach(o => (o.visible = true));
    rt.dispose();
    const ids = new Array(W * H).fill(null);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = ((H - 1 - y) * W + x) * 4;            // GL rows are bottom-up
        const n = buf[i] + buf[i + 1] * 256 + buf[i + 2] * 65536;
        if (n) ids[y * W + x] = body.parts[n - 1]?.id ?? null;
    }
    return ids;
}

/** Keep only the pixels where one of these parts is the one in front */
function keepFront(canvas, ids, want) {
    const g = canvas.getContext("2d"), img = g.getImageData(0, 0, W, H), d = img.data;
    for (let p = 0; p < W * H; p++) if (!want.has(ids[p])) d[p * 4 + 3] = 0;
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    out.getContext("2d").putImageData(img, 0, 0);
    return out;
}

/** Recolour keeping the shading (used for the belly-fat layer, which is skin in the model) */
function tint(canvas, rgb) {
    const g = canvas.getContext("2d"), img = g.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 200;
        d[i] = Math.min(255, rgb[0] * l); d[i + 1] = Math.min(255, rgb[1] * l); d[i + 2] = Math.min(255, rgb[2] * l);
    }
    g.putImageData(img, 0, 0);
}

/** Crop to the visible pixels and build a coarse hit mask (1 bit per CELL×CELL block) */
function crop(canvas) {
    const g = canvas.getContext("2d"), d = g.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    out.getContext("2d").drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
    const bits = new Uint8Array(Math.ceil((cols * rows) / 8));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let hit = 0;
        for (let yy = r * CELL; yy < Math.min(h, (r + 1) * CELL) && !hit; yy += 2)
            for (let xx = c * CELL; xx < Math.min(w, (c + 1) * CELL); xx += 2)
                if (d[((y0 + yy) * W + (x0 + xx)) * 4 + 3] > 60) { hit = 1; break; }
        if (hit) { const i = r * cols + c; bits[i >> 3] |= 1 << (i & 7); }
    }
    let bin = ""; for (const b of bits) bin += String.fromCharCode(b);
    return { canvas: out, x: x0, y: y0, w, h, mask: btoa(bin) };
}

async function post(path, payload) {
    const res = await fetch(SERVER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, ...payload }) });
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export async function renderSex(sex, { quality = 0.86 } = {}) {
    if (a().setSex) a().setSex(sex);
    await wait(1500);
    const L = regions(sex);
    const manifest = { W, H, cell: CELL, sex, source: "Z-Anatomy (CC BY-SA 4.0) + BodyParts3D", layers: {} };
    for (const [layer, spec] of Object.entries(L)) {
        const entry = { back: !!spec.back, base: {}, regions: {} };
        const items = [
            ...Object.entries(spec.base).map(([k, ids]) => ["base", k, ids]),
            ...spec.order.map(k => ["region", k, spec.parts[k]]),
        ];
        // Layers where parts hide each other (muscles over muscles, bones over bones): draw the
        // whole layer once and cut each region out of it, so a region shows only what is really
        // in front — the trapezius from the front is the strip over the shoulders, not the whole
        // diamond on the back. Organs are drawn alone on purpose (see their order above).
        let full = null, fullIds = null;
        if (spec.occlude) {
            show(uniq(Object.values(spec.parts).flat()));
            await wait(80);
            full = snap(spec.back);
            fullIds = idBuffer(spec.back);
        }
        for (const [kind, key, ids] of items) {
            if (!ids || !ids.length) { console.warn("empty", layer, key); continue; }
            let c;
            if (kind === "region" && full) {
                c = keepFront(full, fullIds, new Set(ids));
            } else {
                show(ids);
                await wait(60);
                c = snap(spec.back);
            }
            if (spec.tint?.[key]) tint(c, spec.tint[key]);
            const cr = crop(c);
            if (!cr) { console.warn("blank", layer, key); continue; }
            const path = `${sex}/${layer}/${key}.webp`;
            await post(path, { dataUrl: cr.canvas.toDataURL("image/webp", quality) });
            const rec = { src: path, x: cr.x, y: cr.y, w: cr.w, h: cr.h };
            if (kind === "base") entry.base[key] = rec;
            else entry.regions[key] = { ...rec, mask: cr.mask };
        }
        manifest.layers[layer] = entry;
    }
    await post(`${sex}/manifest.json`, { json: manifest });
    return manifest;
}

export async function renderAll() {
    const out = {};
    for (const sex of ["male", "female"]) out[sex] = await renderSex(sex);
    a().setSysOverride(null);
    a().hi.setIsolate(null);
    return Object.fromEntries(Object.entries(out).map(([s, m]) => [s, Object.fromEntries(Object.entries(m.layers).map(([l, e]) => [l, Object.keys(e.regions).length]))]));
}

/** One quick test frame (for checking the look) */
export async function testFrame(ids, path, back = false) {
    show(ids); await wait(60);
    const c = snap(back);
    await post(path, { dataUrl: c.toDataURL("image/png") });
}
