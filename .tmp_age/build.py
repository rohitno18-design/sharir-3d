# Assembles src/data/age.json from anthro tables + stage fragments.
import json, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "data", "age.json")

AGES = list(range(0, 21)) + list(range(25, 91, 5))

# Indian medians. 0-5: WHO-based IAP charts scaled to Indian birth/5-yr anchors
# (birth ~2.9 kg / ~49.5 cm; 5 yr ~108 cm / 17 kg). 5-18: IAP 2015 50th centile
# shape, scaled so adult height converges on NFHS-5 (men ~165-166, women ~152-153)
# rather than the affluent-urban IAP 18-yr value (~170 / ~156). Adults: ICMR-NIN
# 2020 reference man 65 kg / woman 55 kg; height -1 cm/decade after 40,
# -2 cm/decade after 70; weight peaks 45-55 then falls.

M_H = {0:49.5,1:74.5,2:85.5,3:94.0,4:101.5,5:108.0,6:114.0,7:119.5,8:124.5,9:129.5,
       10:134.5,11:139.5,12:145.0,13:151.0,14:156.5,15:160.5,16:163.0,17:164.5,18:165.5,
       19:166.0,20:166.0,25:166.0,30:166.0,35:166.0,40:166.0,45:165.5,50:165.0,55:164.5,
       60:164.0,65:163.5,70:163.0,75:162.0,80:161.0,85:160.0,90:159.0}
M_W = {0:2.9,1:9.0,2:11.5,3:13.5,4:15.3,5:17.0,6:18.8,7:20.8,8:23.0,9:25.5,
       10:28.0,11:31.0,12:34.5,13:38.5,14:43.0,15:47.5,16:51.0,17:53.5,18:55.5,
       19:57.0,20:58.0,25:61.0,30:63.5,35:65.0,40:66.0,45:66.5,50:66.5,55:66.0,
       60:65.0,65:63.5,70:62.0,75:60.0,80:58.0,85:56.0,90:54.0}
F_H = {0:49.0,1:73.0,2:84.0,3:92.5,4:100.0,5:107.0,6:113.0,7:118.5,8:123.5,9:128.5,
       10:134.0,11:140.0,12:145.5,13:149.0,14:151.0,15:152.0,16:152.5,17:152.5,18:152.5,
       19:152.5,20:152.5,25:152.5,30:152.5,35:152.5,40:152.5,45:152.0,50:151.5,55:151.0,
       60:150.5,65:150.0,70:149.5,75:148.5,80:147.5,85:146.5,90:145.5}
F_W = {0:2.8,1:8.4,2:10.9,3:13.0,4:14.8,5:16.5,6:18.3,7:20.3,8:22.5,9:25.0,
       10:28.0,11:31.5,12:35.5,13:39.5,14:43.0,15:45.5,16:47.5,17:48.5,18:49.5,
       19:50.0,20:50.5,25:52.5,30:54.0,35:55.0,40:56.0,45:56.5,50:57.0,55:56.5,
       60:55.5,65:54.5,70:53.0,75:51.5,80:50.0,85:48.0,90:46.0}
# head height / total height. Newborn ~1/4, age 6 ~1/6, adult ~1/7.5-1/8.
# Rises marginally in old age only because trunk height is lost, not head.
HR = {0:0.25,1:0.22,2:0.20,3:0.19,4:0.18,5:0.175,6:0.17,7:0.165,8:0.16,9:0.157,
      10:0.153,11:0.15,12:0.147,13:0.143,14:0.14,15:0.137,16:0.135,17:0.133,18:0.131,
      19:0.13,20:0.13,25:0.13,30:0.13,35:0.13,40:0.13,45:0.13,50:0.13,55:0.13,
      60:0.13,65:0.13,70:0.13,75:0.131,80:0.131,85:0.132,90:0.132}

def series(h, w):
    return [{"age": a, "height_cm": h[a], "weight_kg": w[a], "head_ratio": HR[a]} for a in AGES]

def check_monotone(name, h, w):
    # heights must rise to 20, then never rise; weights rise to 20 at least
    for a, b in zip(AGES, AGES[1:]):
        if b <= 20 and (h[b] < h[a] or w[b] < w[a]):
            raise SystemExit(f"{name}: non-monotone growth at {a}->{b}")
        if a >= 20 and h[b] > h[a]:
            raise SystemExit(f"{name}: adult height rises at {a}->{b}")
        if abs(h[b]-h[a]) > 30 or abs(w[b]-w[a]) > 8:
            raise SystemExit(f"{name}: jump at {a}->{b}")

check_monotone("male", M_H, M_W)
check_monotone("female", F_H, F_W)

stages = []
for f in sorted(glob.glob(os.path.join(HERE, "stages_*.json"))):
    with open(f, encoding="utf-8") as fh:
        stages.extend(json.load(fh))

# contiguity + vocabulary checks
targets = set()
with open(os.path.join(HERE, "..", "src", "data", "targets.js"), encoding="utf-8") as fh:
    import re
    targets = set(re.findall(r"^\s*'([a-z-]+)':", fh.read(), re.M))
prev_to = 0
for s in stages:
    assert s["from"] == prev_to, f"gap before stage {s['id']}"
    prev_to = s["to"]
    assert 5 <= len(s["changes"]) <= 12, f"{s['id']} has {len(s['changes'])} changes"
    for c in s["changes"]:
        assert c["target"] in targets, f"{s['id']}: bad target {c['target']}"
        assert c["sex"] in ("male","female","both"), f"{s['id']}: bad sex"
        assert c["kind"] in ("positive","negative","strain","neutral"), f"{s['id']}: bad kind"
        assert 0.1 <= c["intensity"] <= 1.0, f"{s['id']}: intensity"
        v = c.get("visual", {})
        if "scale" in v: assert 0.85 <= v["scale"] <= 1.2, f"{s['id']}/{c['target']}: scale {v['scale']}"
        if "opacity" in v: assert 0.35 <= v["opacity"] <= 1.0, f"{s['id']}/{c['target']}: opacity"
assert prev_to == 90, "stages must end at 90"

data = {"anthro": {"male": series(M_H, M_W), "female": series(F_H, F_W)}, "stages": stages}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
print("wrote", os.path.abspath(OUT), "| anthro:", len(data["anthro"]["male"]), "| stages:", len(stages),
      "| changes:", sum(len(s["changes"]) for s in stages))
