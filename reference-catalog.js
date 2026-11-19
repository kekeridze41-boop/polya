let referenceCatalog = offlineReferenceCatalog;
const recentReferences = [];
let offlineReferenceImages;

function referenceImageSource(item) {
  if (location.protocol !== 'file:') return Promise.resolve(item.src);
  if (!offlineReferenceImages) offlineReferenceImages = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'data/offline-art.js';
    script.onload = () => resolve(offlineArtSources);
    script.onerror = reject;
    document.head.append(script);
  });
  return offlineReferenceImages.then(sources => sources[item.id] ?? item.src);
}

async function loadReferenceCatalog() {
  if (location.protocol === 'file:') return;
  const response = await fetch('data/reference-catalog.json');
  if (!response.ok) throw Error('Каталог референсов недоступен');
  referenceCatalog = await response.json();
}

function referenceWords(text) {
  return new Set((text ?? '').toLowerCase().replaceAll('ё', 'е').match(/[\p{L}]{4,}/gu) ?? []);
}

function referenceOverlap(values, text) {
  const words = referenceWords(text);
  return [...referenceWords(values.join(' '))].filter(word => [...words].some(candidate =>
    candidate === word || (word.length >= 5 && candidate.length >= 5 && candidate.slice(0, 5) === word.slice(0, 5)))).length;
}

function paletteSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const rgb = hex => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const a = left.map(rgb), b = right.map(rgb);
  const distance = (from, to) => from.reduce((total, color) => total + Math.min(...to.map(other =>
    Math.hypot(...color.map((value, index) => value - other[index])))), 0) / from.length;
  return 1 - (distance(a, b) + distance(b, a)) / (2 * Math.sqrt(3) * 255);
}

function chooseReference(idea, direction, previous) {
  if (!referenceCatalog.length) return null;
  const {parts} = idea;
  const alternatives = referenceCatalog.filter(item => item.id !== previous?.id);
  const pool = alternatives.length ? alternatives : referenceCatalog;
  const theme = ['subject', 'place', 'detail'].map(key => parts[key]?.text ?? '').join(' ');
  const scored = pool.map(item => {
    const scores = {
      theme: 3 * Math.min(2, referenceOverlap(item.themes, theme)),
      technique: 2.8 * Math.min(2, referenceOverlap([item.technique], parts.technique?.text)),
      composition: 2.4 * Math.min(2, referenceOverlap(item.composition ?? [], parts.technique?.text)),
      mood: 2 * Math.min(2, referenceOverlap(item.moods, parts.mood?.text)),
      palette: 2 * paletteSimilarity(item.palette, parts.palette?.colors ?? []),
    };
    const score = Object.values(scores).reduce((sum, value) => sum + value, 0) +
      (item.directions?.includes(direction) ? 1 : 0) - (recentReferences.includes(item.id) ? 1.2 : 0);
    const reason = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
    return {item, score, reason: scores[reason] >= 1 ? reason : 'free'};
  }).sort((a, b) => b.score - a.score);
  const shortlist = scored.filter(item => item.score >= scored[0].score - .65).slice(0, 4);
  const {item, reason} = shortlist[Math.floor(Math.random() * shortlist.length)];
  recentReferences.push(item.id);
  if (recentReferences.length > 5) recentReferences.shift();
  return {...item, reason};
}
