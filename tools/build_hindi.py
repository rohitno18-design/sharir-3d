"""
Compose Hindi names for anatomical structures.

Most of the ~2,550 structure names are built from a small vocabulary
("posterior inferior cerebellar artery", "branches of X of Y"), so composing them
from a term dictionary gives far more CONSISTENCY than translating each one
separately — the same English word always yields the same Hindi word.

Hand-written entries in src/data/hindi.json always win; this only fills the gaps.
A name is emitted only when EVERY token is known, so we never ship a half-Hindi
mongrel — unknown names simply fall back to English in the UI.

Usage: python tools/build_hindi.py [--report]
Writes: src/data/hindi.json (merged) and public/data/hindi.json (shipped copy)
"""
import json, os, re, sys, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'src', 'data', 'hindi.json')
OUT_PUB = os.path.join(ROOT, 'public', 'data', 'hindi.json')
REGISTRY = os.path.join(ROOT, 'public', 'data', 'registry.json')
REPORT = '--report' in sys.argv

M, F = 'm', 'f'

# ---------------------------------------------------------------- head nouns (word, gender)
HEAD = {
    'artery': ('धमनी', F), 'arteries': ('धमनियाँ', F), 'aorta': ('महाधमनी', F),
    'vein': ('शिरा', F), 'veins': ('शिराएँ', F), 'venae': ('शिराएँ', F),
    'nerve': ('तंत्रिका', F), 'nerves': ('तंत्रिकाएँ', F),
    'muscle': ('पेशी', F), 'muscles': ('पेशियाँ', F),
    'bone': ('अस्थि', F), 'bones': ('अस्थियाँ', F),
    'node': ('ग्रंथि', F), 'nodes': ('ग्रंथियाँ', F),
    'branch': ('शाखा', F), 'branches': ('शाखाएँ', F),
    'gland': ('ग्रंथि', F), 'glands': ('ग्रंथियाँ', F),
    'region': ('क्षेत्र', M), 'regions': ('क्षेत्र', M),
    'part': ('भाग', M), 'parts': ('भाग', M),
    'head': ('शीर्ष', M), 'body': ('काय', M), 'neck': ('ग्रीवा', F), 'tail': ('पुच्छ', F),
    'lobe': ('खंड', M), 'lobes': ('खंड', M), 'lobule': ('लघुखंड', M), 'lobules': ('लघुखंड', M),
    'segment': ('खंड', M), 'segments': ('खंड', M),
    'surface': ('सतह', F), 'surfaces': ('सतहें', F),
    'border': ('किनारा', M), 'borders': ('किनारे', M), 'margin': ('किनारा', M),
    'process': ('प्रवर्ध', M), 'processes': ('प्रवर्ध', M),
    'tubercle': ('ट्यूबरकल', M), 'tuberosity': ('उभार', M), 'trochanter': ('ट्रोकैंटर', M),
    'crest': ('शिखा', F), 'spine': ('कंटक', M), 'ridge': ('शिखा', F),
    'fossa': ('गर्त', M), 'foramen': ('छिद्र', M), 'foramina': ('छिद्र', M),
    'canal': ('नलिका', F), 'canals': ('नलिकाएँ', F), 'duct': ('वाहिनी', F), 'ducts': ('वाहिनियाँ', F),
    'ligament': ('स्नायु', M), 'ligaments': ('स्नायु', M),
    'tendon': ('कंडरा', F), 'tendons': ('कंडराएँ', F), 'aponeurosis': ('कंडराकला', F),
    'sheath': ('आवरण', M), 'sheaths': ('आवरण', M), 'retinaculum': ('रेटिनैकुलम', M),
    'bursa': ('बर्सा', F), 'bursae': ('बर्सा', F),
    'fascia': ('प्रावरणी', F), 'fasciae': ('प्रावरणियाँ', F),
    'plexus': ('जाल', M), 'ganglion': ('गुच्छिका', F), 'ganglia': ('गुच्छिकाएँ', F),
    'sulcus': ('खाँच', F), 'sulci': ('खाँचें', F), 'groove': ('खाँच', F), 'notch': ('खाँच', F),
    'gyrus': ('गाइरस', M), 'gyri': ('गाइरस', M), 'cortex': ('वल्कुट', M),
    'nucleus': ('केंद्रक', M), 'nuclei': ('केंद्रक', M),
    'ventricle': ('निलय', M), 'ventricles': ('निलय', M), 'atrium': ('अलिंद', M),
    'valve': ('कपाट', M), 'valves': ('कपाट', M), 'cusp': ('पर्ण', M),
    'sinus': ('कोटर', M), 'sinuses': ('कोटर', M),
    'cavity': ('गुहा', F), 'space': ('स्थान', M), 'recess': ('अवकाश', M),
    'membrane': ('झिल्ली', F), 'membranes': ('झिल्लियाँ', F),
    'cartilage': ('उपास्थि', F), 'cartilages': ('उपास्थियाँ', F),
    'joint': ('संधि', F), 'joints': ('संधियाँ', F), 'capsule': ('संपुट', M),
    'disc': ('चक्रिका', F), 'meniscus': ('अर्धचंद्रक', M), 'labrum': ('लैब्रम', M),
    'bronchus': ('श्वसनी', F), 'bronchi': ('श्वसनियाँ', F), 'lung': ('फेफड़ा', M), 'lungs': ('फेफड़े', M),
    'trachea': ('श्वासनली', F), 'larynx': ('स्वरयंत्र', M), 'pleura': ('फुफ्फुसावरण', M),
    'trunk': ('स्तंभ', M), 'trunks': ('स्तंभ', M), 'root': ('मूल', M), 'roots': ('मूल', M),
    'ramus': ('शाखा', F), 'rami': ('शाखाएँ', F),
    'arch': ('चाप', M), 'arches': ('चाप', M), 'ring': ('वलय', M),
    'wall': ('भित्ति', F), 'walls': ('भित्तियाँ', F),
    'cell': ('कोशिका', F), 'cells': ('कोशिकाएँ', F),
    'fold': ('वलन', M), 'folds': ('वलन', M), 'papilla': ('अंकुर', M),
    'tract': ('पथ', M), 'tracts': ('पथ', M), 'fasciculus': ('बंडल', M),
    'lamina': ('पटल', M), 'horn': ('शृंग', M), 'column': ('स्तंभ', M),
    'pole': ('ध्रुव', M), 'apex': ('शीर्ष', M), 'base': ('आधार', M),
    'shaft': ('दंड', M), 'angle': ('कोण', M), 'line': ('रेखा', F),
    'septum': ('पट', M), 'orifice': ('छिद्र', M), 'ostium': ('मुख', M), 'opening': ('छिद्र', M),
    'fundus': ('तल', M), 'isthmus': ('संयोजिका', F), 'ampulla': ('तुंबिका', F),
    'bulb': ('कंद', M), 'crus': ('स्तंभ', M), 'crura': ('स्तंभ', M),
    'follicle': ('पुटक', M), 'alveolus': ('कूपिका', F), 'alveoli': ('कूपिकाएँ', F),
    'cortexes': ('वल्कुट', M), 'medulla': ('मज्जा', F), 'pyramid': ('पिरामिड', M),
    'hilum': ('नाभि', F), 'pedicle': ('वृंत', M), 'peduncle': ('वृंत', M),
    'chamber': ('कक्ष', M), 'lumen': ('अवकाशिका', F), 'mucosa': ('श्लेष्मा', F),
    'skin': ('त्वचा', F), 'fat': ('वसा', F), 'adipose': ('वसा', F),
    'triangle': ('त्रिकोण', M), 'compartment': ('कोष्ठ', M), 'canaliculus': ('नन्ही नलिका', F),
    'vertebra': ('कशेरुका', F), 'vertebrae': ('कशेरुकाएँ', F),
    'rib': ('पसली', F), 'ribs': ('पसलियाँ', F),
    'tooth': ('दाँत', M), 'teeth': ('दाँत', M),
    'sphincter': ('संकोचिनी', F), 'valvule': ('कपाटिका', F),
    'ossicle': ('अस्थिका', F), 'ossicles': ('अस्थिकाएँ', F),
    'cord': ('रज्जु', F), 'cords': ('रज्जुएँ', F), 'fibres': ('तंतु', M), 'fibers': ('तंतु', M),
    'layer': ('परत', F), 'layers': ('परतें', F), 'sheet': ('चादर', F),
    'septa': ('पट', M), 'band': ('पट्टी', F), 'raphe': ('सीवन', F),
    'venule': ('शिरिका', F), 'arteriole': ('धमनिका', F), 'capillary': ('केशिका', F),
    'vessel': ('वाहिका', F), 'vessels': ('वाहिकाएँ', F),
    # body parts / regions used as head nouns
    'foot': ('पैर', M), 'feet': ('पैर', M), 'hand': ('हाथ', M), 'hands': ('हाथ', M),
    'limb': ('अंग', M), 'limbs': ('अंग', M), 'arm': ('बाँह', F), 'forearm': ('अग्रबाहु', F),
    'leg': ('टाँग', F), 'thigh': ('जांघ', F), 'shoulder': ('कंधा', M), 'elbow': ('कोहनी', F),
    'wrist': ('कलाई', F), 'knee': ('घुटना', M), 'ankle': ('टखना', M), 'hip': ('कूल्हा', M),
    'thorax': ('वक्ष', M), 'abdomen': ('उदर', M), 'pelvis': ('श्रोणि', F), 'perineum': ('मूलाधार', M),
    'back': ('पीठ', F), 'chest': ('छाती', F), 'trunk_region': ('धड़', M),
    'digit': ('अंगुली', F), 'digits': ('अंगुलियाँ', F), 'finger': ('उँगली', F), 'fingers': ('उँगलियाँ', F),
    'toe': ('पैर की उँगली', F), 'toes': ('पैर की उँगलियाँ', F), 'thumb': ('अँगूठा', M),
    'skull': ('कपाल', M), 'cranium': ('कपाल', M), 'face': ('चेहरा', M), 'jaw': ('जबड़ा', M),
    'eyeball': ('नेत्रगोलक', M), 'eye': ('आँख', F), 'ear': ('कान', M), 'nose': ('नाक', F),
    'tongue': ('जीभ', F), 'throat': ('गला', M), 'palate': ('तालु', M), 'lip': ('होंठ', M), 'lips': ('होंठ', M),
    'brain': ('मस्तिष्क', M), 'heart': ('हृदय', M), 'liver': ('यकृत', M), 'kidney': ('वृक्क', M),
    'stomach': ('आमाशय', M), 'intestine': ('आँत', F), 'spleen': ('प्लीहा', F), 'pancreas': ('अग्न्याशय', M),
    'bladder': ('मूत्राशय', M), 'uterus': ('गर्भाशय', M), 'ovary': ('अंडाशय', M), 'testis': ('वृषण', M),
    'penis': ('शिश्न', M), 'prostate': ('प्रोस्टेट', M), 'breast': ('स्तन', M), 'nipple': ('चूचुक', M),
    'thymus': ('थाइमस', M), 'tonsil': ('टॉन्सिल', M), 'diaphragm': ('मध्यपट', M),
    'system': ('तंत्र', M), 'division': ('विभाग', M), 'matter': ('द्रव्य', M),
    'commissure': ('संयोजिका', F), 'leaflet': ('पर्णक', M), 'lymph': ('लसीका', F),
    'girdle': ('मेखला', F), 'vault': ('छत', F), 'floor': ('तल', M), 'roof': ('छत', F),
    'sac': ('कोश', M), 'pouch': ('थैली', F), 'canaliculi': ('नन्ही नलिकाएँ', F),
    'midbrain': ('मध्यमस्तिष्क', M), 'hindbrain': ('पश्चमस्तिष्क', M), 'forebrain': ('अग्रमस्तिष्क', M),
    'cerebellum': ('अनुमस्तिष्क', M), 'vermis': ('वर्मिस', M), 'pons': ('सेतु', M),
    'thalamus': ('चेतक', M), 'hypothalamus': ('अधश्चेतक', M), 'corpus': ('पिंड', M),
    'tube': ('नली', F), 'tubes': ('नलियाँ', F), 'colon': ('बृहदान्त्र', F), 'rectum': ('मलाशय', M),
    'caecum': ('अंधनाल', F), 'cecum': ('अंधनाल', F), 'appendix': ('अपेंडिक्स', M),
    'duodenum': ('ग्रहणी', F), 'jejunum': ('मध्यांत्र', F), 'ileum': ('शेषांत्र', F),
    'oesophagus': ('ग्रासनली', F), 'esophagus': ('ग्रासनली', F), 'pharynx': ('ग्रसनी', F),
    'malleolus': ('मैलिओलस', M), 'condyle': ('कंडाइल', M), 'epicondyle': ('एपिकंडाइल', M),
    'auricle': ('कर्णपाली', F), 'hairs': ('बाल', M), 'hair': ('बाल', M), 'nail': ('नाखून', M),
    'genitalia': ('जननांग', M), 'structures': ('संरचनाएँ', F), 'structure': ('संरचना', F),
    'organ': ('अंग', M), 'organs': ('अंग', M), 'gland_pl': ('ग्रंथियाँ', F),
    'ureter': ('मूत्रवाहिनी', F), 'urethra': ('मूत्रमार्ग', M), 'nephron': ('नेफ़्रॉन', M),
    'cerebrum': ('प्रमस्तिष्क', M), 'hemisphere': ('गोलार्ध', M), 'hemispheres': ('गोलार्ध', M),
    'meninges': ('मस्तिष्कावरण', M), 'dura': ('दृढ़तानिका', F), 'pia': ('मृदुतानिका', F),
    'retina': ('दृष्टिपटल', M), 'cornea': ('स्वच्छपटल', M), 'iris': ('परितारिका', F),
    'lens': ('लेंस', M), 'pupil': ('पुतली', F), 'sclera': ('श्वेतपटल', M),
    'cochlea': ('कर्णावर्त', M), 'labyrinth': ('भूलभुलैया', F), 'eardrum': ('कर्णपटह', M),
    # named bones and organs used as the possessor in "X of Y"
    'femur': ('फ़ीमर', M), 'tibia': ('टिबिया', F), 'fibula': ('फ़िबुला', F),
    'humerus': ('ह्यूमरस', M), 'radius': ('रेडियस', M), 'ulna': ('अल्ना', F),
    'scapula': ('स्कैपुला', F), 'clavicle': ('हंसली', F), 'sternum': ('उरोस्थि', F),
    'mandible': ('अधोहनु', F), 'maxilla': ('ऊर्ध्वहनु', F), 'patella': ('घुटने की चक्रिका', F),
    'sacrum': ('त्रिकास्थि', F), 'coccyx': ('अनुत्रिकास्थि', F),
    'ilium': ('इलियम', M), 'ischium': ('इस्कियम', M), 'pubis': ('जघनास्थि', F),
    'atlas': ('एटलस', M), 'axis': ('एक्सिस', M), 'hyoid': ('कंठास्थि', F),
    'malleus': ('मैलियस', M), 'incus': ('इंकस', M), 'stapes': ('स्टेपीज़', M),
    'frontal_bone': ('फ्रंटल अस्थि', F), 'vomer': ('वोमर', M), 'concha': ('शंख', M),
    'gallbladder': ('पित्ताशय', M), 'ileum_o': ('शेषांत्र', F),
    'epiglottis': ('स्वरयंत्रच्छद', M), 'uvula': ('कौआ', M),
    'aorta_o': ('महाधमनी', F), 'myocardium': ('हृद्पेशी', F),
    'cerebellum_o': ('अनुमस्तिष्क', M), 'hypophysis': ('पीयूष ग्रंथि', F),
    'facet': ('संधि-तल', M), 'facets': ('संधि-तल', M), 'wing': ('पंख', M), 'wings': ('पंख', M),
    'impression': ('छाप', F), 'impressions': ('छापें', F), 'phalanx': ('अंगुल्यस्थि', F),
    'phalanges': ('अंगुल्यस्थियाँ', F), 'fissure': ('दरार', F), 'fissures': ('दरारें', F),
    'eminence': ('उभार', M), 'plate': ('पट्टिका', F), 'trochlea': ('ट्रॉक्लिया', F),
    'dens': ('दंत-प्रवर्ध', M), 'pars': ('भाग', M), 'aperture': ('द्वार', M),
    'meatus': ('मार्ग', M), 'antrum': ('कोटर', M), 'cornu': ('शृंग', M),
    'tubercule': ('ट्यूबरकल', M), 'protuberance': ('उभार', M), 'spur': ('कंटक', M),
    'confluence': ('संगम', M), 'junction': ('संधि-स्थल', M), 'bifurcation': ('द्विशाखन', M),
}

# ---------------------------------------------------------------- modifiers (adjectives)
MOD = {
    'anterior': 'अग्र', 'posterior': 'पश्च', 'superior': 'ऊर्ध्व', 'inferior': 'अधो',
    'medial': 'मध्यवर्ती', 'lateral': 'पार्श्व', 'median': 'माध्य', 'middle': 'मध्य',
    'superficial': 'सतही', 'deep': 'गहन', 'internal': 'आंतरिक', 'external': 'बाह्य',
    'inner': 'भीतरी', 'outer': 'बाहरी', 'central': 'केंद्रीय', 'peripheral': 'परिधीय',
    'dorsal': 'पृष्ठीय', 'ventral': 'अधर', 'palmar': 'हथेली-तरफ़ी', 'plantar': 'तलवा-तरफ़ी',
    'proximal': 'समीपस्थ', 'distal': 'दूरस्थ', 'cranial': 'कपालीय', 'caudal': 'पुच्छीय',
    'accessory': 'सहायक', 'common': 'सामान्य', 'proper': 'निजी', 'terminal': 'अंतस्थ',
    'primary': 'प्राथमिक', 'secondary': 'द्वितीयक', 'segmental': 'खंडीय',
    'transverse': 'अनुप्रस्थ', 'longitudinal': 'अनुदैर्ध्य', 'oblique': 'तिर्यक',
    'circumflex': 'परिवृत्त', 'recurrent': 'प्रत्यावर्ती', 'descending': 'अवरोही', 'ascending': 'आरोही',
    'great': 'वृहत्', 'greater': 'वृहत्', 'small': 'लघु', 'smaller': 'लघु', 'lesser': 'लघु',
    'large': 'बड़ी', 'long': 'दीर्घ', 'short': 'लघु', 'broad': 'चौड़ा', 'round': 'गोल',
    'major': 'वृहत्', 'minor': 'लघु', 'maximus': 'मैक्सिमस', 'medius': 'मीडियस', 'minimus': 'मिनिमस',
    'longus': 'लॉन्गस', 'brevis': 'ब्रेविस', 'magnus': 'मैग्नस',
    'first': 'पहली', 'second': 'दूसरी', 'third': 'तीसरी', 'fourth': 'चौथी', 'fifth': 'पाँचवीं',
    'sixth': 'छठी', 'seventh': 'सातवीं', 'eighth': 'आठवीं', 'ninth': 'नौवीं', 'tenth': 'दसवीं',
    'eleventh': 'ग्यारहवीं', 'twelfth': 'बारहवीं',
    'upper': 'ऊपरी', 'lower': 'निचला', 'free': 'स्वतंत्र', 'true': 'सच्ची', 'false': 'झूठी',
    'apical': 'शीर्षस्थ', 'basal': 'आधारीय', 'lingular': 'लिंगुलर',
    'thoracic': 'वक्षीय', 'abdominal': 'उदरीय', 'pelvic': 'श्रोणीय', 'cervical': 'ग्रीवीय',
    'lumbar': 'कटि', 'sacral': 'त्रिक', 'coccygeal': 'अनुत्रिक',
    'visceral': 'आंतरांगीय', 'parietal': 'भित्तीय', 'muscular': 'पेशीय', 'cutaneous': 'त्वचीय',
    'articular': 'संधीय', 'synovial': 'श्लेष्मीय', 'fibrous': 'तंतुमय', 'elastic': 'प्रत्यास्थ',
    'nasal': 'नासिका', 'oral': 'मुख', 'ocular': 'नेत्र', 'auricular': 'कर्ण',
    'sensory': 'संवेदी', 'motor': 'प्रेरक', 'sympathetic': 'अनुकंपी', 'parasympathetic': 'परानुकंपी',
    'left': None, 'right': None,      # handled specially (gender agreement)
}

# Proper-noun adjectives / roots — transliterated, as Hindi-medium textbooks do.
TRANS = {
    'brachial': 'ब्रेकियल', 'brachii': 'ब्रेकाई', 'radial': 'रेडियल', 'ulnar': 'अल्नार',
    'tibial': 'टिबियल', 'fibular': 'फ़िबुलर', 'peroneal': 'पेरोनियल', 'popliteal': 'पॉप्लिटियल',
    'femoral': 'फ़ीमोरल', 'femoris': 'फ़ीमोरिस', 'axillary': 'एक्सिलरी', 'subclavian': 'सबक्लेवियन',
    'carotid': 'कैरोटिड', 'vertebral': 'वर्टिब्रल', 'basilar': 'बेसिलर', 'cerebral': 'सेरिब्रल',
    'cerebellar': 'सेरिबेलर', 'hepatic': 'हिपैटिक', 'renal': 'रीनल', 'splenic': 'स्प्लेनिक',
    'gastric': 'गैस्ट्रिक', 'mesenteric': 'मेसेंटेरिक', 'colic': 'कोलिक', 'iliac': 'इलियक',
    'obturator': 'ऑब्च्युरेटर', 'gluteal': 'ग्लूटियल', 'pudendal': 'प्यूडेंडल', 'perineal': 'पेरिनियल',
    'occipital': 'ऑक्सिपिटल', 'frontal': 'फ्रंटल', 'temporal': 'टेम्पोरल', 'sphenoid': 'स्फ़ीनॉइड',
    'ethmoid': 'एथमॉइड', 'ethmoidal': 'एथमॉइडल', 'maxillary': 'मैक्सिलरी', 'mandibular': 'मैंडिबुलर',
    'facial': 'फेशियल', 'ophthalmic': 'ऑप्थैल्मिक', 'lacrimal': 'लैक्रिमल', 'palatine': 'पैलेटाइन',
    'zygomatic': 'ज़ाइगोमैटिक', 'nasopalatine': 'नेज़ोपैलेटाइन', 'pterygoid': 'टेरिगॉइड',
    'digital': 'डिजिटल', 'metacarpal': 'मेटाकार्पल', 'metatarsal': 'मेटाटार्सल',
    'phalangeal': 'फैलेंजियल', 'carpal': 'कार्पल', 'tarsal': 'टार्सल',
    'intercostal': 'इंटरकोस्टल', 'costal': 'कोस्टल', 'sternal': 'स्टर्नल', 'clavicular': 'क्लैविकुलर',
    'scapular': 'स्कैपुलर', 'humeral': 'ह्यूमरल', 'acromial': 'एक्रोमियल', 'coracoid': 'कोरैकॉइड',
    'pulmonary': 'फुफ्फुसीय', 'coronary': 'कोरोनरी', 'aortic': 'महाधमनी', 'jugular': 'जुगुलर',
    'saphenous': 'सैफ़ीनस', 'azygos': 'एज़ाइगोस', 'portal': 'पोर्टल', 'cystic': 'सिस्टिक',
    'pancreatic': 'पैंक्रियाटिक', 'duodenal': 'ड्यूओडिनल', 'jejunal': 'जेजुनल', 'ileal': 'इलियल',
    'rectal': 'रेक्टल', 'anal': 'गुदा', 'vesical': 'वेसाइकल', 'ureteric': 'यूरेटरिक',
    'uterine': 'गर्भाशयी', 'ovarian': 'अंडाशयी', 'testicular': 'वृषणीय', 'prostatic': 'प्रोस्टेटिक',
    'thyroid': 'थायरॉइड', 'thymic': 'थाइमिक', 'adrenal': 'एड्रिनल', 'suprarenal': 'सुप्रारीनल',
    'flexor': 'फ्लेक्सर', 'extensor': 'एक्सटेंसर', 'abductor': 'ऐब्डक्टर', 'adductor': 'ऐडक्टर',
    'levator': 'लिवेटर', 'depressor': 'डिप्रेसर', 'pronator': 'प्रोनेटर', 'supinator': 'सुपिनेटर',
    'tensor': 'टेंसर', 'rotator': 'रोटेटर', 'constrictor': 'कंस्ट्रिक्टर', 'dilator': 'डाइलेटर',
    'biceps': 'बाइसेप्स', 'triceps': 'ट्राइसेप्स', 'quadriceps': 'क्वाड्रिसेप्स', 'deltoid': 'डेल्टॉइड',
    'trapezius': 'ट्रैपीज़ियस', 'rhomboid': 'रॉमबॉइड', 'serratus': 'सेरेटस', 'latissimus': 'लैटिसिमस',
    'pectoralis': 'पेक्टोरैलिस', 'gluteus': 'ग्लूटियस', 'sartorius': 'सारटोरियस',
    'gracilis': 'ग्रैसिलिस', 'soleus': 'सोलियस', 'gastrocnemius': 'गैस्ट्रोक्नीमियस',
    'plantaris': 'प्लांटैरिस', 'popliteus': 'पॉप्लिटियस', 'iliacus': 'इलियेकस', 'psoas': 'सोआस',
    'piriformis': 'पिरिफ़ॉर्मिस', 'pectineus': 'पेक्टिनियस', 'semitendinosus': 'सेमिटेंडिनोसस',
    'semimembranosus': 'सेमिमेम्ब्रेनोसस', 'brachialis': 'ब्रेकिएलिस', 'brachioradialis': 'ब्रेकियोरेडियलिस',
    'anconeus': 'एन्कोनियस', 'supraspinatus': 'सुप्रास्पाइनेटस', 'infraspinatus': 'इंफ्रास्पाइनेटस',
    'subscapularis': 'सबस्कैपुलैरिस', 'teres': 'टेरीज़', 'masseter': 'मैसेटर',
    'temporalis': 'टेम्पोरैलिस', 'buccinator': 'बक्सिनेटर', 'orbicularis': 'ऑर्बिकुलैरिस',
    'sternocleidomastoid': 'स्टर्नोक्लीडोमैस्टॉइड', 'scalene': 'स्केलीन', 'omohyoid': 'ओमोहायॉइड',
    'digastric': 'डाइगैस्ट्रिक', 'mylohyoid': 'माइलोहायॉइड', 'genioglossus': 'जीनियोग्लोसस',
    'hallucis': 'हैल्युसिस', 'pollicis': 'पॉलिसिस', 'digitorum': 'डिजिटोरम', 'digiti': 'डिजिटाई',
    'indicis': 'इंडिसिस', 'minimi': 'मिनिमाई', 'carpi': 'कार्पाई', 'ulnaris': 'अल्नैरिस',
    'radialis': 'रेडियैलिस', 'oris': 'ओरिस', 'oculi': 'ऑकुलाई', 'abdominis': 'ऐब्डोमिनिस',
    'rectus': 'रेक्टस', 'obliquus': 'ऑब्लीक्वस', 'transversus': 'ट्रांसवर्सस',
    'sacroiliac': 'सैक्रोइलियक', 'sacrospinous': 'सैक्रोस्पाइनस', 'sacrotuberous': 'सैक्रोट्यूबरस',
    'cruciate': 'क्रूसिएट', 'collateral': 'कोलैटरल', 'annular': 'ऐन्युलर', 'interosseous': 'इंटरऑसियस',
    'hyoid': 'हायॉइड', 'cricoid': 'क्राइकॉइड', 'arytenoid': 'एरिटिनॉइड', 'epiglottic': 'एपिग्लॉटिक',
    'tympanic': 'टिम्पैनिक', 'cochlear': 'कॉक्लियर', 'vestibular': 'वेस्टिबुलर',
    'optic': 'दृक्', 'olfactory': 'घ्राण', 'trigeminal': 'ट्राइजेमिनल', 'abducens': 'ऐब्ड्यूसेंस',
    'trochlear': 'ट्रॉक्लियर', 'oculomotor': 'ऑक्युलोमोटर', 'vagus': 'वेगस', 'phrenic': 'फ्रेनिक',
    'sciatic': 'सायटिक', 'median': 'मीडियन', 'musculocutaneous': 'मस्क्युलोक्यूटेनियस',
    'saphenus': 'सैफ़ीनस', 'sural': 'स्यूरल', 'genicular': 'जेनिकुलर', 'thalamic': 'थैलेमिक',
    'hypoglossal': 'हाइपोग्लॉसल', 'glossopharyngeal': 'ग्लॉसोफैरिंजियल', 'laryngeal': 'लैरिंजियल',
    'inguinal': 'वंक्षण', 'umbilical': 'नाभि', 'epigastric': 'अधिजठर', 'hypogastric': 'अधोजठर',
    'lingual': 'जिह्वा', 'sublingual': 'अधोजिह्वा', 'submandibular': 'अधोहनु', 'parotid': 'पैरोटिड',
    'pharyngeal': 'ग्रसनी', 'oesophageal': 'ग्रासनली', 'esophageal': 'ग्रासनली',
    'bronchial': 'श्वसनी', 'tracheal': 'श्वासनली', 'pleural': 'फुफ्फुसावरणी',
    'peritoneal': 'पेरिटोनियल', 'omental': 'ओमेंटल', 'mesocolic': 'मेसोकोलिक',
    'spinal': 'मेरु', 'meningeal': 'मस्तिष्कावरणी', 'dural': 'ड्यूरल', 'arachnoid': 'एरैक्नॉइड',
    'hippocampal': 'हिप्पोकैम्पल', 'amygdaloid': 'एमिग्डलॉइड', 'striate': 'स्ट्राइएट',
    'calcarine': 'कैल्कराइन', 'cingulate': 'सिंग्युलेट', 'insular': 'इंसुलर', 'olivary': 'ऑलिवरी',
    'pontine': 'पॉन्टाइन', 'tectal': 'टेक्टल', 'tegmental': 'टेग्मेंटल',
    # second pass — driven by the --report list of unknown tokens
    'subtendinous': 'कंडरा-अधःस्थ', 'subcutaneous': 'त्वचा-अधःस्थ', 'submucosal': 'श्लेष्मा-अधःस्थ',
    'intermuscular': 'अंतरापेशीय', 'intermediate': 'मध्यवर्ती', 'interosseus': 'इंटरऑसियस',
    'orbital': 'नेत्रकोटरीय', 'lobar': 'खंडीय', 'septal': 'पटीय', 'venous': 'शिरीय',
    'arterial': 'धमनीय', 'lymphatic': 'लसीकीय', 'nervous': 'तंत्रिकीय', 'skeletal': 'कंकालीय',
    'digestive': 'पाचन', 'respiratory': 'श्वसन', 'urinary': 'मूत्र', 'genital': 'जनन',
    'endocrine': 'अंतःस्रावी', 'reproductive': 'प्रजनन', 'integumentary': 'त्वचीय',
    'cardiovascular': 'हृद्वाहिकीय', 'circulatory': 'परिसंचरण',
    'antebrachial': 'अग्रबाहवीय', 'brachiocephalic': 'ब्रेकियोसेफ़ैलिक',
    'calcaneal': 'कैल्केनियल', 'calcaneus': 'कैल्केनियस', 'talus': 'टैलस', 'navicular': 'नैविकुलर',
    'cuboid': 'क्यूबॉइड', 'cuneiform': 'क्यूनीफ़ॉर्म', 'scaphoid': 'स्कैफ़ॉइड', 'lunate': 'ल्यूनेट',
    'triquetral': 'ट्राइक्वेट्रल', 'pisiform': 'पिसिफ़ॉर्म', 'trapezium': 'ट्रैपीज़ियम',
    'trapezoid': 'ट्रैपीज़ॉइड', 'capitate': 'कैपिटेट', 'hamate': 'हैमेट',
    'thoracolumbar': 'वक्ष-कटि', 'iliotibial': 'इलियोटिबियल', 'iliopsoas': 'इलियोसोआस',
    'pectoral': 'पेक्टोरल', 'deltopectoral': 'डेल्टोपेक्टोरल', 'sternocostal': 'स्टर्नोकोस्टल',
    'quadratus': 'क्वाड्रेटस', 'tibialis': 'टिबियैलिस', 'fibularis': 'फ़िबुलैरिस',
    'peroneus': 'पेरोनियस', 'lumbricals': 'लंब्रिकल', 'interossei': 'इंटरॉसियाई',
    'sublimis': 'सब्लिमिस', 'profundus': 'प्रोफ़ंडस', 'superficialis': 'सुपरफ़िशियैलिस',
    # Latin genitives that trail a muscle name
    'capitis': 'कैपिटिस', 'colli': 'कोलाई', 'cervicis': 'सर्विसिस', 'thoracis': 'थोरैसिस',
    'lumborum': 'लंबोरम', 'dorsi': 'डॉर्साई', 'anguli': 'ऐंगुलाई', 'scapulae': 'स्कैपुली',
    'labii': 'लैबिआई', 'nasi': 'नेज़ाई', 'alaeque': 'एलिक्वी', 'superioris': 'सुपीरियोरिस',
    'inferioris': 'इंफ़ीरियोरिस', 'longissimus': 'लॉन्गिसिमस', 'iliocostalis': 'इलियोकोस्टैलिस',
    'spinalis': 'स्पाइनैलिस', 'multifidus': 'मल्टीफ़िडस', 'semispinalis': 'सेमिस्पाइनैलिस',
    'splenius': 'स्प्लीनियस', 'rotatores': 'रोटेटोरीज़', 'levatores': 'लिवेटोरीज़',
    'costarum': 'कोस्टारम', 'externus': 'एक्सटर्नस', 'internus': 'इंटर्नस',
    'anterius': 'एंटेरियस', 'posterius': 'पोस्टेरियस', 'lateralis': 'लैटरैलिस',
    'medialis': 'मीडियैलिस', 'intermedius': 'इंटरमीडियस', 'obliquus': 'ऑब्लीक्वस',
    'vastus': 'वैस्टस', 'femoris': 'फ़ीमोरिस', 'cruris': 'क्रूरिस', 'pedis': 'पेडिस',
    'manus': 'मैनस', 'oris': 'ओरिस', 'uvulae': 'उवुली', 'veli': 'वेलाई', 'palatini': 'पैलेटाइनाई',
    'tympani': 'टिम्पैनाई', 'stapedius': 'स्टेपीडियस', 'auris': 'ऑरिस',
    # third pass
    'alveolar': 'वायुकोष्ठीय', 'semilunar': 'अर्धचंद्राकार', 'supraclavicular': 'सुप्राक्लैविकुलर',
    'infraclavicular': 'इंफ्राक्लैविकुलर', 'iliolumbar': 'इलियोलंबर', 'labial': 'ओष्ठीय',
    'atrioventricular': 'अलिंद-निलय', 'sinuatrial': 'साइनोअलिंद', 'sigmoid': 'सिग्मॉइड',
    'interspinales': 'इंटरस्पाइनैलीज़', 'intertransversarii': 'इंटरट्रांसवर्सैराई',
    'trochanteric': 'ट्रोकैंटरिक', 'angular': 'कोणीय', 'proprius': 'प्रोप्रियस',
    'autonomic': 'स्वायत्त', 'telencephalon': 'टेलेंसिफ़ेलॉन', 'diencephalon': 'डाइएंसिफ़ेलॉन',
    'mesencephalon': 'मेसेंसिफ़ेलॉन', 'metencephalon': 'मेटेंसिफ़ेलॉन', 'tegmentum': 'टेग्मेंटम',
    'subscapular': 'सबस्कैपुलर', 'precentral': 'प्रीसेंट्रल', 'postcentral': 'पोस्टसेंट्रल',
    'pancreaticoduodenal': 'पैंक्रियाटिकोड्यूओडिनल', 'ileocolic': 'इलियोकोलिक',
    'gastroduodenal': 'गैस्ट्रोड्यूओडिनल', 'gastroepiploic': 'गैस्ट्रोएपिप्लोइक',
    'intrarenal': 'अंतर्वृक्कीय', 'cubital': 'क्यूबिटल', 'submental': 'सबमेंटल',
    'papillary': 'पैपिलरी', 'infrapatellar': 'इंफ्रापटेलर', 'suprapatellar': 'सुप्रापटेलर',
    'patellar': 'पटेलर', 'prepatellar': 'प्रीपटेलर', 'olecranon': 'ओलेक्रेनॉन',
    'female': 'स्त्री', 'male': 'पुरुष', 'grey': 'धूसर', 'gray': 'धूसर', 'white': 'श्वेत',
    'anular': 'ऐन्युलर', 'crural': 'क्रूरल', 'axial': 'अक्षीय', 'appendicular': 'उपांगीय',
    'mammary': 'स्तन', 'areolar': 'एरिओलर', 'inframammary': 'अधोस्तन',
    'pubic': 'जघन', 'ischial': 'इस्कियल', 'ischiopubic': 'इस्कियोप्यूबिक', 'iliopectineal': 'इलियोपेक्टिनियल',
    'acetabular': 'एसिटैबुलर', 'condylar': 'कॉन्डाइलर', 'epicondylar': 'एपिकॉन्डाइलर',
    'malleolar': 'मैलिओलर', 'styloid': 'स्टाइलॉइड', 'mastoid': 'मैस्टॉइड',
    'squamous': 'शल्कीय', 'petrous': 'पेट्रस', 'basilar_part': 'बेसिलर',
    'nuchal': 'न्यूकल', 'sagittal': 'सैजिटल', 'coronal': 'कोरोनल', 'lambdoid': 'लैम्ब्डॉइड',
    'incisive': 'इंसिसिव', 'alveolus_adj': 'एल्विओलर', 'molar': 'चवर्णक', 'premolar': 'अग्रचवर्णक',
    'canine': 'रदनक', 'incisor': 'कृंतक', 'deciduous': 'दुग्ध', 'permanent': 'स्थायी',
    'hyaline': 'हायलिन', 'elastic_c': 'प्रत्यास्थ', 'fibrocartilage': 'तंतु-उपास्थि',
    'sympathetic_t': 'अनुकंपी', 'splanchnic': 'स्प्लैंक्निक', 'coeliac': 'सीलिएक', 'celiac': 'सीलिएक',
    'aortic_p': 'महाधमनीय', 'renal_p': 'रीनल', 'hypogastric_p': 'हाइपोगैस्ट्रिक',
    'pampiniform': 'पैम्पिनिफ़ॉर्म', 'spermatic': 'शुक्रवाहक', 'deferens': 'डिफ़रेंस',
    'epididymis': 'अधिवृषण', 'scrotum': 'वृषणकोश', 'glans': 'शिश्नमुंड',
    'labium': 'ओष्ठ', 'labia': 'ओष्ठ', 'clitoris': 'भगशेफ', 'vagina': 'योनि', 'vulva': 'भग',
    'vestibule': 'प्रघाण', 'hymen': 'योनिच्छद', 'mons': 'जघन-उभार',
    'placenta': 'अपरा', 'amnion': 'उल्ब', 'umbilicus': 'नाभि',
    # fourth pass — the remaining flat tail
    'diaphragmatic': 'मध्यपटीय', 'infrahyoid': 'अधोहायॉइड', 'suprahyoid': 'ऊर्ध्वहायॉइड',
    'thyrohyoid': 'थायरोहायॉइड', 'sternohyoid': 'स्टर्नोहायॉइड', 'sternothyroid': 'स्टर्नोथायरॉइड',
    'cricothyroid': 'क्राइकोथायरॉइड', 'thyroarytenoid': 'थायरोएरिटिनॉइड',
    'scalenus': 'स्केलीनस', 'straight': 'सीधा', 'funiculus': 'फ़ुनिकुलस',
    'buccal': 'गाल', 'ciliary': 'पक्ष्माभी', 'insula': 'इंसुला', 'oblongata': 'ऑब्लोंगेटा',
    'genitofemoral': 'जेनिटोफ़ीमोरल', 'ilioinguinal': 'इलियोइंग्वाइनल',
    'iliohypogastric': 'इलियोहाइपोगैस्ट्रिक', 'occipitotemporal': 'ऑक्सिपिटोटेम्पोरल',
    'occipitofrontal': 'ऑक्सिपिटोफ्रंटल', 'frontoparietal': 'फ्रंटोपैराइटल',
    'temporoparietal': 'टेम्पोरोपैराइटल', 'parietooccipital': 'पैराइटो-ऑक्सिपिटल',
    'mental': 'चिबुक', 'suprascapular': 'सुप्रास्कैपुलर', 'thoracodorsal': 'थोरैकोडॉर्सल',
    'thoracoacromial': 'थोरैकोएक्रोमियल', 'communicating': 'संचारी', 'suspensory': 'निलंबी',
    'retromandibular': 'रेट्रोमैंडिबुलर', 'submandibular_n': 'सबमैंडिबुलर',
    'cardiac': 'हृदयी', 'vena': 'महाशिरा', 'cava': 'कावा', 'venae_cavae': 'महाशिराएँ',
    'supratrochlear': 'सुप्राट्रॉक्लियर', 'infratrochlear': 'इंफ्राट्रॉक्लियर',
    'supraorbital': 'सुप्राऑर्बिटल', 'infraorbital': 'इंफ्राऑर्बिटल',
    'supraspinous': 'सुप्रास्पाइनस', 'infraspinous': 'इंफ्रास्पाइनस',
    'longitudinalis': 'लॉन्गिट्यूडिनैलिस', 'verticalis': 'वर्टिकैलिस', 'transversalis': 'ट्रांसवर्सैलिस',
    'cremaster': 'क्रीमैस्टर', 'dartos': 'डार्टोस', 'bulbospongiosus': 'बल्बोस्पॉन्जियोसस',
    'ischiocavernosus': 'इस्कियोकैवर्नोसस', 'cavernosum': 'कैवर्नोसम', 'spongiosum': 'स्पॉन्जियोसम',
    'coccygeus': 'कॉक्सीजियस', 'puborectalis': 'प्यूबोरेक्टैलिस', 'pubococcygeus': 'प्यूबोकॉक्सीजियस',
    'iliococcygeus': 'इलियोकॉक्सीजियस', 'ani': 'एनाई', 'levator_ani': 'लिवेटर एनाई',
    'stylohyoid': 'स्टाइलोहायॉइड', 'styloglossus': 'स्टाइलोग्लोसस', 'hyoglossus': 'हायोग्लोसस',
    'palatoglossus': 'पैलेटोग्लोसस', 'palatopharyngeus': 'पैलेटोफैरिंजियस',
    'salpingopharyngeus': 'सैल्पिंगोफैरिंजियस', 'stylopharyngeus': 'स्टाइलोफैरिंजियस',
    'procerus': 'प्रोसेरस', 'corrugator': 'कोरुगेटर', 'risorius': 'राइसोरियस',
    'zygomaticus': 'ज़ाइगोमैटिकस', 'mentalis': 'मेंटैलिस', 'platysma': 'प्लैटिस्मा',
    'auricularis': 'ऑरिकुलैरिस', 'occipitalis': 'ऑक्सिपिटैलिस', 'frontalis': 'फ्रंटैलिस',
    'epicranial': 'एपिक्रेनियल', 'galea': 'गैलिया', 'aponeurotica': 'एपोन्यूरोटिका',
    'intercondylar': 'अंतःकंडाइलर', 'supracondylar': 'सुप्राकंडाइलर', 'infracondylar': 'इंफ्राकंडाइलर',
    'sphenoidal': 'स्फ़ीनॉइडल', 'bony': 'अस्थिल', 'cartilaginous': 'उपास्थिल',
    'greater_w': 'वृहत्', 'lesser_w': 'लघु', 'orbicular': 'वर्तुल',
}

LEFT = {M: 'बायाँ', F: 'बाईं'}
RIGHT = {M: 'दायाँ', F: 'दाईं'}
GEN = {M: 'का', F: 'की'}

# Hindi puts a masculine noun (and its agreeing adjectives) into the OBLIQUE case before a
# postposition: फेफड़ा → फेफड़े का, not फेफड़ा का. Feminine singulars are unchanged.
OBLIQUE_IRREGULAR = {'बायाँ': 'बाएँ', 'दायाँ': 'दाएँ'}


def oblique(phrase, gender):
    """Put a possessor phrase into the oblique case, ready for का/की."""
    if gender != M:
        return phrase
    out = []
    for w in phrase.split(' '):
        if w in OBLIQUE_IRREGULAR:
            out.append(OBLIQUE_IRREGULAR[w])
        elif w.endswith('ा'):
            out.append(w[:-1] + 'े')
        else:
            out.append(w)
    return ' '.join(out)

# everyday spoken word, where one genuinely exists
COMMON = {
    'हृदय': 'दिल', 'मस्तिष्क': 'दिमाग', 'फेफड़ा': 'फेफड़ा', 'फेफड़े': 'फेफड़े',
    'वृक्क': 'गुर्दा', 'यकृत': 'जिगर', 'प्लीहा': 'तिल्ली', 'आमाशय': 'पेट',
    'अस्थि': 'हड्डी', 'अस्थियाँ': 'हड्डियाँ', 'कपाल': 'खोपड़ी', 'कशेरुका': 'रीढ़ की हड्डी',
    'पसली': 'पसली', 'दाँत': 'दाँत', 'जिह्वा': 'जीभ',
}


def norm_tokens(name):
    s = name.strip()
    s = re.sub(r'\s*\(.*?\)\s*', ' ', s)          # drop parenthetical qualifiers
    s = re.sub(r'\s*\[.*?\]\s*', ' ', s)
    s = re.sub(r'[,]', ' ', s)
    return [t for t in re.split(r'\s+', s.strip()) if t]


def render_phrase(tokens):
    """Adjectives then head noun. Returns (hindi, gender) or None if any token is unknown."""
    if not tokens:
        return None
    head_i = None
    for i in range(len(tokens) - 1, -1, -1):
        if tokens[i].lower() in HEAD:
            head_i = i
            break
    if head_i is None:
        return None
    head_word, gender = HEAD[tokens[head_i].lower()]
    mods_before = tokens[:head_i]
    mods_after = tokens[head_i + 1:]          # e.g. "flexor digitorum longus" after "muscle"
    out = []
    for t in mods_before + mods_after:
        tl = t.lower()
        if tl in ('the', 'a', 'an'):
            continue
        if tl == 'left':
            out.append(LEFT[gender]); continue
        if tl == 'right':
            out.append(RIGHT[gender]); continue
        if tl in MOD and MOD[tl]:
            out.append(MOD[tl]); continue
        if tl in TRANS:
            out.append(TRANS[tl]); continue
        if tl in HEAD:
            out.append(HEAD[tl][0]); continue
        return None                            # unknown token → refuse to guess
    # keep modifiers that trailed the head noun in place, after it
    n_before = len([t for t in mods_before if t.lower() not in ('the', 'a', 'an')])
    before, after = out[:n_before], out[n_before:]
    phrase = ' '.join(before + [head_word] + after)
    return phrase, gender


def compose(name):
    """English anatomical name → Hindi, or None."""
    # "X for Y" → "Y के लिए X" (e.g. Canal for vertebral artery, Groove for subclavian vein)
    m = re.match(r'^(.*?)\s+for\s+(.+)$', name.strip())
    if m:
        head, purpose = compose(m.group(1)), compose(m.group(2))
        return f'{purpose} के लिए {head}' if head and purpose else None
    # "X of Y of Z"  →  "Z का Y का X"  (Hindi puts the possessor first)
    chunks = re.split(r'\s+of\s+', name.strip())
    if len(chunks) == 1:
        r = render_phrase(norm_tokens(name))
        return r[0] if r else None
    rendered = []
    for c in chunks:
        r = render_phrase(norm_tokens(c))
        if not r:
            return None
        rendered.append(r)
    # innermost possessor first; each possessor goes into the oblique case
    out, out_gender = rendered[-1]
    for i in range(len(rendered) - 2, -1, -1):
        phrase, gender = rendered[i]
        out = f'{oblique(out, out_gender)} {GEN[gender]} {phrase}'
        out_gender = gender
    return out


def main():
    hand = json.load(open(SRC, encoding='utf-8'))
    hand_keys = set(hand)
    reg = json.load(open(REGISTRY, encoding='utf-8'))['parts']
    names = collections.OrderedDict()
    for e in reg:
        # landmarks are shown in the inspector and on labels too, so they need Hindi as well
        if e['k'] in ('mesh', 'group', 'landmark') and e['g'] != 'references' and not e.get('paren'):
            names.setdefault(e['n'], e['sys'])

    merged = dict(hand)
    added, failed = 0, []
    for n in names:
        if n in merged:
            continue
        hi = compose(n)
        if not hi:
            failed.append(n)
            continue
        entry = {'hi': hi}
        for k, v in COMMON.items():
            if k in hi and v != k:
                entry['common'] = hi.replace(k, v)
                break
        merged[n] = entry
        added += 1

    json.dump(merged, open(SRC, 'w', encoding='utf-8'), ensure_ascii=False, indent=0, sort_keys=True)
    json.dump(merged, open(OUT_PUB, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)

    total = len(names)
    have = sum(1 for n in names if n in merged)
    print(f'names in registry : {total}')
    print(f'hand-written      : {len(hand_keys & set(names))}')
    print(f'composed now      : {added}')
    print(f'coverage          : {have}/{total} ({have * 100 // total}%)')
    print(f'still English     : {len(failed)}')
    if REPORT:
        w = collections.Counter()
        for n in failed:
            for t in re.findall(r'[A-Za-z]+', n.lower()):
                if t not in HEAD and t not in MOD and t not in TRANS and t != 'of':
                    w[t] += 1
        print('\ntop unknown tokens (add these to the dictionaries to raise coverage):')
        for t, c in w.most_common(40):
            print(f'   {t:24s} {c}')


if __name__ == '__main__':
    main()
