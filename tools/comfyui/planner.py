"""Choose a visual question, then a compatible way to depict it."""
from collections import Counter
from itertools import combinations
import random
import uuid


DIRECTIONS = {
    'reference': ('Визуальные референсы', 25),
    'ambiguous': ('Неоднозначные образы и формы', 25),
    'objects': ('Сочетания объектов', 20),
    'process': ('Явления и процессы', 20),
    'finished': ('Готовые художественные образы', 10),
}

NEUTRAL = ('нейтральный монохром', ['#eee9df', '#817d78', '#302e2e'])
OBSERVED = ('ориентир по материалу', ['#e4d8c6', '#968f85', '#534d46'])


def direction_plan(count, rng):
    if count < 10:
        result = []
        while len(result) < count:
            available = [key for key in DIRECTIONS if key not in result[-5:]] or list(DIRECTIONS)
            result += rng.choices(available, weights=[DIRECTIONS[key][1] for key in available], k=1)
        return result
    quotas = {name: count * weight / 100 for name, (_, weight) in DIRECTIONS.items()}
    result = [name for name, quota in quotas.items() for _ in range(int(quota))]
    remaining = sorted(quotas, key=lambda name: (quotas[name] % 1, rng.random()), reverse=True)
    result.extend(remaining[:count - len(result)])
    rng.shuffle(result)
    return result


def object_motifs(objects):
    """Each arrangement requires a relationship between the chosen objects."""
    for a, b in combinations(objects, 2):
        if a['material'] == b['material']:
            continue
        relations = []
        if a['shape'] == b['shape']:
            relations.append(('эхо контура', 'Увидеть сходный внешний контур у предметов из разных материалов',
                              'Show them in two adjacent profile views at the same scale, aligned along their shared curve',
                              ['photo', 'graphite', 'ink', 'linocut']))
        if {a['surface'], b['surface']} == {'rough', 'smooth'}:
            relations.append(('контраст фактур', 'Сравнить шероховатый и гладкий материал в одинаковом свете',
                              'Use a close side view of just the two surface edges, both crossed by the same strip of raking light',
                              ['macro', 'photo', 'graphite']))
        if a['scale'] != b['scale']:
            relations.append(('контраст масштабов', 'Сравнить масштабы через близкий и дальний планы',
                              'Place the smaller object in the near foreground and the larger one farther back; let perspective bring their silhouettes close in apparent size',
                              ['photo', 'graphite', 'collage']))
        if a['natural'] != b['natural']:
            relations.append(('природное и искусственное', 'Сопоставить природную кромку и обработанный край',
                              'Frame the two edges on either side of a narrow gap; show enough of each silhouette to identify its material',
                              ['photo', 'graphite', 'ink', 'collage']))
        for relation, interest, view, media in relations:
            yield dict(title=f"{a['title']} · {b['title']}", subject=f"{a['text']} and {b['text']}",
                       tags=[a['title'].lower(), b['title'].lower()], topic=relation, interest=interest,
                       view=view, media=media)

    grouped = {}
    for item in objects:
        grouped.setdefault(item['shape'], []).append(item)
    for group in grouped.values():
        for trio in combinations(group, 3):
            if len({item['material'] for item in trio}) != 3:
                continue
            yield dict(title=' · '.join(item['title'] for item in trio),
                       subject=', '.join(item['text'] for item in trio[:2]) + ' and ' + trio[2]['text'],
                       tags=[item['title'].lower() for item in trio], topic='повторяющиеся силуэты',
                       interest='Сравнить повторы одной формы в трёх самостоятельных силуэтах',
                       view='Three separate contact prints, one silhouette per panel; align one edge, with visible differences between the profiles',
                       media=['ink', 'linocut', 'monotype'])


def depict(motif, direction, medium, palettes, rng, used_palettes):
    family = medium['family']
    if direction == 'finished':
        complexity = rng.choice(['moderate', 'dense'])
    elif family == 'photo':
        complexity = 'dense' if medium['name'] == 'Натурная макрофотография' else 'moderate'
    else:
        complexity = rng.choice(['minimal', 'fragment', 'moderate'])

    lead = motif['subject'].strip()
    clauses = [lead[0].upper() + lead[1:], motif['view'], medium['text']]
    negative = ['text', 'watermark', medium['negative']]
    if direction == 'ambiguous':
        negative += ['added eyes, drawn mouth, new limbs, explicit drawn face, completed character']
    elif direction == 'objects':
        negative += ['fused objects, personified objects, elaborate narrative scene']

    if family != 'photo' and direction != 'finished':
        tonal = medium['name'] in ('Уголь', 'Пастель')
        opaque = medium['name'] == 'Гуашь'
        if complexity == 'fragment':
            fragments = {
                'marks': 'Leave short searching strokes beside the edge being studied; stop the surrounding contour before it closes',
                'paint': 'Let a wash stop at one tested edge and leave the surrounding paper unpainted',
                'print': 'Let one part of the paper retain a broken transfer where ink did not take',
                'collage': 'Leave one overlap unresolved so that a backing edge remains exposed',
                'digital': 'Keep the main change of plane legible; leave secondary edges unbuilt',
            }
            if tonal:
                fragments['marks'] = 'Work through one value transition and stop before the adjacent one; let the paper show through beside it'
            if opaque:
                fragments['paint'] = 'Block in one opaque plane and leave the adjacent plane at the bare-paper stage'
            clauses.append(fragments[family])
        elif complexity == 'minimal':
            minimal = {
                'marks': 'Use only the strokes that establish the most informative contour; omit background marks',
                'paint': 'Keep a single meeting of washes and leave the adjacent paper bare',
                'print': 'Use one impression with the contact edge visible on the surrounding bare paper',
                'collage': 'Use only the cut shapes needed to show the key separation',
                'digital': 'Retain just the planes that show the change of angle',
            }
            if tonal:
                minimal['marks'] = 'Use just enough tonal changes to separate the key shapes; leave the rest of the paper visible'
            if opaque:
                minimal['paint'] = 'Use a few opaque paint shapes to show the main change of plane'
            if motif['topic'] == 'повторяющиеся силуэты':
                minimal['print'] = 'Keep one impression per panel with no incidental background marks'
            if motif.get('minimal'):
                minimal[family] = motif['minimal']
            clauses.append(minimal[family])
        if complexity in ('minimal', 'fragment'):
            negative.append('fully filled background, closed contours everywhere')

    # Preserve observed material colors by default for literal and process studies.
    explicit = medium['color'] == 'flex' and (direction == 'finished' or
               (family in ('print', 'collage', 'digital') and direction in ('objects', 'ambiguous') and rng.random() < .65))
    if medium['color'] == 'mono':
        palette_name, colors = NEUTRAL
        clauses.append('Monochrome values on neutral paper')
        negative.append('multicolored pigments')
    elif explicit:
        options = palettes if direction == 'finished' else [p for p in palettes if p[0] not in ('яркие акценты', 'контрастные')]
        palette_name, color_text, swatches = min(options or palettes, key=lambda p: used_palettes[p[0]] + rng.random())
        colors = swatches.split(',')
        clauses.append(f'Use {color_text}')
    else:
        palette_name, colors = OBSERVED

    return dict(positive='. '.join(text.rstrip('.') for text in clauses) + '.', negative=', '.join(negative),
                complexity=complexity, palette_name=palette_name, palette=list(colors), palette_prompted=explicit)


def plan_jobs(config, count, recent=(), seed=None):
    if (not isinstance(config, dict) or not isinstance(config.get('motifs'), dict)
            or not isinstance(config.get('techniques'), dict)
            or not isinstance(config.get('objects'), list)
            or any(not isinstance(item, dict) for item in config['objects'])
            or any(not isinstance(items, list) or any(not isinstance(item, dict) for item in items)
                   for items in config['motifs'].values())):
        raise ValueError('Формат библиотеки промптов устарел или несовместим. Сверьте файл с tools/comfyui/prompts.json и перезапустите мастерскую.')
    rng = random.Random(seed)
    pools = {**config['motifs'], 'objects': [*object_motifs(config['objects']), *config.get('object_studies', [])]}
    techniques = config['techniques']
    for key in DIRECTIONS:
        if not pools.get(key) or any(not motif['media'] or any(mark not in techniques for mark in motif['media']) for motif in pools[key]):
            raise ValueError(f'Проверьте мотивы и список допустимых техник в направлении {key}.')
    if not config['palettes']:
        raise ValueError('Список палитр должен быть непустым.')

    recent_motifs = Counter(job.get('motif_key') for job in recent)
    recent_topics = Counter(job.get('topic') for job in recent)
    recent_objects = Counter(tag for job in recent if job.get('reference_direction') == 'objects' for tag in job['themes'])
    used_motifs, used_media, used_palettes, used_topics, used_objects = (Counter() for _ in range(5))
    prompts_seen = {job['positive'] for job in recent if 'positive' in job}
    output = []
    for direction in direction_plan(count, rng):
        pool = pools[direction]

        def choose_score(motif):
            key = f"{direction}:{motif['title']}"
            score = (18 * used_motifs[key] + 4 * recent_motifs[key] + 3 * used_topics[motif['topic']]
                     + .75 * recent_topics[motif['topic']] + rng.random())
            if direction == 'objects':
                score += sum(6 * used_objects[tag] + .3 * recent_objects[tag] for tag in motif['tags'])
            return score

        # Pick the visual question independently of medium, then rank only feasible treatments.
        motif = min(pool, key=choose_score)
        motif_key = f"{direction}:{motif['title']}"
        proposals = []
        for code in motif['media']:
            medium = techniques[code]
            depiction = depict(motif, direction, medium, config['palettes'], rng, used_palettes)
            score = 3 * used_media[code] + (60 if depiction['positive'] in prompts_seen else 0) + rng.random()
            proposals.append((score, code, medium, depiction))
        _, code, medium, depiction = min(proposals, key=lambda item: item[0])
        used_motifs[motif_key] += 1
        used_media[code] += 1
        used_topics[motif['topic']] += 1
        if depiction['palette_prompted']:
            used_palettes[depiction['palette_name']] += 1
        if direction == 'objects':
            used_objects.update(motif['tags'])
        prompts_seen.add(depiction['positive'])

        style = {'reference': 'daily', 'ambiguous': 'odd', 'objects': 'odd', 'process': 'abstract', 'finished': 'any'}[direction]
        output.append(dict(id=uuid.uuid4().hex, status='pending', prompt_id=None, seed=rng.randrange(2**48),
                           title=motif['title'], motif_key=motif_key, reference_direction=direction,
                           direction_label=DIRECTIONS[direction][0], topic=motif['topic'], visual_intent=motif['interest'], framing=motif['view'],
                           technique=medium['name'], technique_id=code, medium_family=medium['family'],
                           themes=motif['tags'], moods=['наблюдение' if direction == 'reference' else 'любопытство'],
                           composition=[motif['topic'] if direction == 'objects' else motif['view']],
                           directions=[] if style == 'any' else [style], **depiction))
    return output
