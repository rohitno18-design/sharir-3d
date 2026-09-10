/**
 * Target vocabulary → registry matching rules.
 * Each target resolves (at runtime) to a set of part ids from the registry.
 *   sys:  systems allowed (registry `sys`)
 *   sub:  optional subsystem filter (registry `sub`)
 *   re:   regex tested against display name (`n`)
 *   ex:   optional exclusion regex
 *   g:    optional glb filter
 */
export const TARGETS = {
  // ---- whole / surface ----
  'whole-body':      { label: 'Whole body', sys: ['integumentary'], re: /./, ex: /hair|eyelash|eyebrow/i },
  'skin':            { label: 'Skin', sys: ['integumentary'], re: /./, ex: /hair|eyelash|eyebrow/i },
  'hair':            { label: 'Hair', sys: ['integumentary'], re: /hair|eyelash|eyebrow/i },
  'face':            { label: 'Face', sys: ['integumentary'], sub: 'regions of head', re: /./, ex: /hair|eyelash|eyebrow|occipital|parietal/i },
  'hands':           { label: 'Hands', sys: ['integumentary'], re: /hand|palm|finger|thumb|hypothenar|thenar|metacarpal/i },
  'feet':            { label: 'Feet', sys: ['integumentary'], re: /\bfoot\b|sole|heel|toe|calcaneal|plantar|dorsum of foot/i },
  'adipose':         { label: 'Body fat (visceral & subcutaneous)', sys: ['integumentary'], re: /umbilical|hypochondriac|epigastric|lateral region of abdomen|inguinal|hypogastric|gluteal region|lumbar region|hip region|femoral triangle|anterior region of thigh|posterior region of thigh|mammary|presternal|pectoral/i },

  // ---- nervous ----
  'brain':           { label: 'Brain', sys: ['nervous'], sub: 'central nervous system', re: /./, ex: /spinal|ependyma|mening|dura|arachnoid|pia mater|reticular formation/i },
  'cerebral-cortex': { label: 'Cerebral cortex', sys: ['nervous'], re: /gyrus|cortex|lobe|insula|operculum|sulcus|pole/i, ex: /cerebell|lobe of/i },
  'prefrontal-cortex': { label: 'Prefrontal cortex', sys: ['nervous'], re: /frontal (lobe|pole|gyrus|gyri)|prefrontal|orbital gyri|superior frontal|middle frontal|inferior frontal|gyrus rectus|orbital part|triangular part|opercular part/i },
  'hippocampus':     { label: 'Hippocampus', sys: ['nervous'], re: /hippocamp|dentate gyrus|parahippocampal|subiculum|entorhinal|fornix/i },
  'hypothalamus':    { label: 'Hypothalamus', sys: ['nervous'], re: /hypothalam|mammillary|infundibul|tuber cinereum|optic chiasm/i },
  'amygdala':        { label: 'Amygdala', sys: ['nervous'], re: /amygdal/i },
  'basal-ganglia':   { label: 'Basal ganglia', sys: ['nervous'], re: /putamen|caudate|pallidus|striatum|substantia nigra|subthalamic|lentiform|accumbens/i },
  'cerebellum':      { label: 'Cerebellum', sys: ['nervous'], re: /cerebell|vermis|flocculus|dentate nucleus/i },
  'brainstem':       { label: 'Brainstem', sys: ['nervous'], re: /brainstem|brain stem|\bpons\b|midbrain|medulla oblongata|tegmentum|tectum|cerebral peduncle|colliculus|pyramid|olive/i },
  'spinal-cord':     { label: 'Spinal cord', sys: ['nervous'], re: /spinal cord|segment|cervical enlargement|lumbosacral enlargement|conus medullaris|filum terminale|cauda equina|posterior horn|anterior horn|lateral horn/i, sub: 'central nervous system' },
  'peripheral-nerves': { label: 'Peripheral nerves', sys: ['nervous'], sub: 'peripheral nervous system', re: /nerve|plexus|ramus|rami|branch|root|trunk|cord/i },
  'sciatic-nerve':   { label: 'Sciatic nerve', sys: ['nervous'], re: /sciatic|tibial nerve|common fibular nerve|fibular nerve|sural nerve|plantar nerve/i },
  'vagus-nerve':     { label: 'Vagus nerve', sys: ['nervous'], re: /vagus|vagal|recurrent laryngeal/i },
  'autonomic-nerves': { label: 'Autonomic nervous system', sys: ['nervous'], re: /sympathetic|parasympathetic|ganglion|splanchnic|coeliac|celiac|hypogastric plexus|cardiac plexus|pulmonary plexus|oesophageal plexus|esophageal plexus|mesenteric plexus|aortic plexus/i },
  'eyes':            { label: 'Eyes', sys: ['senses'], re: /eye|cornea|\blens\b|retina|sclera|iris|choroid|vitreous|ciliary|conjunctiva|optic|macula|pupil|lacrimal/i },
  'retina':          { label: 'Retina & optic nerve', sys: ['senses', 'nervous'], re: /retina|optic nerve|optic disc|macula|optic chiasm|optic tract/i },
  'ears':            { label: 'Ears', sys: ['senses'], re: /\bear\b|cochlea|tympan|labyrinth|semicircular|vestibul|ossicle|auricle|auditory|malleus|incus|stapes|utricle|saccule/i },
  'pituitary':       { label: 'Pituitary gland', sys: ['endocrine', 'nervous'], re: /hypophys|pituitary|neurohypophysis|adenohypophysis/i },
  'pineal':          { label: 'Pineal gland', sys: ['endocrine', 'nervous'], re: /pineal/i },

  // ---- cardiovascular ----
  'heart':           { label: 'Heart', sys: ['cardiovascular'], sub: 'heart', re: /./ },
  'heart-muscle':    { label: 'Heart muscle (myocardium)', sys: ['cardiovascular'], sub: 'heart', re: /myocard|ventricle|atrium|wall|septum|papillary|trabecul|apex of heart|heart$/i },
  'coronary-arteries': { label: 'Coronary arteries', sys: ['cardiovascular'], re: /coronary|interventricular (artery|branch)|circumflex branch|marginal (branch|artery)|diagonal branch|conus artery|sinuatrial nodal|atrioventricular nodal|posterior interventricular/i },
  'aorta':           { label: 'Aorta', sys: ['cardiovascular'], re: /aorta|aortic (arch|bulb|sinus|isthmus)|arch of aorta/i },
  'arteries':        { label: 'Arteries', sys: ['cardiovascular'], sub: 'arteries', re: /./ },
  'veins':           { label: 'Veins', sys: ['cardiovascular'], sub: 'veins', re: /./ },
  'carotid-arteries': { label: 'Carotid arteries', sys: ['cardiovascular'], re: /carotid/i },
  'cerebral-arteries': { label: 'Brain arteries', sys: ['cardiovascular'], re: /cerebral artery|basilar|vertebral artery|circle of willis|communicating artery|cerebellar artery|internal carotid|middle meningeal/i },
  'leg-veins':       { label: 'Leg veins', sys: ['cardiovascular'], re: /saphenous|femoral vein|popliteal vein|tibial vein|fibular vein|iliac vein|plantar venous|dorsal venous arch of foot/i },
  'blood-vessels':   { label: 'Blood vessels', sys: ['cardiovascular'], re: /./, ex: /heart$|ventricle|atrium|myocard|valve|papillary|chordae|auricle|septum/i },

  // ---- respiratory ----
  'lungs':           { label: 'Lungs', sys: ['respiratory'], re: /lung|lobe of|segment|pleura|alveol|bronchopulmonary/i, ex: /bronchus|bronchi/i },
  'airways':         { label: 'Airways (trachea, bronchi, larynx)', sys: ['respiratory'], re: /trachea|bronch|larynx|laryngeal|epiglott|vocal|nasal cavity|nose|glottis|cricoid|arytenoid|thyroid cartilage/i },
  'diaphragm':       { label: 'Diaphragm', sys: ['muscular'], re: /^diaphragm|part of diaphragm|crus of diaphragm|central tendon/i, ex: /pelvic|urogenital/i },

  // ---- digestive ----
  'mouth':           { label: 'Mouth', sys: ['digestive'], re: /mouth|oral|\blip\b|lips|palate|gingiva|gum|cheek|uvula|fauces/i },
  'teeth':           { label: 'Teeth', sys: ['digestive', 'skeletal'], re: /tooth|teeth|incisor|canine|molar|premolar|dentition|enamel|dentin/i },
  'tongue':          { label: 'Tongue', sys: ['digestive', 'muscular'], re: /tongue|lingual|genioglossus|hyoglossus|styloglossus/i },
  'salivary-glands': { label: 'Salivary glands', sys: ['digestive'], re: /parotid|submandibular gland|sublingual gland|salivary/i },
  'esophagus':       { label: 'Oesophagus', sys: ['digestive'], re: /oesophag|esophag/i },
  'stomach':         { label: 'Stomach', sys: ['digestive'], re: /stomach|gastric|pylor|cardia\b|fundus of stomach|body of stomach|greater curvature|lesser curvature/i },
  'small-intestine': { label: 'Small intestine', sys: ['digestive'], re: /duoden|jejun|ileum|ileal|small intestine/i },
  'large-intestine': { label: 'Large intestine (colon)', sys: ['digestive'], re: /colon|caecum|cecum|large intestine|appendix|sigmoid|flexure/i },
  'rectum':          { label: 'Rectum & anus', sys: ['digestive'], re: /rectum|rectal|anal canal|anus/i },
  'liver':           { label: 'Liver', sys: ['digestive'], re: /^liver|hepatic|lobe of liver|segment of liver|sector of .*liver|caudate lobe|quadrate lobe/i },
  'gallbladder':     { label: 'Gallbladder & bile ducts', sys: ['digestive'], re: /gallbladder|bile duct|cystic duct|hepatic duct/i },
  'pancreas':        { label: 'Pancreas', sys: ['digestive'], re: /pancrea/i },

  // ---- urinary ----
  'kidneys':         { label: 'Kidneys', sys: ['urinary'], re: /kidney|renal/i },
  'bladder':         { label: 'Urinary bladder', sys: ['urinary'], re: /bladder/i },
  'ureters':         { label: 'Ureters', sys: ['urinary'], re: /ureter/i },
  'urethra':         { label: 'Urethra', sys: ['urinary'], re: /urethra/i },

  // ---- endocrine ----
  'thyroid':         { label: 'Thyroid gland', sys: ['endocrine'], re: /thyroid|parathyroid/i },
  'adrenal-glands':  { label: 'Adrenal glands', sys: ['endocrine'], re: /suprarenal|adrenal/i },

  // ---- reproductive ----
  'testes':          { label: 'Testes', sys: ['reproductive'], re: /testis|testes|epididym/i },
  'prostate':        { label: 'Prostate', sys: ['reproductive'], re: /prostate|seminal gland|seminal vesicle|ejaculatory/i },
  'penis':           { label: 'Penis', sys: ['reproductive'], re: /penis|corpus cavern|corpus spong|glans/i },
  'uterus':          { label: 'Uterus', sys: ['reproductive'], re: /uterus|uterine|cervix|fallopian|endometri|myometri/i },
  'ovaries':         { label: 'Ovaries', sys: ['reproductive'], re: /ovar/i },
  'vagina':          { label: 'Vagina', sys: ['reproductive'], re: /vagina|vulva|labi|clitor/i },
  'breasts':         { label: 'Breasts', sys: ['reproductive', 'integumentary'], re: /mammary|breast|nipple|areola|lactiferous/i },

  // ---- muscles ----
  'skeletal-muscle': { label: 'Skeletal muscle (all)', sys: ['muscular'], re: /./, ex: /tendon|fascia|fasciae|bursa|sheath|aponeurosis|retinacul/i },
  'biceps':          { label: 'Biceps', sys: ['muscular'], re: /biceps brachii|head of biceps brachii|brachialis/i },
  'triceps':         { label: 'Triceps', sys: ['muscular'], re: /triceps brachii|head of triceps|anconeus/i },
  'forearm-muscles': { label: 'Forearm muscles', sys: ['muscular'], re: /flexor (carpi|digitorum|pollicis|digiti)|extensor (carpi|digitorum|pollicis|digiti|indicis)|brachioradialis|pronator|supinator|palmaris longus|abductor pollicis longus/i, ex: /foot|hallucis|toe/i },
  'deltoids':        { label: 'Deltoids', sys: ['muscular'], re: /deltoid/i },
  'pectorals':       { label: 'Chest (pectorals)', sys: ['muscular'], re: /pectoralis/i },
  'lats':            { label: 'Lats', sys: ['muscular'], re: /latissimus dorsi|teres major/i },
  'trapezius':       { label: 'Trapezius', sys: ['muscular'], re: /trapezius|levator scapulae|rhomboid/i },
  'abs':             { label: 'Abdominals (core)', sys: ['muscular'], re: /rectus abdominis|external oblique|internal oblique|transversus abdominis|pyramidalis|quadratus lumborum/i },
  'erector-spinae':  { label: 'Spinal erectors', sys: ['muscular'], re: /iliocostalis|longissimus|spinalis|erector spinae|multifidus|semispinalis|rotatores|splenius/i },
  'glutes':          { label: 'Glutes', sys: ['muscular'], re: /gluteus|gluteal|tensor fasciae latae|piriformis/i },
  'quadriceps':      { label: 'Quadriceps', sys: ['muscular'], re: /rectus femoris|vastus|quadriceps|sartorius/i },
  'hamstrings':      { label: 'Hamstrings', sys: ['muscular'], re: /biceps femoris|semitendinosus|semimembranosus|hamstring/i },
  'calves':          { label: 'Calves', sys: ['muscular'], re: /gastrocnemius|soleus|plantaris|triceps surae|tibialis posterior/i },
  'hip-flexors':     { label: 'Hip flexors', sys: ['muscular'], re: /iliopsoas|psoas major|psoas minor|iliacus|pectineus/i },
  'rotator-cuff':    { label: 'Rotator cuff', sys: ['muscular'], re: /supraspinatus|infraspinatus|teres minor|subscapularis/i },
  'pelvic-floor':    { label: 'Pelvic floor', sys: ['muscular'], re: /levator ani|coccygeus|pubococcygeus|iliococcygeus|puborectalis|external anal sphincter|perineal|bulbospongiosus|ischiocavernosus|urogenital diaphragm|pelvic diaphragm/i },

  // ---- skeleton & joints ----
  'bones':           { label: 'Bones (all)', sys: ['skeletal'], re: /./, ex: /cartilage|ligament|disc|meniscus/i },
  'bone-marrow':     { label: 'Bone marrow (long bones, pelvis, sternum, vertebrae)', sys: ['skeletal'], re: /^femur|^tibia|^humerus|hip bone|^sternum|body of sternum|vertebra|^rib|ilium|^scapula|^clavicle/i, ex: /cartilage|process|facet|ligament|disc/i },
  'spine':           { label: 'Spine', sys: ['skeletal', 'joints'], re: /vertebra|sacrum|coccyx|intervertebral|atlas|axis \[|dens|vertebral column|spinal column|nucleus pulposus|anulus fibrosus|ligamentum flavum|longitudinal ligament/i },
  'skull':           { label: 'Skull', sys: ['skeletal'], re: /./, sub: 'cranium' },
  'ribs':            { label: 'Ribs', sys: ['skeletal'], re: /\brib\b|costal cartilage|ribs/i },
  'pelvis':          { label: 'Pelvis', sys: ['skeletal'], re: /hip bone|sacrum|coccyx|ilium|ischium|pubis|pubic|acetabul/i },
  'femur':           { label: 'Femur', sys: ['skeletal'], re: /^femur|of femur/i },
  'tibia':           { label: 'Tibia & fibula', sys: ['skeletal'], re: /^tibia|^fibula|of tibia|of fibula/i },
  'joints':          { label: 'Joints (all)', sys: ['joints'], re: /./ },
  'hip-joint':       { label: 'Hip joint', sys: ['joints'], re: /hip joint|acetabular|iliofemoral|pubofemoral|ischiofemoral|ligament of head of femur|zona orbicularis|transverse acetabular/i },
  'knee-joint':      { label: 'Knee joint', sys: ['joints'], re: /knee|patellar|cruciate|meniscus|tibial collateral|fibular collateral|popliteal ligament|infrapatellar|suprapatellar/i },
  'shoulder-joint':  { label: 'Shoulder joint', sys: ['joints'], re: /glenohumeral|shoulder|coracohumeral|glenoid|acromioclavicular|coracoacromial|coracoclavicular/i },
  'elbow-joint':     { label: 'Elbow joint', sys: ['joints'], re: /elbow|annular ligament of radius|ulnar collateral ligament|radial collateral ligament|humeroulnar|humeroradial|radioulnar/i },
  'wrist':           { label: 'Wrist', sys: ['joints'], re: /wrist|radiocarpal|carpal|intercarpal|carpometacarpal|flexor retinaculum|extensor retinaculum/i, ex: /foot|tarsal/i },
  'ankle':           { label: 'Ankle', sys: ['joints'], re: /ankle|talocrural|deltoid ligament|talofibular|calcaneofibular|tibiofibular|subtalar|talocalcane/i },
  'cartilage':       { label: 'Cartilage', sys: ['skeletal', 'joints'], re: /cartilage|meniscus|labrum|disc/i },
  'ligaments':       { label: 'Ligaments', sys: ['joints'], re: /ligament|membrane|capsule|retinacul/i },
  'tendons':         { label: 'Tendons', sys: ['muscular'], re: /tendon|aponeurosis/i },

  // ---- immune ----
  'immune-system':   { label: 'Immune system (lymphoid)', sys: ['lymphoid'], re: /./ },
  'lymph-nodes':     { label: 'Lymph nodes', sys: ['lymphoid'], re: /node|lymph/i, ex: /spleen|thymus|tonsil/i },
  'spleen':          { label: 'Spleen', sys: ['lymphoid'], re: /spleen|splenic/i },
  'thymus':          { label: 'Thymus', sys: ['lymphoid'], re: /thymus/i },
  'tonsils':         { label: 'Tonsils', sys: ['lymphoid'], re: /tonsil|adenoid/i },
};

export const TIMELINE_STEPS = [
  { t: '1d',  label: '1 day',    hi: '1 दिन' },
  { t: '1w',  label: '1 week',   hi: '1 हफ़्ता' },
  { t: '30d', label: '30 days',  hi: '30 दिन' },
  { t: '60d', label: '60 days',  hi: '60 दिन' },
  { t: '6m',  label: '6 months', hi: '6 महीने' },
  { t: '1y',  label: '1 year',   hi: '1 साल' },
  { t: '5y',  label: '5 years',  hi: '5 साल' },
];

export const EFFECT_KINDS = {
  positive: { label: 'Benefit', color: '#22c55e' },
  negative: { label: 'Harm',    color: '#ef4444' },
  strain:   { label: 'Strain',  color: '#f59e0b' },
  neutral:  { label: 'Change',  color: '#38bdf8' },
};
