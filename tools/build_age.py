"""
Build public/data/age.json — Indian-reference anthropometry (IAP 2015 growth charts for 0–18,
NFHS-5 / ICMR-NIN 2020 for adults) plus a life-stage timeline of what changes in each system.
Anthropometry is interpolated from published median anchor points; nothing is invented.
"""
import json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'public', 'data', 'age.json')

# (age, height_cm, weight_kg) — medians.
# 0–18: Indian Academy of Pediatrics 2015 growth charts (50th centile).
# 20+: NFHS-5 mean adult height (men 164.9 cm, women 152.6 cm); ICMR-NIN 2020 reference
#      body weight (man 65 kg, woman 55 kg); age-related loss ~1 cm/decade after 40,
#      ~2 cm/decade after 70; weight peaks in the 45–55 band then declines.
M_ANCHORS = [
    (0, 49.9, 3.3), (1, 75.7, 9.6), (2, 87.1, 12.2), (3, 96.1, 14.3), (4, 103.3, 16.3),
    (5, 110.0, 18.3), (6, 116.0, 20.5), (7, 121.7, 22.9), (8, 127.3, 25.4), (9, 132.6, 28.1),
    (10, 137.8, 31.2), (11, 143.1, 34.7), (12, 149.1, 38.7), (13, 156.0, 43.6), (14, 162.1, 48.8),
    (15, 166.4, 53.4), (16, 168.7, 57.0), (17, 169.8, 59.5), (18, 170.2, 61.0), (19, 170.4, 62.2),
    (20, 170.5, 63.0), (25, 170.5, 64.5), (30, 170.3, 65.5), (35, 170.1, 66.5), (40, 169.8, 67.0),
    (45, 169.3, 67.5), (50, 168.8, 67.2), (55, 168.2, 66.6), (60, 167.5, 65.8), (65, 166.8, 64.8),
    (70, 166.0, 63.6), (75, 164.8, 62.0), (80, 163.5, 60.2), (85, 162.2, 58.3), (90, 160.9, 56.4),
]
F_ANCHORS = [
    (0, 49.1, 3.2), (1, 74.0, 8.9), (2, 85.7, 11.5), (3, 95.1, 13.9), (4, 102.7, 15.9),
    (5, 109.4, 17.7), (6, 115.1, 19.6), (7, 120.8, 21.8), (8, 126.6, 24.4), (9, 132.5, 27.5),
    (10, 138.6, 31.0), (11, 145.0, 35.0), (12, 150.9, 39.4), (13, 154.7, 43.4), (14, 156.7, 46.6),
    (15, 157.6, 48.9), (16, 158.0, 50.4), (17, 158.2, 51.4), (18, 158.3, 52.0), (19, 158.3, 52.6),
    (20, 158.3, 53.0), (25, 158.2, 54.0), (30, 158.0, 55.0), (35, 157.8, 56.0), (40, 157.5, 56.8),
    (45, 157.0, 57.4), (50, 156.4, 57.6), (55, 155.7, 57.2), (60, 154.9, 56.5), (65, 154.1, 55.6),
    (70, 153.2, 54.5), (75, 152.0, 53.0), (80, 150.7, 51.4), (85, 149.4, 49.6), (90, 148.1, 47.8),
]
# head height ÷ total height. Newborn ≈ 1/4, 6 yr ≈ 1/6, adult ≈ 1/7.5–1/8.
HEAD = [(0, 0.250), (1, 0.225), (2, 0.208), (3, 0.196), (4, 0.186), (5, 0.178), (6, 0.170),
        (8, 0.160), (10, 0.152), (12, 0.145), (14, 0.139), (16, 0.135), (18, 0.132), (25, 0.130),
        (90, 0.130)]


def interp(anchors, age):
    if age <= anchors[0][0]: return anchors[0][1]
    if age >= anchors[-1][0]: return anchors[-1][1]
    for i in range(len(anchors) - 1):
        a0, v0 = anchors[i][0], anchors[i][1]
        a1, v1 = anchors[i + 1][0], anchors[i + 1][1]
        if a0 <= age <= a1:
            t = 0 if a1 == a0 else (age - a0) / (a1 - a0)
            return v0 + (v1 - v0) * t
    return anchors[-1][1]


def series(anchors):
    ages = list(range(0, 21)) + list(range(25, 95, 5))
    out = []
    for a in ages:
        h = interp([(x[0], x[1]) for x in anchors], a)
        w = interp([(x[0], x[2]) for x in anchors], a)
        hr = interp(HEAD, a)
        out.append({"age": a, "height_cm": round(h, 1), "weight_kg": round(w, 1), "head_ratio": round(hr, 3)})
    return out


def ch(target, kind, intensity, note, sex="both", metric=None, visual=None):
    d = {"target": target, "sex": sex, "kind": kind, "intensity": intensity, "note": note}
    if metric: d["metric"] = {"label": metric[0], "value": metric[1]}
    if visual: d["visual"] = visual
    return d


STAGES = [
    dict(id="newborn", **{"from": 0, "to": 1},
         name={"en": "Newborn & infant", "hi": "नवजात और शिशु"},
         summary={"en": "The fastest growth of a whole lifetime. Length rises about 25 cm and weight roughly triples in twelve months. The skull is still separate plates with open fontanelles, most of the skeleton is cartilage, and the brain is wiring itself faster than at any later age.",
                  "hi": "पूरी ज़िंदगी की सबसे तेज़ बढ़त। एक साल में लंबाई करीब 25 सेंटीमीटर बढ़ती है और वज़न लगभग तीन गुना हो जाता है। खोपड़ी की हड्डियाँ अभी जुड़ी नहीं हैं, कंकाल का ज़्यादातर हिस्सा उपास्थि है, और दिमाग सबसे तेज़ी से जुड़ाव बना रहा है।"},
         indian_context="Indian birth weight averages about 2.9 kg, lower than the WHO reference, and low birth weight is common. Exclusive breastfeeding for six months and the national immunisation schedule matter most in this window.",
         changes=[
             ch("skull", "neutral", 0.7, "The skull is six separate plates with soft gaps (fontanelles) between them. The posterior one closes by 2–3 months, the anterior by 12–18 months, which is what lets the brain grow so fast.", metric=("Head circumference", "~35 cm → ~46 cm in year 1"), visual={"opacity": 0.85}),
             ch("brain", "positive", 0.9, "Neurons form synapses faster than at any other time and myelination sweeps through the brain, which is why movement and vision sharpen month by month.", metric=("Brain weight", "~350 g → ~950 g by age 1"), visual={"scale": 1.06}),
             ch("bones", "neutral", 0.6, "Most of the skeleton is still cartilage. The newborn has roughly 270 bones; many will later fuse into the adult 206.", metric=("Bone count", "~270 at birth")),
             ch("teeth", "positive", 0.4, "The first milk teeth (lower central incisors) usually push through between 6 and 10 months. All 20 crowns are already formed inside the jaw at birth.", metric=("Milk teeth erupted", "0 → 6–8 by age 1")),
             ch("lungs", "positive", 0.6, "At the first breath the lungs inflate and the fetal shunts close. Alveoli keep multiplying — most alveoli a person will ever have are made after birth.", metric=("Breathing rate", "30–60 per minute")),
             ch("heart", "neutral", 0.5, "The foramen ovale and ductus arteriosus close in the first days, splitting the circulation into two proper circuits.", metric=("Resting heart rate", "100–160 bpm")),
             ch("immune-system", "neutral", 0.5, "Antibodies passed from the mother protect for a few months while the infant's own immune system learns. The thymus is proportionally at its largest.", visual={"scale": 1.1}),
             ch("spine", "neutral", 0.4, "The spine starts as one C-shaped curve. The neck curve appears with head control (~3 months) and the lower back curve with walking (~1 year)."),
             ch("skin", "neutral", 0.3, "The skin is thin, with an immature barrier, so it loses water and heat quickly."),
         ]),
    dict(id="toddler", **{"from": 1, "to": 3},
         name={"en": "Toddler", "hi": "छोटा बच्चा"},
         summary={"en": "Growth slows down but coordination explodes. Walking, then running and climbing, remodels the hips, knees and spine. The full set of 20 milk teeth arrives, and the brain reaches about 80% of adult volume.",
                  "hi": "बढ़त धीमी हो जाती है पर तालमेल तेज़ी से बढ़ता है। चलना, फिर दौड़ना और चढ़ना, कूल्हों, घुटनों और रीढ़ को नया आकार देते हैं। बीस दूध के दाँत आ जाते हैं और दिमाग बड़े व्यक्ति के आकार का करीब 80% हो जाता है।"},
         indian_context="This is the window where stunting sets in for many Indian children. Growth faltering between 1 and 3 years, driven by low protein quality and repeated infections, is largely irreversible after age 5.",
         changes=[
             ch("brain", "positive", 0.8, "Volume reaches roughly 80% of adult size by age 3. Synapses are massively over-produced and then pruned by use.", metric=("Brain volume", "~80% of adult by age 3"), visual={"scale": 1.03}),
             ch("teeth", "positive", 0.6, "All 20 primary teeth are usually in place by 30–36 months.", metric=("Milk teeth", "20 by ~2.5–3 yr")),
             ch("bones", "positive", 0.6, "Weight-bearing turns cartilage into bone. Bowed legs straighten between 18 months and 3 years as walking loads the growth plates.", metric=("Ossification", "growth plates actively converting")),
             ch("hip-joint", "neutral", 0.5, "The hip socket deepens and the femoral neck angle drops from about 150° toward the adult 125° as walking loads the joint."),
             ch("spine", "positive", 0.5, "The lumbar curve develops with upright walking, giving the spine its adult S-shape."),
             ch("quadriceps", "positive", 0.5, "Leg muscle mass and neural control build rapidly; by 3 a child can run, jump and climb stairs alternating feet."),
             ch("immune-system", "strain", 0.5, "Maternal antibodies are gone and the child meets most common pathogens for the first time. Six to eight infections a year is normal at this age."),
             ch("eyes", "positive", 0.4, "Depth perception and eye–hand coordination mature. The eyeball is still short, so mild long-sightedness is normal."),
         ]),
    dict(id="early-childhood", **{"from": 3, "to": 6},
         name={"en": "Early childhood", "hi": "आरंभिक बचपन"},
         summary={"en": "A steady stretch: about 6–7 cm of height and 2 kg a year. Body fat falls to its lifetime low around age 5–6, the face lengthens, and the immune system is being trained by constant exposure.",
                  "hi": "स्थिर बढ़त: हर साल करीब 6–7 सेंटीमीटर लंबाई और 2 किलो वज़न। पाँच-छह साल की उम्र में शरीर की चर्बी जीवन में सबसे कम होती है, चेहरा लंबा होता है, और लगातार संक्रमण से प्रतिरक्षा तंत्र मज़बूत होता है।"},
         indian_context="School entry brings a jump in infections and in some children the first exposure to packaged snacks and sugary drinks. An early 'adiposity rebound' before age 5 predicts later obesity, and South-Asian children put fat on around the abdomen sooner than other groups.",
         changes=[
             ch("adipose", "neutral", 0.4, "Body fat reaches its lifetime minimum around age 5–6 before the normal 'adiposity rebound'. An early rebound predicts adult obesity.", metric=("Body fat", "lowest point ~5–6 yr"), visual={"scale": 0.94}),
             ch("brain", "positive", 0.6, "Volume reaches about 90% of adult size by age 6. The prefrontal cortex, which handles impulse control, is only starting.", metric=("Brain volume", "~90% of adult by age 6")),
             ch("teeth", "neutral", 0.5, "Permanent teeth are forming in the jaw beneath the milk teeth; the first permanent molars appear at about 6 without any tooth falling out first."),
             ch("tonsils", "neutral", 0.5, "Tonsils and adenoids are at their largest relative to the airway, which is why snoring and mouth breathing are common at this age.", visual={"scale": 1.2}),
             ch("bones", "positive", 0.5, "Long bones lengthen steadily at the growth plates; carpal bones in the wrist ossify one by one, which is how bone age is read on an X-ray."),
             ch("skeletal-muscle", "positive", 0.4, "Muscle grows in proportion to the body. Strength gains at this age come from coordination, not from bigger fibres."),
             ch("lungs", "positive", 0.4, "Alveoli are still multiplying and airway diameter grows, so breathing rate falls toward 20 per minute.", metric=("Breathing rate", "~20–25 per minute")),
         ]),
    dict(id="childhood", **{"from": 6, "to": 10},
         name={"en": "Childhood", "hi": "बचपन"},
         summary={"en": "The calmest growth years. Milk teeth fall out and permanent ones replace them, bone density builds steadily, and physical skill improves faster than size. This is when the habits that decide adult bone mass are set.",
                  "hi": "बढ़त के सबसे शांत साल। दूध के दाँत गिरते हैं और स्थायी दाँत आते हैं, हड्डियों का घनत्व लगातार बढ़ता है, और आकार से ज़्यादा शारीरिक कौशल बढ़ता है। यही वह समय है जब वयस्क हड्डियों की मज़बूती तय करने वाली आदतें बनती हैं।"},
         indian_context="Screen time and academic pressure cut outdoor play sharply here, and vitamin D deficiency is already common in Indian school children despite the sunshine. Bone loaded by running and jumping now pays off for the next sixty years.",
         changes=[
             ch("teeth", "neutral", 0.6, "Milk teeth are shed and replaced from about 6 to 12, starting with the lower incisors.", metric=("Permanent teeth", "6 → ~24 by age 12")),
             ch("bones", "positive", 0.6, "Bone mineral is laid down steadily. Impact activity — running, skipping, jumping — is the strongest signal to build denser bone.", metric=("Bone mass gained", "~40% of adult skeleton laid down in childhood")),
             ch("brain", "positive", 0.5, "Grey matter volume peaks in most regions around 10–12 years, after which unused connections are pruned and myelin thickens."),
             ch("thymus", "neutral", 0.4, "The thymus reaches its maximum absolute size around puberty and then begins to shrink for the rest of life.", visual={"scale": 1.05}),
             ch("eyes", "strain", 0.4, "Near-work and low outdoor time push the eyeball to elongate. Most short-sightedness (myopia) starts in this window.", metric=("Myopia onset", "commonest between 8 and 13")),
             ch("skeletal-muscle", "positive", 0.4, "Muscle grows with the skeleton. Boys and girls have almost identical strength until puberty."),
             ch("heart", "positive", 0.3, "The heart enlarges with the body and resting heart rate settles toward 70–90 bpm.", metric=("Resting heart rate", "~70–90 bpm")),
         ]),
    dict(id="pre-puberty", **{"from": 10, "to": 12},
         name={"en": "Pre-puberty", "hi": "किशोरावस्था से पहले"},
         summary={"en": "Hormones start moving before anything is visible. The pituitary begins pulsing luteinising hormone at night, the adrenal glands wake up, and in girls the growth spurt is already beginning.",
                  "hi": "कुछ दिखने से पहले ही हार्मोन बदलने लगते हैं। पिट्यूटरी ग्रंथि रात में हार्मोन छोड़ने लगती है, अधिवृक्क ग्रंथियाँ सक्रिय होती हैं, और लड़कियों में लंबाई बढ़ने की तेज़ी शुरू हो चुकी होती है।"},
         indian_context="Indian girls typically start puberty earlier than boys, with breast development around 10 and menarche at a median of about 12.5 years — earlier in urban and higher-income groups than a generation ago.",
         changes=[
             ch("pituitary", "neutral", 0.7, "Night-time pulses of luteinising hormone from the pituitary restart the reproductive axis that has been quiet since infancy."),
             ch("adrenal-glands", "neutral", 0.5, "Adrenarche: the adrenal glands begin producing androgens, which brings body odour, oily skin and the first pubic hair — before the gonads switch on."),
             ch("bones", "positive", 0.6, "Growth plates accelerate. Girls typically start their height spurt around 10, boys about two years later.", metric=("Peak height velocity", "girls ~11–12, boys ~13–14")),
             ch("ovaries", "positive", 0.6, "Ovaries enlarge and begin producing oestrogen, which starts breast development.", sex="female", visual={"scale": 1.3}),
             ch("breasts", "positive", 0.6, "Breast budding (thelarche) is usually the first visible sign of puberty in girls, at around 10.", sex="female", visual={"scale": 1.2}),
             ch("testes", "positive", 0.6, "Testicular enlargement is the first sign of puberty in boys, typically from about 11–12.", sex="male", visual={"scale": 1.25}),
             ch("adipose", "neutral", 0.4, "Girls begin adding fat at the hips and thighs; boys' body fat stays flat or falls.", sex="female"),
         ]),
    dict(id="puberty", **{"from": 12, "to": 15},
         name={"en": "Puberty", "hi": "यौवनारंभ"},
         summary={"en": "The largest change to the body since infancy. Sex hormones reshape the skeleton, the muscles, the voice, the skin and the brain at the same time, and height climbs faster than at any time since age two.",
                  "hi": "शिशु अवस्था के बाद शरीर में सबसे बड़ा बदलाव। सेक्स हार्मोन एक साथ कंकाल, पेशियों, आवाज़, त्वचा और दिमाग को बदलते हैं, और लंबाई दो साल की उम्र के बाद सबसे तेज़ी से बढ़ती है।"},
         indian_context="Median age at menarche in India is around 12.5 years. Iron-deficiency anaemia becomes very common in adolescent Indian girls once menstruation starts, and adolescent boys often begin gym training without enough protein or sleep to support it.",
         changes=[
             ch("bones", "positive", 0.9, "Peak height velocity: about 8–9 cm a year in girls and 9–10 cm in boys. The hands and feet finish first, then the limbs, then the trunk.", metric=("Growth rate", "8–10 cm per year at the peak")),
             ch("skeletal-muscle", "positive", 0.8, "Testosterone drives a large jump in muscle mass and strength in boys; girls gain muscle too, but far less.", sex="male", metric=("Muscle mass", "roughly doubles through male puberty"), visual={"scale": 1.08}),
             ch("skeletal-muscle", "positive", 0.5, "Muscle mass increases with the growth spurt, though less steeply than in boys.", sex="female", visual={"scale": 1.03}),
             ch("pelvis", "positive", 0.7, "Oestrogen widens the pelvis and tilts the hip sockets, changing the carrying angle of the knee.", sex="female", visual={"scale": 1.06}),
             ch("uterus", "positive", 0.7, "The uterus grows from a small tube to its adult pear shape, and the endometrium begins its monthly cycle. Menarche follows about two years after breast budding.", sex="female", visual={"scale": 1.6}),
             ch("ovaries", "positive", 0.6, "Ovulation begins, though cycles are often irregular for the first year or two.", sex="female"),
             ch("testes", "positive", 0.7, "The testes reach adult volume and begin producing sperm.", sex="male", visual={"scale": 1.5}),
             ch("airways", "neutral", 0.6, "The larynx enlarges and the vocal folds lengthen, dropping the male voice by about an octave.", sex="male"),
             ch("skin", "strain", 0.6, "Androgens enlarge the sebaceous glands; acne peaks in mid-to-late puberty."),
             ch("prefrontal-cortex", "neutral", 0.5, "The emotional and reward systems mature years before the prefrontal cortex does, which is the biological basis of adolescent risk-taking."),
             ch("heart", "positive", 0.5, "The heart and lungs enlarge; boys gain more haemoglobin, which raises oxygen-carrying capacity.", metric=("Haemoglobin", "rises ~1–2 g/dL in boys")),
         ]),
    dict(id="adolescence", **{"from": 15, "to": 18},
         name={"en": "Late adolescence", "hi": "किशोरावस्था का अंत"},
         summary={"en": "Height finishes as the growth plates close, but muscle, bone density and the brain keep developing. Girls typically stop growing around 15–16, boys around 17–18.",
                  "hi": "ग्रोथ प्लेट बंद होने के साथ लंबाई रुक जाती है, लेकिन पेशियाँ, हड्डियों का घनत्व और दिमाग बनते रहते हैं। लड़कियों की लंबाई आमतौर पर 15–16 पर और लड़कों की 17–18 पर रुकती है।"},
         indian_context="This is when many Indian teenagers start gym training and supplements, often on 4–6 hours of sleep during board-exam years. Growth plates are still open early in this stage, so heavy loading with poor technique matters more than at any later age.",
         changes=[
             ch("bones", "neutral", 0.6, "Growth plates fuse — earlier in girls than boys. Once closed, height is final, but bone mineral keeps accumulating for another decade.", metric=("Growth plate closure", "girls ~15–16, boys ~17–18")),
             ch("skeletal-muscle", "positive", 0.7, "Muscle mass keeps rising, especially in boys. This is the steepest part of the strength curve.", sex="male", visual={"scale": 1.04}),
             ch("teeth", "neutral", 0.4, "Third molars (wisdom teeth) erupt between 17 and 25, often with too little room in the jaw."),
             ch("prefrontal-cortex", "positive", 0.6, "Myelination of the prefrontal cortex continues; planning and impulse control keep improving into the mid-twenties."),
             ch("skin", "strain", 0.4, "Acne usually peaks and then starts to settle as hormone levels stabilise."),
             ch("lungs", "positive", 0.5, "Lung volume approaches its maximum; peak lung function is reached in the early twenties.", metric=("Peak lung function", "reached at ~20–25 yr")),
             ch("uterus", "neutral", 0.4, "Menstrual cycles become regular as the ovulatory axis matures.", sex="female"),
         ]),
    dict(id="young-adult", **{"from": 18, "to": 25},
         name={"en": "Young adult", "hi": "युवावस्था"},
         summary={"en": "Everything peaks in this window or just after: bone mass, muscle, lung function, reaction time, fertility. Nothing is declining yet, which makes it the cheapest decade to build a body that lasts.",
                  "hi": "इसी दौर में या इसके ठीक बाद सब कुछ अपने चरम पर होता है: हड्डियों का द्रव्यमान, पेशियाँ, फेफड़ों की क्षमता, प्रतिक्रिया की गति, प्रजनन क्षमता। अभी कुछ भी घट नहीं रहा, इसलिए टिकाऊ शरीर बनाने के लिए यह सबसे सस्ता दशक है।"},
         indian_context="Indians develop insulin resistance and central obesity at a lower BMI than Europeans, so an Indian at BMI 24 can already carry the metabolic risk of a European at 28. The Asian-Indian cut-off for overweight is BMI 23, not 25.",
         changes=[
             ch("bones", "positive", 0.8, "Peak bone mass is reached between about 25 and 30. Whatever is banked here is what has to last the rest of life.", metric=("Peak bone mass", "reached ~25–30 yr")),
             ch("skeletal-muscle", "positive", 0.7, "Muscle mass and strength peak in the twenties and hold through the early thirties.", metric=("Peak strength", "~20–30 yr")),
             ch("heart", "positive", 0.6, "Maximum heart rate and VO₂max are at their highest.", metric=("Max heart rate", "≈ 220 − age, so ~198 at 22")),
             ch("brain", "positive", 0.6, "Processing speed and working memory peak in the twenties, while the prefrontal cortex finishes maturing around 25."),
             ch("ovaries", "positive", 0.6, "Fertility is at its highest in the early twenties and starts a slow decline after about 30.", sex="female"),
             ch("testes", "positive", 0.5, "Testosterone is at its lifetime peak in the late teens and twenties.", sex="male", metric=("Total testosterone", "peak in late teens–20s")),
             ch("lungs", "positive", 0.5, "Lung function peaks around 20–25 and declines slowly from then on.", metric=("FEV₁", "peaks ~20–25 yr")),
             ch("cartilage", "positive", 0.4, "Joint cartilage is at maximum thickness and water content."),
         ]),
    dict(id="prime", **{"from": 25, "to": 35},
         name={"en": "Prime adult", "hi": "पूर्ण युवावस्था"},
         summary={"en": "The plateau, and the first quiet losses. Muscle starts dropping by roughly 3–8% per decade after 30 unless it is trained, metabolic rate edges down with it, and skin collagen begins to fall about 1% a year.",
                  "hi": "यह पठार है, और यहीं से चुपचाप गिरावट शुरू होती है। तीस के बाद पेशियाँ हर दशक करीब 3–8% घटती हैं अगर उन्हें ट्रेन न किया जाए, उसी के साथ चयापचय दर गिरती है, और त्वचा का कोलेजन हर साल लगभग 1% कम होने लगता है।"},
         indian_context="Type-2 diabetes and coronary artery disease appear roughly a decade earlier in Indians than in Europeans, often in the thirties. Waist circumference above 90 cm in men and 80 cm in women is the Indian risk threshold.",
         changes=[
             ch("skeletal-muscle", "negative", 0.5, "Sarcopenia begins: about 3–8% of muscle mass is lost per decade after 30 without resistance training.", metric=("Muscle loss", "3–8% per decade after 30"), visual={"scale": 0.98}),
             ch("bones", "neutral", 0.4, "Bone mass holds at its peak through the early thirties, then begins a slow decline."),
             ch("skin", "negative", 0.4, "Dermal collagen falls by roughly 1% a year and elastin fragments; the first fine lines appear.", metric=("Collagen", "−~1% per year from ~25")),
             ch("eyes", "neutral", 0.3, "The lens is losing flexibility, though most people notice nothing until their forties."),
             ch("kidneys", "neutral", 0.3, "Kidney filtration is at its plateau; measurable decline starts after 40.", metric=("eGFR", "~100–120 mL/min at 30")),
             ch("adipose", "negative", 0.4, "Fat redistributes toward the abdomen and inside the organs, especially in South Asians, even when weight is unchanged."),
             ch("ovaries", "negative", 0.4, "Both the number and quality of eggs decline noticeably after 32–35.", sex="female", metric=("Fertility", "declines faster after ~35")),
             ch("testes", "negative", 0.3, "Testosterone falls by roughly 1% a year from about 30.", sex="male", metric=("Testosterone", "−~1% per year after 30")),
         ]),
    dict(id="midlife-early", **{"from": 35, "to": 45},
         name={"en": "Early midlife", "hi": "अधेड़ उम्र की शुरुआत"},
         summary={"en": "The decade where hidden change becomes visible. Reading glasses arrive, grey hair spreads, VO₂max is falling about 10% per decade, and blood pressure and blood sugar start drifting up.",
                  "hi": "यह वह दशक है जब छिपे हुए बदलाव दिखने लगते हैं। पढ़ने का चश्मा आ जाता है, बाल सफ़ेद होने लगते हैं, VO₂max हर दशक करीब 10% गिरता है, और रक्तचाप तथा रक्त शर्करा ऊपर खिसकने लगते हैं।"},
         indian_context="The average age of a first heart attack in India is in the mid-forties, about ten years earlier than in Western populations. Most Indian adults in this band have vitamin D levels below the sufficiency threshold.",
         changes=[
             ch("eyes", "negative", 0.7, "Presbyopia: the lens stiffens until near focus fails, usually between 40 and 45. Almost universal.", metric=("Reading distance", "arms get too short at ~42–45")),
             ch("hair", "negative", 0.5, "Melanocytes in the hair follicles die off; grey hair spreads. Male pattern balding is usually well established by 40.", metric=("Greying", "~50% of people have some grey by 50")),
             ch("heart", "negative", 0.5, "VO₂max falls about 10% per decade from the thirties, faster if untrained. Arterial walls stiffen and systolic blood pressure drifts up.", metric=("VO₂max", "−~10% per decade")),
             ch("brain", "negative", 0.4, "Total brain volume declines by roughly 0.2–0.5% a year from about 40, mostly in the prefrontal cortex and hippocampus.", metric=("Brain volume", "−0.2–0.5% per year after 40")),
             ch("skeletal-muscle", "negative", 0.5, "Muscle loss continues and Type II (fast) fibres shrink first, so power drops before endurance does.", visual={"scale": 0.96}),
             ch("kidneys", "negative", 0.4, "Glomerular filtration rate falls by roughly 1 mL/min per year after 40.", metric=("eGFR", "−~1 mL/min/year after 40")),
             ch("spine", "negative", 0.4, "Intervertebral discs lose water and height, which is where the first centimetre of lost height comes from.", visual={"opacity": 0.9}),
             ch("ovaries", "negative", 0.5, "The follicle pool is running down; cycles may shorten as perimenopause approaches.", sex="female"),
             ch("thymus", "negative", 0.5, "The thymus is largely replaced by fat by 40, so fewer new T-cells are produced.", visual={"scale": 0.5}),
         ]),
    dict(id="midlife-late", **{"from": 45, "to": 55},
         name={"en": "Late midlife", "hi": "अधेड़ उम्र"},
         summary={"en": "For women, menopause reorganises the whole body — bone loss accelerates sharply, cholesterol rises and fat moves to the abdomen. For men the change is slower but the same systems are drifting.",
                  "hi": "महिलाओं के लिए रजोनिवृत्ति पूरे शरीर को बदल देती है — हड्डियों का क्षय तेज़ हो जाता है, कोलेस्ट्रॉल बढ़ता है और चर्बी पेट पर जमा होती है। पुरुषों में बदलाव धीमा होता है पर वही तंत्र खिसक रहे होते हैं।"},
         indian_context="Indian women reach menopause at a median of about 46 years, roughly five years earlier than in Western countries, so the accelerated bone-loss window starts earlier and lasts longer.",
         changes=[
             ch("ovaries", "negative", 0.8, "Menopause: the follicle pool is exhausted and oestrogen falls sharply. Indian median age is about 46.", sex="female", metric=("Menopause", "median ~46 yr in India"), visual={"scale": 0.75}),
             ch("bones", "negative", 0.8, "Oestrogen loss removes the brake on bone resorption. Women lose 1–2% of bone mass a year for the first 5–7 years after menopause.", sex="female", metric=("Bone loss", "1–2% per year post-menopause"), visual={"opacity": 0.82}),
             ch("bones", "negative", 0.4, "Bone loss continues in men too, but at roughly a third of the female rate.", sex="male", visual={"opacity": 0.94}),
             ch("uterus", "negative", 0.6, "Without oestrogen the uterus and endometrium shrink and periods stop.", sex="female", visual={"scale": 0.8}),
             ch("breasts", "neutral", 0.5, "Glandular tissue is replaced by fat, which changes breast density and makes mammograms easier to read.", sex="female"),
             ch("arteries", "negative", 0.5, "LDL cholesterol rises after menopause and the female cardiovascular advantage narrows toward the male level.", sex="female"),
             ch("prostate", "neutral", 0.5, "Benign prostatic enlargement usually begins in the late forties and continues for the rest of life.", sex="male", visual={"scale": 1.1}),
             ch("skeletal-muscle", "negative", 0.5, "Muscle loss continues at 3–8% per decade and accelerates if activity drops.", visual={"scale": 0.94}),
             ch("ears", "negative", 0.4, "High-frequency hearing loss (presbycusis) becomes measurable, usually noticed first in noisy rooms."),
             ch("skin", "negative", 0.4, "Collagen loss accelerates after menopause — up to 30% is lost in the first five years.", sex="female"),
         ]),
    dict(id="older-adult", **{"from": 55, "to": 65},
         name={"en": "Older adult", "hi": "प्रौढ़ावस्था"},
         summary={"en": "Losses that were invisible now show up in daily life: grip strength, stair climbing, balance and recovery time. Most chronic disease diagnoses cluster in this decade.",
                  "hi": "जो नुकसान अब तक नहीं दिखता था, वह रोज़मर्रा में दिखने लगता है: पकड़ की ताकत, सीढ़ी चढ़ना, संतुलन और उबरने का समय। ज़्यादातर पुरानी बीमारियों की पहचान इसी दशक में होती है।"},
         indian_context="This is the decade when most Indian adults are diagnosed with type-2 diabetes or hypertension, and knee osteoarthritis is very common, made worse by floor-sitting and squatting postures in daily life.",
         changes=[
             ch("skeletal-muscle", "negative", 0.6, "Muscle loss speeds up after 60 and motor units are lost outright, so power falls faster than size.", metric=("Grip strength", "declines measurably from ~55"), visual={"scale": 0.94}),
             ch("knee-joint", "negative", 0.6, "Cartilage thins and osteoarthritis becomes common, especially at the knee.", visual={"opacity": 0.8}),
             ch("bones", "negative", 0.6, "Bone loss continues; the first fragility fractures — wrist and vertebrae — appear in this decade.", visual={"opacity": 0.8}),
             ch("eyes", "negative", 0.5, "Cataract begins to form in most people over 55, and contrast sensitivity falls before visual acuity does."),
             ch("arteries", "negative", 0.6, "Arterial stiffness raises systolic pressure while diastolic falls, widening the pulse pressure.", metric=("Systolic BP", "rises steadily with age")),
             ch("brain", "negative", 0.4, "Processing speed slows, though vocabulary and accumulated knowledge keep improving."),
             ch("pancreas", "negative", 0.5, "Beta-cell function declines and insulin resistance rises; this is peak decade for a type-2 diabetes diagnosis in India."),
             ch("skin", "negative", 0.5, "Skin thins, wound healing slows and sweat glands become less responsive.", visual={"opacity": 0.94}),
             ch("prostate", "neutral", 0.6, "Prostate enlargement causes urinary symptoms in a large share of men over 60.", sex="male", visual={"scale": 1.15}),
         ]),
    dict(id="senior", **{"from": 65, "to": 75},
         name={"en": "Senior", "hi": "वरिष्ठ आयु"},
         summary={"en": "Reserve capacity — the gap between what the body can do and what daily life demands — narrows across every organ. Muscle, balance and immune response are the ones that decide independence.",
                  "hi": "हर अंग में आरक्षित क्षमता घटती है — यानी शरीर जो कर सकता है और रोज़मर्रा में जितना चाहिए, उसका अंतर कम होता जाता है। पेशियाँ, संतुलन और प्रतिरक्षा ही तय करती हैं कि स्वतंत्रता बनी रहेगी या नहीं।"},
         indian_context="Falls and hip fractures rise sharply here, and Indian homes with squat toilets and steep stairs raise that risk. Vitamin D and B12 deficiency are both very common and both worsen muscle weakness and balance.",
         changes=[
             ch("skeletal-muscle", "negative", 0.7, "Sarcopenia is now clinically significant; loss of fast-twitch fibres makes it hard to catch a stumble.", metric=("Muscle mass", "−~30% from peak by 70"), visual={"scale": 0.9}),
             ch("bones", "negative", 0.7, "Osteoporosis is common, especially in women. Hip fracture risk rises steeply.", sex="female", visual={"opacity": 0.7}),
             ch("bones", "negative", 0.5, "Bone density continues to fall in men, about a decade behind women.", sex="male", visual={"opacity": 0.82}),
             ch("brain", "negative", 0.5, "Brain volume loss continues; the hippocampus shrinks about 1% a year, which is why recent memory fades first.", visual={"scale": 0.96}),
             ch("immune-system", "negative", 0.6, "Immunosenescence: fewer naive T-cells, weaker vaccine responses and slower infection clearance."),
             ch("ears", "negative", 0.6, "Age-related hearing loss affects roughly a third of people over 65 and is a strong independent risk factor for dementia."),
             ch("heart", "negative", 0.5, "Maximum heart rate and cardiac reserve fall; the heart wall stiffens and fills less easily.", metric=("Max heart rate", "≈ 150 at age 70")),
             ch("kidneys", "negative", 0.5, "Filtration has typically fallen 30–40% from its peak, which changes how most drugs are cleared."),
             ch("spine", "negative", 0.5, "Vertebral height loss and forward posture account for most of the visible loss of height.", visual={"opacity": 0.8}),
             ch("testes", "negative", 0.4, "Testosterone continues its slow fall; testicular volume decreases.", sex="male", visual={"scale": 0.92}),
         ]),
    dict(id="elderly", **{"from": 75, "to": 85},
         name={"en": "Elderly", "hi": "वृद्धावस्था"},
         summary={"en": "Multiple systems now operate close to their limit at the same time. Balance, muscle, bone and cognition interact, so a single fall can change everything.",
                  "hi": "अब कई तंत्र एक साथ अपनी सीमा के करीब काम करते हैं। संतुलन, पेशियाँ, हड्डियाँ और सोचने-समझने की क्षमता आपस में जुड़ी होती हैं, इसलिए एक गिरना ही सब कुछ बदल सकता है।"},
         indian_context="Most elderly Indians live in multi-generational homes, which supports daily care but often means less independent walking. Undernutrition, not obesity, is the bigger risk in this age group.",
         changes=[
             ch("skeletal-muscle", "negative", 0.8, "Muscle mass may be 30–40% below peak. Strength training still works at this age, which makes it the highest-value intervention.", visual={"scale": 0.86}),
             ch("bones", "negative", 0.8, "Osteoporosis is the norm rather than the exception; vertebral compression fractures are often silent.", visual={"opacity": 0.62}),
             ch("brain", "negative", 0.6, "Brain volume is roughly 10% below peak. Most dementia diagnoses fall in this decade.", visual={"scale": 0.93}),
             ch("eyes", "negative", 0.6, "Cataract is near-universal, and macular degeneration and glaucoma become common causes of vision loss."),
             ch("heart", "negative", 0.6, "Heart failure with preserved ejection fraction and atrial fibrillation become common as the myocardium stiffens and fibroses."),
             ch("cartilage", "negative", 0.6, "Joint cartilage is thin and often locally absent; osteoarthritis limits daily movement.", visual={"opacity": 0.65}),
             ch("skin", "negative", 0.6, "The skin is thin and fragile with little subcutaneous fat, so it bruises and tears easily.", visual={"opacity": 0.88}),
             ch("immune-system", "negative", 0.6, "Infections present atypically — often as confusion or a fall rather than fever."),
             ch("lungs", "negative", 0.5, "Chest wall stiffness and weaker respiratory muscles cut reserve; pneumonia becomes far more dangerous."),
             ch("prostate", "neutral", 0.5, "Prostate enlargement continues and urinary symptoms are near-universal in men this age.", sex="male", visual={"scale": 1.2}),
         ]),
    dict(id="very-elderly", **{"from": 85, "to": 90},
         name={"en": "Very elderly", "hi": "अति वृद्धावस्था"},
         summary={"en": "Beyond 85 the variation between individuals is larger than at any other age. Some walk unaided and stay sharp; others depend on care for everything. Function, not the number, is what matters here.",
                  "hi": "85 के बाद लोगों के बीच फ़र्क किसी भी और उम्र से ज़्यादा होता है। कुछ बिना सहारे चलते और तेज़ दिमाग़ रखते हैं, कुछ हर काम के लिए दूसरों पर निर्भर होते हैं। यहाँ उम्र का आंकड़ा नहीं, काम करने की क्षमता मायने रखती है।"},
         indian_context="India's over-85 population is growing fast. Sarcopenia plus low protein intake is the dominant reversible problem, and simple protein and resistance work still produce measurable gains at this age.",
         changes=[
             ch("skeletal-muscle", "negative", 0.8, "Muscle mass is at its lowest, and losing the ability to rise from a chair is the usual tipping point for independence.", visual={"scale": 0.84}),
             ch("bones", "negative", 0.8, "Fracture risk is at its highest; a hip fracture at this age carries a high one-year mortality.", visual={"opacity": 0.58}),
             ch("brain", "negative", 0.6, "Brain volume continues to fall, but rates vary enormously between individuals.", visual={"scale": 0.92}),
             ch("heart", "negative", 0.6, "Cardiac reserve is minimal; even modest illness can tip into heart failure."),
             ch("kidneys", "negative", 0.6, "Filtration is often half of peak, so drug doses need adjusting."),
             ch("immune-system", "negative", 0.6, "Vaccine responses are weak and infections carry much higher risk."),
             ch("skin", "negative", 0.5, "Very thin skin with almost no subcutaneous fat; pressure injury risk is high.", visual={"opacity": 0.85}),
             ch("ears", "negative", 0.6, "Significant hearing loss is close to universal and drives social isolation."),
         ]),
]

data = {"anthro": {"male": series(M_ANCHORS), "female": series(F_ANCHORS)}, "stages": STAGES}
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('stages:', len(STAGES), 'male points:', len(data['anthro']['male']), 'size KB:', os.path.getsize(OUT) // 1024)
covered = set()
for s in STAGES: covered.update(c['target'] for c in s['changes'])
print('targets used:', len(covered))
print(sorted(covered))
