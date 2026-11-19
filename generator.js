const ideaFields = ['subject', 'place', 'mood', 'detail', 'technique', 'palette'];
const ideaLabels = {subject: 'Персонаж или предмет', place: 'Место', mood: 'Настроение', detail: 'Необычная деталь', technique: 'Приём', palette: 'Палитра', art: 'Референс'};
const customIdeaFields = ['subject', 'place', 'mood', 'detail'];
const ideaFormats = [
  {id: 'scene', title: 'Небольшая сцена', slots: ['subject', 'place', 'mood'], prompt: 'Соберите сцену из предложенных элементов. Оставьте только то, что помогает прочитать кадр.'},
  {id: 'study', title: 'Этюд одного мотива', slots: ['subject', 'technique'], prompt: 'Возьмите один мотив и исследуйте его с помощью предложенного приёма.'},
  {id: 'room', title: 'Этюд пространства', slots: ['place', 'technique'], prompt: 'Возьмите за основу предложенное место. Рисуйте по памяти или воображению.'},
  {id: 'traces', title: 'Портрет без портрета', slots: ['subject', 'detail'], prompt: 'Передайте присутствие главного мотива через следы, отбрасываемую тень или соседние предметы.'},
  {id: 'abstract', title: 'Композиция из форм', slots: ['mood', 'technique'], prompt: 'Соберите беспредметную композицию. Попробуйте передать настроение ритмом, формой или цветом.'},
  {id: 'experiment', title: 'Визуальный эксперимент', slots: ['detail', 'technique'], prompt: 'Начните с необычной детали и выстройте вокруг неё весь рисунок.'},
  {id: 'play', title: 'Нелепое сочетание', slots: ['subject', 'detail', 'place'], prompt: 'Соедините элементы как угодно. Если сочетание кажется смешным, подчеркните это.'},
  {id: 'space', title: 'Настроение пространства', slots: ['place', 'mood'], prompt: 'Передайте настроение через пространство. Попробуйте обойтись без людей в кадре.'},
];
const preferredFormats = {daily: ['room', 'study', 'scene'], odd: ['experiment', 'play', 'traces'], dark: ['space', 'traces', 'scene'], fun: ['play', 'scene', 'experiment'], abstract: ['abstract', 'experiment']};

let ideaLibrary = offlineIdeaLibrary;
let customIdeas = [];
const recentIdeas = [];

async function loadIdeaLibrary() {
  if (location.protocol === 'file:') return;
  const lists = await Promise.all(ideaFields.map(async key => {
    const response = await fetch(`data/${key}.json`);
    if (!response.ok) throw Error(key);
    return [key, await response.json()];
  }));
  ideaLibrary = Object.fromEntries(lists);
}

function ideaIdentity(value) {
  return value?.id ?? value?.text ?? '';
}

function pickWeighted(items, preference) {
  const preferred = items.filter(preference);
  const pool = preferred.length && Math.random() < .67 ? preferred : items;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickIdeaValue(key, direction, old) {
  const custom = customIdeas.filter(item => item.field === key && ideaIdentity(item) !== ideaIdentity(old));
  const pool = custom.length && Math.random() < .16 ? custom : ideaLibrary[key];
  const choices = pool.filter(value => ideaIdentity(value) !== ideaIdentity(old));
  return pickWeighted(choices.length ? choices : pool, item => item.tag === direction);
}

function ideaSignature(idea) {
  return JSON.stringify([idea.format, ...ideaFields.map(key => ideaIdentity(idea.parts[key]))]);
}

function rememberIdea(idea) {
  recentIdeas.push(ideaSignature(idea));
  if (recentIdeas.length > 256) recentIdeas.shift();
  return idea;
}

function generateIdea(previous, locked, direction, only = null) {
  const parts = previous?.parts ?? {};
  if (only && locked.has(only)) return previous;
  const allowedFormats = ideaFormats.filter(format => [...locked].every(key =>
    !ideaFields.includes(key) || !parts[key] || key === 'palette' || format.slots.includes(key)));
  let candidate;
  for (let attempt = 0; attempt < 16; attempt++) {
    const fixedFormat = ideaFormats.find(format => format.id === previous?.format);
    const format = only ? fixedFormat ?? ideaFormats[0] : pickWeighted(allowedFormats.length ? allowedFormats : ideaFormats,
      item => preferredFormats[direction]?.includes(item.id));
    const slots = new Set([...format.slots, 'palette', ...locked]);
    if (only) for (const key of Object.keys(parts)) if (parts[key]) slots.add(key);
    if (only) slots.add(only);
    candidate = {format: format.id, parts: {}, ...(only && previous?.legacy ? {legacy: previous.legacy} : {})};
    for (const key of ideaFields) {
      if (locked.has(key) || (only && key !== only)) candidate.parts[key] = parts[key] ?? null;
      else candidate.parts[key] = slots.has(key) ? pickIdeaValue(key, direction, parts[key]) : null;
    }
    if (!recentIdeas.includes(ideaSignature(candidate))) break;
  }
  return rememberIdea(candidate);
}

function describeIdea(idea) {
  if (idea.legacy) return idea.legacy;
  const format = ideaFormats.find(item => item.id === idea.format) ?? ideaFormats[0];
  if (format.id === 'abstract' && (idea.parts.subject || idea.parts.place)) {
    return {title: 'Композиция из форм', prompt: 'Упростите предложенные образы до пятен, линий или силуэтов.'};
  }
  if (format.id === 'space' && idea.parts.subject) {
    return {title: format.title, prompt: 'Передайте настроение через пространство и его связь с выбранным мотивом.'};
  }
  return {title: format.title, prompt: format.prompt};
}
