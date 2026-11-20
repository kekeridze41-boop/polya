const byId = id => document.getElementById(id);
const workspace = byId('workspace');
const drawing = byId('drawing');
const reference = byId('reference');
const archiveDialog = byId('archive');
const ownDialog = byId('own-library');
const referenceDeck = createReferenceDeck({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
const drawingSurfaces = [...workspace.querySelectorAll('.draw-surface')];
const storageKey = 'polya.archive.v1';
const drawingDraftKey = 'polya.drawing-draft.v1';
const anchors = [reference, ...workspace.querySelectorAll('.margin')];
const mobileSpread = matchMedia('(max-width: 800px)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const drawerTabs = [byId('left-tab'), byId('right-tab')];
let openDrawer = -1;
let movingDrawer = -1;
let drawerFrame;
let workDrawerBeforeArchive = -1;
let turning = false;
const stickerLayer = byId('sticker-layer');
const fieldStickerLayers = [...workspace.querySelectorAll('.field-sticker-layer')];
const composition = workspace.querySelector('.composition');
const draftKey = 'polya.sticker-layout.v1';
let selection = {parts: {art: null}};
let legacyNotes = [];
let legacyPins = [];
let currentColors = [];
const paletteCache = new Map();
let currentArt;
let referenceAvailable = false;
let referenceReady = Promise.resolve();
const artImages = new Map();
let strokes = [];
let undoStack = [];
let redoStack = [];
let active = null;
const toolIds = ['hand', 'pencil', 'brush', 'eraser', 'line', 'stickers'];
let tool = 'hand';
let archivedWork = null;
let stickers = [];
let hasCachedStickerLayout = false;
let stickerChoice = null;
let selectedSticker = null;
let archive = [];
let builtInDraft = null;
let ownTransition = false;
let ownBaseline = '[]';
let legacyOwnLayout;
let savingOwn = false;
let builtInHistory;

try {
  const stored = JSON.parse(localStorage.getItem(storageKey));
  if (Array.isArray(stored)) archive = stored;
  const draft = JSON.parse(localStorage.getItem(drawingDraftKey));
  if (draft && Array.isArray(draft.strokes)) {
    strokes = draft.strokes;
    selection = draft.selection?.parts ? draft.selection : selection;
    legacyNotes = draft.notes ?? [];
    legacyPins = draft.pins ?? [];
    if (selection.parts.art?.own && draft.builtInDraft) {
      const {stickers: previousLayout, ...previousDraft} = draft.builtInDraft;
      builtInDraft = previousDraft;
      if (Array.isArray(draft.ownStickers)) legacyOwnLayout = {previousLayout, own: draft.ownStickers};
      const baseline = JSON.parse(draft.ownBaseline ?? '[]');
      ownBaseline = legacyOwnLayout ? JSON.stringify(baseline[0] ?? []) : JSON.stringify(baseline);
      const oldArt = selection.parts.art;
      selection = {parts: {art: {id: oldArt.id, own: true, name: ownName(oldArt.name)}}};
    }
    const settings = draft.settings;
    if (settings) {
      if (settings.sketch !== false && toolIds.includes(settings.tool)) tool = settings.tool;
      if (/^#[0-9a-f]{6}$/i.test(settings.color)) byId('ink').value = settings.color;
      if (Number.isInteger(settings.width) && settings.width >= 1 && settings.width <= 32) byId('width').value = settings.width;
    }
  }
  const layout = JSON.parse(localStorage.getItem(draftKey));
  if (Array.isArray(layout)) {
    stickers = layout;
    hasCachedStickerLayout = true;
  }
} catch {
  byId('status').textContent = 'Локальный архив недоступен.';
}

function announce(message) {
  byId('status').textContent = message;
}

function updateHistory() {
  byId('undo').disabled = !undoStack.length;
  byId('redo').disabled = !redoStack.length;
  byId('clear').disabled = !strokes.length;
}

function visibleArt() { return (archivedWork?.selection ?? selection).parts.art; }
function visibleStrokes() { return archivedWork?.strokes ?? strokes; }
function visibleStickers() { return stickers; }

function showPalette(colors) {
  currentColors = colors.slice(0, 5);
  const palette = byId('palette');
  palette.hidden = !colors.length;
  palette.replaceChildren(...currentColors.map(color => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.style.backgroundColor = color;
    button.title = color;
    button.setAttribute('aria-label', `Выбрать цвет ${color}`);
    button.disabled = !!archivedWork;
    button.onclick = () => {
      if (archivedWork) return;
      byId('ink').value = color;
      saveDrawingDraft();
      announce(`Цвет рисования ${color}`);
    };
    return button;
  }));
}

function saveDrawingDraft() {
  if (archivedWork) return;
  try {
    const settings = {tool, color: byId('ink').value, width: Number(byId('width').value)};
    const ownDraft = builtInDraft ? {builtInDraft, ownBaseline} : {};
    localStorage.setItem(drawingDraftKey, JSON.stringify({selection, strokes, notes: legacyNotes, pins: legacyPins, settings, ...ownDraft}));
  } catch { announce('Не удалось сохранить черновик в браузере.'); }
}

function paintIdeaArt(art) {
  const key = art?.id ?? null;
  if (key === currentArt) return;
  currentArt = key;
  referenceAvailable = false;
  const picture = reference.parentElement;
  const status = byId('reference-status');
  const ctx = reference.getContext('2d');
  ctx.clearRect(0, 0, reference.width, reference.height);
  picture.classList.toggle('reference-empty', !art);
  status.hidden = !!art;
  status.textContent = 'В каталоге пока нет изображений.';
  byId('save').disabled = true;
  showPalette([]);
  reference.setAttribute('aria-label', art?.own ? ownName(art.name) : art?.title ?? art?.text ?? 'Референс отсутствует');
  if (!art) {
    referenceReady = Promise.resolve();
    return;
  }

  const finish = source => {
    referenceAvailable = true;
    if (!paletteCache.has(key)) {
      let colors;
      try { colors = paletteFromReference(source); }
      catch { colors = art.palette ?? []; }
      if (paletteCache.size >= 30) paletteCache.delete(paletteCache.keys().next().value);
      paletteCache.set(key, colors);
    }
    showPalette(paletteCache.get(key));
    byId('save').disabled = !!archivedWork;
    layoutStickers();
  };
  if (art.legacyIndex !== undefined) {
    reference.width = 960;
    reference.height = 520;
    picture.style.setProperty('--reference-ratio', 960 / 520);
    paintReference(reference, references[art.legacyIndex]);
    finish(reference);
    referenceReady = Promise.resolve();
    return;
  }
  referenceReady = decodedReference(art).then(image => {
    if (currentArt !== key) return;
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    reference.width = Math.max(1, Math.round(image.naturalWidth * scale));
    reference.height = Math.max(1, Math.round(image.naturalHeight * scale));
    picture.style.setProperty('--reference-ratio', image.naturalWidth / image.naturalHeight);
    ctx.drawImage(image, 0, 0, reference.width, reference.height);
    finish(image);
  }).catch(() => {
    artImages.delete(key);
    if (currentArt !== key) return;
    picture.classList.add('reference-empty');
    status.hidden = false;
    status.textContent = 'Не удалось загрузить изображение.';
  });
}

function decodedReference(art) {
  const key = art.id;
  if (!artImages.has(key)) {
    if (artImages.size >= 4) artImages.delete(artImages.keys().next().value);
    artImages.set(key, (async () => {
      const record = art.own ? await ownReference(key) : null;
      if (art.own && !record) throw Error('Изображение отсутствует в хранилище.');
      const src = record ? URL.createObjectURL(record.blob) : await referenceImageSource(art);
      try {
        const image = new Image();
        image.src = src;
        await image.decode();
        return image;
      } finally { if (record) URL.revokeObjectURL(src); }
    })().catch(error => {
      artImages.delete(key);
      throw error;
    }));
  }
  return artImages.get(key);
}

function renderIdea() {
  updateReferenceSpace();
  const art = visibleArt();
  byId('next').hidden = !!archivedWork || !!art?.own;
  byId('leave-own').hidden = !!archivedWork || !art?.own;
  byId('save').textContent = art?.own ? 'Сохранить' : 'В архив';
  byId('next').disabled = turning || !!archivedWork || !referenceCatalog.some(item => item.id !== art?.id);
  paintIdeaArt(art);
  byId('save').disabled = !!archivedWork || !referenceAvailable;
  for (const button of byId('palette').children) button.disabled = !!archivedWork;
  layoutStickers();
}

function confirmPageTurn() {
  const dialog = byId('confirm-turn');
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'turn'), {once: true});
    dialog.showModal();
  });
}

byId('next').onclick = async () => {
  if (archivedWork || turning || active || selection.parts.art?.own || (mobileSpread.matches && (openDrawer >= 0 || movingDrawer >= 0))) return;
  const art = referenceDeck.peek(referenceCatalog, selection.parts.art?.id);
  if (!art || art.id === selection.parts.art?.id) return;
  turning = true;
  byId('next').disabled = true;
  let pageTurn;
  try {
    if (strokes.length && !await confirmPageTurn()) return;
    workspace.inert = true;
    byId('tools').inert = true;
    try { if (art.legacyIndex === undefined) await decodedReference(art); }
    catch { return announce('Следующее изображение не загрузилось. Текущий разворот сохранён.'); }
    showToolPopup(null);
    if (!reduceMotion.matches) {
      await referenceReady;
      pageTurn = beginPaperTurn(document.querySelector('.notebook'), paintTurnSnapshot, mobileSpread.matches);
    }
    selection = {parts: {art}};
    referenceDeck.advance(art.id);
    // Keep only revisions that change the persistent stickers.
    undoStack = undoStack.filter((revision, index) => revision.stickers !== (undoStack[index + 1]?.stickers ?? stickers))
      .map(({stickers}) => ({strokes: [], stickers}));
    redoStack = [];
    strokes = [];
    announce('');
    renderIdea();
    renderDrawing();
    updateHistory();
    saveDrawingDraft();
    if (pageTurn) {
      await referenceReady;
      await pageTurn.play();
    }
  } finally {
    pageTurn?.remove();
    workspace.inert = false;
    byId('tools').inert = false;
    turning = false;
    renderIdea();
  }
};
loadReferenceCatalog().catch(() => announce('Каталог на сервере недоступен, используется локальная версия.')).then(() => {
  if (archivedWork) return;
  referenceDeck.sync(referenceCatalog, (builtInDraft?.selection ?? selection).parts.art?.id);
  if (!selection.parts.art && referenceCatalog.length) {
    const art = referenceDeck.peek(referenceCatalog);
    selection = {parts: {art}};
    referenceDeck.advance(art.id);
    saveDrawingDraft();
  }
  renderIdea();
});

function refreshMode() {
  const editing = !archivedWork;
  workspace.classList.toggle('archive-view', !editing);
  workspace.classList.toggle('sketch', editing && tool !== 'hand' && tool !== 'stickers');
  workspace.classList.toggle('stickering', editing && tool === 'stickers');
  byId('close-book').disabled = !editing;
  byId('tools').hidden = !editing;
  byId('save').hidden = byId('show-own').disabled = !editing;
  byId('back-to-archive').hidden = editing;
  for (const id of toolIds) byId(id).setAttribute('aria-pressed', id === tool);
}

function setTool(value, popup = null) {
  if (archivedWork || turning || active) return;
  tool = value;
  const editing = value === 'stickers';
  refreshMode();
  if (!editing) stickerChoice = null;
  showToolPopup(popup);
  renderStickers();
  saveDrawingDraft();
}

function showToolPopup(popup) {
  for (const id of ['ink-panel', 'sticker-panel', 'sticker-edit']) byId(id).hidden = id !== popup;
  byId('stickers').setAttribute('aria-expanded', popup === 'sticker-panel');
  for (const id of ['pencil', 'brush', 'line']) byId(id).setAttribute('aria-expanded', popup === 'ink-panel' && tool === id);
}

function applyRevision(nextStrokes, nextStickers) {
  if (archivedWork || turning) return;
  undoStack.push({strokes, stickers});
  redoStack = [];
  showRevision({strokes: nextStrokes, stickers: nextStickers});
}

function showRevision(revision) {
  const layoutChanged = stickers !== revision.stickers;
  const drawingChanged = strokes !== revision.strokes;
  ({strokes, stickers} = revision);
  if (layoutChanged) saveStickerLayout();
  if (drawingChanged) saveDrawingDraft();
  updateReferenceSpace();
  updateHistory();
  renderDrawing();
  if (layoutChanged) renderStickers();
}

function updateReferenceSpace() {
  workspace.classList.toggle('has-reference-marks', visibleStrokes().some(stroke => stroke.anchor === 1) ||
    visibleStickers().some(sticker => sticker.anchor === 1));
}

function saveStickerLayout() {
  if (archivedWork) return;
  const layout = stickers;
  let cached = false;
  try {
    localStorage.setItem(draftKey, JSON.stringify(layout));
    cached = true;
  } catch { /* IndexedDB still provides persistent storage. */ }
  stickerStore('readwrite', store => store.put(layout, draftKey), 'layouts').catch(() => {
    announce(cached ? 'IndexedDB недоступна. Вклейки сохранены в локальном кэше.' : 'Не удалось сохранить расположение вклеек.');
  });
}

function localRects() {
  const base = drawing.getBoundingClientRect();
  const rects = anchors.map(element => element.getBoundingClientRect());
  if (mobileSpread.matches && !workspace.classList.contains('exporting')) {
    const visible = movingDrawer >= 0 ? movingDrawer : openDrawer;
    if (visible >= 0) rects[0] = new DOMRect();
    for (let i = 0; i < 2; i++) if (i !== visible) rects[i + 1] = new DOMRect();
    return [visible >= 0 ? new DOMRect() : base, ...rects];
  }
  return [base, ...rects];
}

function normalizedPoint(event, rect, pencil = false, liftPressure) {
  const point = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  if (pencil) point.push(event.pointerType === 'pen' ? liftPressure ?? event.pressure : .5);
  return point;
}

function drawPencil(ctx, points, width) {
  const graphite = pressure => .55 + .65 * (pressure ?? .5);
  ctx.globalAlpha = .72;
  if (points.length === 1) {
    const [x, y, pressure] = points[0];
    ctx.beginPath();
    ctx.arc(x, y, width * graphite(pressure) * .28, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 1; i < points.length; i++) {
    const [x, y, pressure] = points[i];
    const [prevX, prevY, prevPressure] = points[i - 1];
    const weight = width * (graphite(pressure) + graphite(prevPressure)) / 2;
    ctx.globalAlpha = i % 4 === 0 ? .61 : .77;
    ctx.lineWidth = Math.max(.65, weight * .55);
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (weight < 2) continue;
    ctx.globalAlpha = .22;
    ctx.lineWidth = Math.max(.4, weight * .13);
    ctx.setLineDash([1, 2.1]);
    ctx.beginPath();
    ctx.moveTo(prevX + weight * .27, prevY - weight * .2);
    ctx.lineTo(x + weight * .27, y - weight * .2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function renderDrawing() {
  const rects = localRects();
  const base = drawing.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(base.width * scale));
  const height = Math.max(1, Math.round(base.height * scale));
  if (drawing.width !== width) drawing.width = width;
  if (drawing.height !== height) drawing.height = height;
  const ctx = drawing.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width / scale, height / scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const visible = active && !archivedWork ? [...strokes, active.stroke] : visibleStrokes();
  for (const stroke of visible) {
    const rect = rects[stroke.anchor];
    if (!rect.width || !rect.height) continue;
    ctx.save();
    if (stroke.fieldOnly) {
      ctx.beginPath();
      ctx.rect(rect.left - base.left, rect.top - base.top, rect.width, rect.height);
      ctx.clip();
    }
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
    if (stroke.tool === 'pencil') {
      drawPencil(ctx, stroke.points.map(([x, y, pressure]) => [
        rect.left - base.left + x * rect.width, rect.top - base.top + y * rect.height, pressure
      ]), stroke.width);
      ctx.restore();
      continue;
    }
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    for (const [index, point] of stroke.points.entries()) {
      const x = rect.left - base.left + point[0] * rect.width;
      const y = rect.top - base.top + point[1] * rect.height;
      if (stroke.points.length === 1) {
        ctx.arc(x, y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (stroke.points.length > 1) ctx.stroke();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

drawing.onpointerdown = event => {
  if (!archivedWork && event.button === 0 && tool === 'stickers' && stickerChoice) placeSticker(event);
};

function beginFieldStroke(event, anchor) {
  if (archivedWork || turning || active || tool === 'hand' || tool === 'stickers' || (mobileSpread.matches && movingDrawer >= 0) || event.button !== 0) return;
  const rects = localRects();
  if (!rects[anchor].width) return;
  active = {id: event.pointerId, stroke: {anchor, fieldOnly: true, tool, erase: tool === 'eraser', color: byId('ink').value,
    width: Number(byId('width').value), points: [normalizedPoint(event, rects[anchor], tool === 'pencil')]}};
  event.currentTarget.setPointerCapture(event.pointerId);
  renderDrawing();
}

function moveFieldStroke(event) {
  if (active?.id !== event.pointerId) return;
  const rect = localRects()[active.stroke.anchor];
  if (active.stroke.tool === 'line') {
    active.stroke.points[1] = normalizedPoint(event, rect);
    renderDrawing();
    return;
  }
  const events = event.getCoalescedEvents?.();
  for (const point of events?.length ? events : [event]) {
    active.stroke.points.push(normalizedPoint(point, rect, active.stroke.tool === 'pencil'));
  }
  renderDrawing();
}

function endFieldStroke(event) {
  if (active?.id !== event.pointerId) return;
  const {stroke} = active;
  const previous = stroke.points.at(-1);
  const end = normalizedPoint(event, localRects()[stroke.anchor], stroke.tool === 'pencil', previous[2]);
  if (stroke.tool === 'line') stroke.points[1] = end;
  else if (previous[0] !== end[0] || previous[1] !== end[1]) stroke.points.push(end);
  active = null;
  applyRevision([...strokes, stroke], stickers);
}

function cancelFieldStroke(event) {
  if (active?.id !== event.pointerId) return;
  active = null;
  renderDrawing();
}

drawingSurfaces.forEach((surface, index) => {
  surface.onpointerdown = event => beginFieldStroke(event, index + 2);
  surface.onpointermove = moveFieldStroke;
  surface.onpointerup = endFieldStroke;
  surface.onpointercancel = surface.onlostpointercapture = cancelFieldStroke;
});

function layoutDrawers() {
  const visible = movingDrawer >= 0 ? movingDrawer : openDrawer;
  workspace.classList.toggle('mobile-drawer-open', mobileSpread.matches && visible >= 0);
  composition.inert = mobileSpread.matches && visible >= 0;
  const mobilePalette = byId('mobile-palette');
  const paletteHost = mobileSpread.matches ? mobilePalette : byId('desktop-palette');
  const palette = byId('palette');
  if (palette.parentElement !== paletteHost) paletteHost.append(palette);
  mobilePalette.hidden = !mobileSpread.matches || openDrawer < 0;
  drawerTabs.forEach((tab, index) => {
    const drawer = anchors[index + 1];
    drawer.classList.toggle('drawer-visible', visible === index);
    drawer.classList.toggle('drawer-out', openDrawer === index && visible === index);
    tab.setAttribute('aria-expanded', openDrawer === index);
    tab.classList.toggle('drawer-out', openDrawer === index);
    tab.classList.toggle('drawer-pulling', drawer.classList.contains('drawer-pulling'));
    tab.classList.toggle('drawer-obscured', visible >= 0 && visible !== index);
  });
}

function repaintSpread() {
  renderDrawing();
  layoutStickers();
}

function settleDrawer(next, index = -1) {
  active = null;
  cancelAnimationFrame(drawerFrame);
  movingDrawer = index >= 0 ? index : next >= 0 ? next : openDrawer;
  openDrawer = next;
  layoutDrawers();
  const deadline = performance.now() + (reduceMotion.matches ? 0 : 280);
  const repaint = now => {
    if (now >= deadline) {
      movingDrawer = -1;
      layoutDrawers();
    } else drawerFrame = requestAnimationFrame(repaint);
    renderDrawing();
  };
  repaint(performance.now());
}

drawerTabs.forEach((tab, index) => {
  const drawer = anchors[index + 1];
  const sign = index === 0 ? 1 : -1;
  const opening = () => openDrawer !== index;
  bindHorizontalPull(tab, {
    blocked: () => turning || !!active || !mobileSpread.matches,
    move(dx) {
      cancelAnimationFrame(drawerFrame);
      movingDrawer = index;
      drawer.classList.add('drawer-pulling');
      layoutDrawers();
      const start = opening() ? 0 : 1;
      const progress = Math.max(0, Math.min(1, start + sign * dx / drawer.offsetWidth));
      drawer.style.setProperty('--pull-progress', progress);
      tab.style.setProperty('--pull-progress', progress);
      renderDrawing();
    },
    release(dx) {
      const change = (opening() ? sign : -sign) * dx >= 53;
      const next = change ? opening() ? index : -1 : openDrawer;
      drawer.classList.remove('drawer-pulling');
      drawer.style.removeProperty('--pull-progress');
      tab.style.removeProperty('--pull-progress');
      settleDrawer(next, next >= 0 ? next : index);
    },
    tap: () => settleDrawer(opening() ? index : -1, index),
  });
});
mobileSpread.addEventListener('change', () => {
  settleDrawer(-1);
  layoutStickers();
});
for (const id of toolIds) {
  byId(id).onclick = () => {
    const popup = {pencil: 'ink-panel', brush: 'ink-panel', line: 'ink-panel', stickers: 'sticker-panel'}[id];
    if (id === 'stickers') stickerChoice = null;
    setTool(id, popup && (tool !== id || byId(popup).hidden) ? popup : null);
  };
}
byId('clear').onclick = () => applyRevision([], stickers);
byId('undo').onclick = () => {
  if (archivedWork || turning || !undoStack.length) return;
  redoStack.push({strokes, stickers});
  showRevision(undoStack.pop());
};
byId('redo').onclick = () => {
  if (archivedWork || turning || !redoStack.length) return;
  undoStack.push({strokes, stickers});
  showRevision(redoStack.pop());
};

const stickerSize = byId('sticker-size');
const stickerAngle = byId('sticker-angle');
const pickerButtons = new Map();

function addStickerToGallery(kind, asset) {
  const button = document.createElement('button');
  button.title = asset.label;
  button.setAttribute('aria-label', asset.label);
  const image = asset.image.cloneNode();
  image.alt = '';
  button.append(image);
  button.onclick = () => {
    stickerChoice = kind;
    selectedSticker = null;
    showToolPopup(null);
    syncStickerControls();
    announce('Коснитесь места на развороте, чтобы разместить вклейку.');
  };
  pickerButtons.set(kind, button);
  byId('sticker-picker').append(button);
}

for (const [kind, asset] of stickerCatalog) addStickerToGallery(kind, asset);

const initialStickerLayout = stickers;
const storedStickersReady = Promise.all([
  stickerStore('readonly', store => store.getAll()),
  stickerStore('readonly', store => store.get(draftKey), 'layouts'),
]).then(([records, savedLayout]) => {
  for (const record of records) {
    stickerAssets[record.id] = makeStoredSticker(record);
    addStickerToGallery(record.id, stickerAssets[record.id]);
  }
  if (stickers === initialStickerLayout) {
    if (!hasCachedStickerLayout && Array.isArray(savedLayout)) stickers = savedLayout;
    else if (hasCachedStickerLayout && !savedLayout) saveStickerLayout();
  }
  renderStickers();
}).catch(() => {
  byId('sticker-message').textContent = 'Хранилище браузера недоступно. Встроенные вклейки работают.';
}).then(() => {
  if (!legacyOwnLayout) return;
  const merged = new Map([...(legacyOwnLayout.previousLayout ?? []), ...stickers, ...legacyOwnLayout.own]
    .map(sticker => [sticker.id, sticker]));
  stickers = [...merged.values()];
  legacyOwnLayout = null;
  saveStickerLayout();
  saveDrawingDraft();
  renderStickers();
});

byId('sticker-file').onchange = async event => {
  if (archivedWork) return;
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  const message = byId('sticker-message');
  input.disabled = true;
  try {
    await storedStickersReady;
    const [kind, asset] = await prepareStickerFile(file);
    if (pickerButtons.has(kind)) {
      URL.revokeObjectURL(asset.image.src);
      pickerButtons.get(kind).scrollIntoView({block: 'nearest'});
      message.textContent = 'Это изображение уже есть в галерее.';
      return;
    }
    stickerAssets[kind] = asset;
    addStickerToGallery(kind, asset);
    pickerButtons.get(kind).scrollIntoView({block: 'nearest'});
    message.textContent = 'Вклейка добавлена в галерею.';
  } catch (error) {
    message.textContent = `Не удалось добавить вклейку. ${error.message || 'Проверьте доступность хранилища браузера.'}`;
  } finally {
    input.value = '';
    input.disabled = false;
  }
};

function stickerRects() {
  return [stickerLayer.getBoundingClientRect(), ...anchors.map(element => element.getBoundingClientRect()), composition.getBoundingClientRect()];
}

function stickerAnchor(sticker) {
  if ([0, 1, 2, 3, 4].includes(sticker.anchor)) return sticker.anchor;
  if (sticker.field === 0 || sticker.field === 1) return sticker.field + 2;
  return 4;
}

function stickerHost(sticker) {
  const field = stickerAnchor(sticker) - 2;
  return mobileSpread.matches && !workspace.classList.contains('exporting')
    ? fieldStickerLayers[field] ?? stickerLayer : stickerLayer;
}

function positionSticker(element, sticker, rects = stickerRects(), base = element.parentElement.getBoundingClientRect()) {
  const narrow = mobileSpread.matches;
  const anchor = stickerAnchor(sticker);
  const legacyField = sticker.anchor === undefined && (sticker.field === 0 || sticker.field === 1);
  let rect = rects[anchor];
  element.hidden = !rect?.width || !rect.height;
  if (element.hidden) return;
  const size = sticker.size * (narrow ? .72 : 1);
  const inset = size * .72;
  if (legacyField) {
    // Preserve the placement of stickers saved before the full-spread layer.
    const side = narrow ? 9 : 4;
    const top = narrow ? 30 : 34;
    const bottom = narrow ? 84 : 120;
    rect = {left: rect.left + side, top: rect.top + top, width: rect.width - 2 * side, height: rect.height - top - bottom};
  }
  const clamp = (value, extent) => Math.max(inset, Math.min(extent - inset, value));
  const x = rect.left - base.left + (legacyField ? clamp(sticker.x * rect.width, rect.width) : sticker.x * rect.width);
  const y = rect.top - base.top + (legacyField ? clamp(sticker.y * rect.height, rect.height) : sticker.y * rect.height);
  if (sticker.anchor === 0 && y > base.height) {
    element.hidden = true;
    return;
  }
  const legacyGlobal = element.parentElement === stickerLayer && (legacyField || anchor < 2);
  element.style.setProperty('--sticker-x', (legacyGlobal ? clamp(x, base.width) : x) + 'px');
  element.style.setProperty('--sticker-y', (legacyGlobal ? clamp(y, base.height) : y) + 'px');
  const asset = stickerAssets[sticker.kind];
  const {image} = asset;
  const width = image.naturalWidth || 1;
  const height = image.naturalHeight || 1;
  const scale = size / Math.max(width, height);
  element.style.setProperty('--sticker-size', `${width * scale}px`);
  element.style.setProperty('--sticker-height', `${height * scale}px`);
  element.style.setProperty('--sticker-angle', `${sticker.angle}deg`);
  paintStickerFinish(element.firstElementChild, image, width * scale, height * scale, stickerFinish(sticker, asset));
}

function stickerPoint(event) {
  const rects = stickerRects();
  const contains = rect => rect.width && rect.height && event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom;
  const drawer = mobileSpread.matches && openDrawer >= 0 ? openDrawer + 2 : null;
  const anchor = drawer ?? [2, 3].find(index => !mobileSpread.matches && contains(rects[index])) ?? 4;
  const clamp = value => Math.min(1, Math.max(0, value));
  const [x, y] = normalizedPoint(event, rects[anchor]);
  return {anchor, x: clamp(x), y: clamp(y)};
}

function layoutStickers() {
  const rects = stickerRects();
  for (const button of workspace.querySelectorAll('.placed-sticker')) {
    const sticker = visibleStickers().find(item => item.id === button.dataset.sticker);
    if (!sticker) continue;
    const host = stickerHost(sticker);
    if (button.parentElement !== host) host.append(button);
    positionSticker(button, sticker, rects);
  }
}

function updateSticker(sticker) {
  applyRevision(strokes, stickers.map(item => item.id === sticker.id ? sticker : item));
}

function placeSticker(event) {
  const kind = stickerChoice;
  stickerChoice = null;
  selectedSticker = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  applyRevision(strokes, [...stickers, {id: selectedSticker, kind, ...stickerPoint(event), size: stickerAssets[kind].paper ? 112 : 52, angle: 0}]);
  showToolPopup('sticker-edit');
  announce('Вклейка размещена.');
}

function syncStickerControls() {
  const selected = stickers.find(sticker => sticker.id === selectedSticker);
  if (!selected) byId('sticker-edit').hidden = true;
  if (selected) {
    stickerSize.value = selected.size;
    stickerAngle.value = selected.angle;
    byId('sticker-finish').value = stickerFinish(selected, stickerAssets[selected.kind]);
  }
  for (const [kind, button] of pickerButtons) button.setAttribute('aria-pressed', kind === stickerChoice);
  workspace.classList.toggle('placing-sticker', !archivedWork && tool === 'stickers' && !!stickerChoice);
  workspace.querySelectorAll('.placed-sticker').forEach(button => {
    button.setAttribute('aria-pressed', !archivedWork && button.dataset.sticker === selectedSticker);
  });
}

function attachStickerDrag(button, sticker) {
  let drag = null;
  button.onpointerdown = event => {
    if (event.button !== 0 || drag) return;
    selectedSticker = sticker.id;
    showToolPopup('sticker-edit');
    syncStickerControls();
    const rect = button.getBoundingClientRect();
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - (rect.left + rect.width / 2), offsetY: event.clientY - (rect.top + rect.height / 2)};
    button.setPointerCapture(event.pointerId);
  };
  const moved = event => Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3;
  const location = event => ({clientX: event.clientX - drag.offsetX, clientY: event.clientY - drag.offsetY});
  button.onpointermove = event => {
    if (drag?.id !== event.pointerId || !moved(event)) return;
    if (!byId('sticker-edit').hidden) showToolPopup(null);
    positionSticker(button, {...sticker, ...stickerPoint(location(event))});
  };
  button.onpointerup = event => {
    if (drag?.id !== event.pointerId) return;
    const point = location(event);
    const didMove = moved(event);
    drag = null;
    if (!didMove) return positionSticker(button, sticker);
    updateSticker({...sticker, ...stickerPoint(point)});
    showToolPopup('sticker-edit');
  };
  button.onpointercancel = button.onlostpointercapture = () => {
    if (!drag) return;
    drag = null;
    positionSticker(button, sticker);
  };
}

function renderStickers() {
  updateReferenceSpace();
  for (const layer of [stickerLayer, ...fieldStickerLayers]) layer.replaceChildren();
  for (const sticker of visibleStickers()) {
    const asset = stickerAssets[sticker.kind];
    if (!asset) continue;
    const button = document.createElement('button');
    button.className = 'placed-sticker';
    button.dataset.sticker = sticker.id;
    button.setAttribute('aria-label', asset.label);
    button.disabled = !!archivedWork || tool !== 'stickers';
    if (!asset.image.naturalWidth) asset.image.addEventListener('load', layoutStickers, {once: true});
    const preview = document.createElement('canvas');
    preview.setAttribute('aria-hidden', 'true');
    button.append(preview);
    if (!archivedWork) {
      button.onclick = () => { selectedSticker = sticker.id; showToolPopup('sticker-edit'); syncStickerControls(); };
      attachStickerDrag(button, sticker);
    }
    stickerHost(sticker).append(button);
  }
  layoutStickers();
  syncStickerControls();
}

byId('close-sticker-edit').onclick = () => showToolPopup(null);
byId('sticker-finish').onchange = event => {
  const sticker = stickers.find(item => item.id === selectedSticker);
  const finish = event.currentTarget.value;
  if (sticker && stickerFinishes.has(finish) && finish !== stickerFinish(sticker, stickerAssets[sticker.kind])) {
    updateSticker({...sticker, finish});
  }
};
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.tools, .placed-sticker')) showToolPopup(null);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || archiveDialog.open || archivedWork) return;
  stickerChoice = null;
  showToolPopup(null);
  syncStickerControls();
});

for (const [input, key] of [[stickerSize, 'size'], [stickerAngle, 'angle']]) {
  input.oninput = () => {
    const sticker = stickers.find(item => item.id === selectedSticker);
    const button = workspace.querySelector('.placed-sticker[aria-pressed="true"]');
    if (sticker && button) positionSticker(button, {...sticker, [key]: Number(input.value)});
  };
  input.onchange = () => {
    const sticker = stickers.find(item => item.id === selectedSticker);
    if (sticker && sticker[key] !== Number(input.value)) updateSticker({...sticker, [key]: Number(input.value)});
  };
}

byId('remove-sticker').onclick = () => {
  const id = selectedSticker;
  selectedSticker = null;
  applyRevision(strokes, stickers.filter(sticker => sticker.id !== id));
};

function archiveIdea(saved) {
  if (saved.parts) return saved;
  const idea = references[saved.idea];
  const art = references[saved.art];
  return {
    format: 'scene',
    legacy: {title: idea.title, prompt: idea.prompt},
    parts: {
      mood: {text: references[saved.mood].mood},
      palette: {text: 'Палитра из архива', colors: references[saved.palette].colors},
      art: {id: `legacy-${saved.art}`, text: art.title, legacyIndex: saved.art},
    },
  };
}

function updateArchiveCount() {
  byId('count').textContent = archive.length;
}

function commitArchive(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    announce('Не удалось обновить архив в браузере.');
    byId('archive-status').textContent = 'Не удалось обновить архив в браузере.';
    return false;
  }
  archive = next;
  updateArchiveCount();
  return true;
}

function ownFingerprint() { return JSON.stringify(strokes); }

function alreadyArchived() {
  return archive.some(entry => archiveIdea(entry.selection).parts.art?.id === selection.parts.art?.id &&
    JSON.stringify([entry.strokes ?? [], entry.notes ?? []]) === JSON.stringify([strokes, legacyNotes]));
}

function saveToArchive() {
  if (archivedWork || !selection.parts.art || selection.parts.art.own || byId('save').disabled) return false;
  const same = alreadyArchived();
  const entry = {selection, pins: legacyPins, strokes, notes: legacyNotes, date: Date.now()};
  if (!same && !commitArchive([entry, ...archive])) return false;
  announce(same ? 'Эта работа уже в архиве.' : 'Работа сохранена в архиве.');
  return true;
}

async function saveOwnWork() {
  const art = selection.parts.art;
  if (!art?.own || archivedWork || savingOwn || !referenceAvailable) return false;
  savingOwn = true;
  const snapshot = strokes;
  try {
    await saveOwnDrawing(art.id, snapshot);
    ownBaseline = JSON.stringify(snapshot);
    saveDrawingDraft();
    announce('Рисунок сохранён.');
    return true;
  } catch (error) {
    announce(ownError(error));
    return false;
  } finally { savingOwn = false; }
}

byId('save').onclick = () => selection.parts.art?.own ? saveOwnWork() : saveToArchive();

function archiveTitle(entry, saved) {
  return entry.name ?? (saved.parts.art?.own ? ownName(saved.parts.art.name) : saved.parts.art?.title) ?? saved.parts.art?.text ?? saved.legacy?.title ?? 'Работа без названия';
}

function editArchiveName(container, entry, title) {
  const form = document.createElement('form');
  form.className = 'archive-rename';
  const input = document.createElement('input');
  input.required = true;
  input.maxLength = 100;
  input.value = title;
  input.setAttribute('aria-label', 'Название работы');
  const save = document.createElement('button');
  save.textContent = 'Сохранить';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Отмена';
  cancel.onclick = renderArchive;
  input.oninput = () => input.setCustomValidity('');
  form.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); renderArchive(); }
  };
  form.onsubmit = event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || name.length > 100 || /[\p{Cc}]/u.test(name)) {
      input.setCustomValidity('Введите название длиной от 1 до 100 символов.');
      input.reportValidity();
      return;
    }
    if (commitArchive(archive.map(item => item === entry ? {...item, name} : item))) renderArchive();
  };
  form.append(input, save, cancel);
  container.replaceChildren(form);
  input.focus();
  input.select();
}

const deleteDialog = byId('confirm-delete');
let pendingDelete;
deleteDialog.addEventListener('close', () => {
  const entry = pendingDelete;
  pendingDelete = null;
  if (entry && deleteDialog.returnValue === 'delete' && commitArchive(archive.filter(item => item !== entry))) renderArchive();
});

function renderArchive() {
  const entries = byId('entries');
  entries.replaceChildren();
  if (!archive.length) entries.textContent = 'Здесь появятся сохранённые работы.';
  for (const entry of archive) {
    const row = document.createElement('div');
    row.className = 'entry';
    const info = document.createElement('div');
    const date = document.createElement('small');
    const saved = archiveIdea(entry.selection);
    const title = archiveTitle(entry, saved);
    info.textContent = title;
    date.textContent = new Date(entry.date).toLocaleDateString('ru-RU');
    info.append(date);
    const savedNotes = (entry.notes ?? []).filter(Boolean);
    if (savedNotes.length) {
      const details = document.createElement('details');
      const label = document.createElement('summary');
      label.textContent = 'Сохранённые заметки';
      details.append(label);
      for (const note of savedNotes) {
        const text = document.createElement('small');
        text.textContent = note;
        details.append(text);
      }
      info.append(details);
    }
    const controls = document.createElement('div');
    controls.className = 'archive-actions';
    const open = document.createElement('button');
    open.textContent = 'Открыть';
    open.onclick = () => {
      archivedWork = {selection: saved, strokes: entry.strokes ?? []};
      cancelAnimationFrame(drawerFrame);
      openDrawer = movingDrawer = -1;
      layoutDrawers();
      archiveDialog.close();
      refreshSpread();
      byId('back-to-archive').focus();
      announce('Просмотр архивной работы.');
    };
    const rename = document.createElement('button');
    rename.textContent = 'Переименовать';
    rename.onclick = () => editArchiveName(row, entry, title);
    const remove = document.createElement('button');
    remove.textContent = 'Удалить';
    remove.onclick = () => {
      pendingDelete = entry;
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    };
    controls.append(open, rename, remove);
    row.append(info, controls);
    entries.append(row);
  }
}

function refreshSpread() {
  showToolPopup(null);
  refreshMode();
  renderIdea();
  renderDrawing();
  renderStickers();
}

function showArchive() {
  if (turning) return;
  active = null;
  if (archivedWork) {
    archivedWork = null;
    cancelAnimationFrame(drawerFrame);
    openDrawer = mobileSpread.matches ? workDrawerBeforeArchive : -1;
    movingDrawer = -1;
    layoutDrawers();
    refreshSpread();
    announce('');
  } else {
    workDrawerBeforeArchive = openDrawer;
    saveDrawingDraft();
    renderDrawing();
  }
  byId('archive-status').textContent = '';
  renderArchive();
  archiveDialog.showModal();
}

byId('show-archive').onclick = async () => {
  if (selection.parts.art?.own && !archivedWork && !await switchOwnReference(null)) return;
  showArchive();
};
byId('back-to-archive').onclick = showArchive;

function askOwnAction(id) {
  const dialog = byId(id);
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), {once: true});
    dialog.showModal();
  });
}

async function canLeaveOwn() {
  if (!selection.parts.art?.own || ownBaseline === ownFingerprint()) return true;
  const action = await askOwnAction('confirm-own-exit');
  return action === 'discard' || (action === 'save' && await saveOwnWork());
}

function usedByArchive(id) {
  let saved = archive;
  try { saved = JSON.parse(localStorage.getItem(storageKey)) ?? archive; } catch { /* Keep the in-memory archive. */ }
  return saved.some(entry => archiveIdea(entry.selection).parts.art?.id === id);
}

async function switchOwnReference(record) {
  if (ownTransition || turning || archivedWork || active || savingOwn) return false;
  if (record && record.id === selection.parts.art?.id) {
    if (ownDialog.open) ownDialog.close();
    return true;
  }
  ownTransition = true;
  try {
    let savedDrawing;
    if (record) {
      await decodedReference({id: record.id, own: true});
      savedDrawing = await ownDrawing(record.id);
    }
    if (!await canLeaveOwn()) return false;
    await storedStickersReady;
    if (record) {
      if (!builtInDraft) {
        builtInDraft = {selection, strokes, legacyNotes, legacyPins};
        builtInHistory = {undoStack, redoStack, stickers};
      }
      selection = {parts: {art: {id: record.id, name: ownName(record.name), own: true}}};
      // Previous versions stored these drawings as archive entries. Keep the originals.
      const oldEntry = archive.find(entry => archiveIdea(entry.selection).parts.art?.id === record.id);
      strokes = savedDrawing?.strokes ?? oldEntry?.strokes ?? [];
      legacyNotes = legacyPins = [];
      undoStack = [];
      redoStack = [];
      ownBaseline = ownFingerprint();
    } else if (builtInDraft) {
      ({selection, strokes, legacyNotes, legacyPins} = builtInDraft);
      const restore = revisions => (revisions ?? []).map(revision => builtInHistory.stickers === stickers
        ? revision : {strokes: revision.strokes, stickers});
      undoStack = restore(builtInHistory?.undoStack);
      redoStack = restore(builtInHistory?.redoStack);
      builtInDraft = builtInHistory = null;
    } else {
      selection = {parts: {art: referenceDeck.peek(referenceCatalog)}};
      if (selection.parts.art) referenceDeck.advance(selection.parts.art.id);
      strokes = [];
      undoStack = redoStack = [];
    }
    cancelAnimationFrame(drawerFrame);
    openDrawer = movingDrawer = -1;
    stickerChoice = selectedSticker = null;
    layoutDrawers();
    if (ownDialog.open) ownDialog.close();
    refreshSpread();
    updateHistory();
    saveDrawingDraft();
    return true;
  } catch (error) {
    const message = ownError(error);
    if (ownDialog.open) byId('own-status').textContent = message;
    else announce(message);
    return false;
  } finally { ownTransition = false; }
}

function ownError(error) {
  return error?.name === 'QuotaExceededError' ? 'В браузере недостаточно места для изображения.'
    : error?.message || 'Хранилище изображений недоступно.';
}

async function askOwnName(record, rename = false) {
  const heading = byId('own-name-heading');
  const input = byId('own-name-input');
  const preview = byId('own-name-preview');
  heading.textContent = rename ? 'Переименовать изображение' : 'Название изображения';
  byId('own-name-submit').textContent = rename ? 'Сохранить' : 'Добавить';
  input.value = rename ? record.name ?? '' : '';
  const url = URL.createObjectURL(record.thumbnail);
  preview.src = url;
  preview.hidden = false;
  try {
    const answer = await askOwnAction('own-name-dialog');
    return answer === 'accept' ? ownName(input.value) : null;
  } finally {
    preview.removeAttribute('src');
    preview.hidden = true;
    URL.revokeObjectURL(url);
  }
}

let galleryUrls = [];
function clearOwnGallery() {
  for (const url of galleryUrls) URL.revokeObjectURL(url);
  galleryUrls = [];
  byId('own-grid').replaceChildren();
}

async function renderOwnGallery() {
  const records = (await ownReferences()).filter(record => !record.hidden).sort((a, b) => b.date - a.date);
  if (!ownDialog.open) return;
  clearOwnGallery();
  const grid = byId('own-grid');
  if (!records.length) grid.textContent = 'Здесь появятся ваши изображения.';
  for (const record of records) {
    const entry = document.createElement('div');
    entry.className = 'own-entry';
    const title = ownName(record.name);
    const thumbnail = document.createElement('button');
    thumbnail.className = 'own-thumbnail';
    thumbnail.setAttribute('aria-label', 'Открыть: ' + title);
    thumbnail.onclick = () => switchOwnReference(record);
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.src = URL.createObjectURL(record.thumbnail);
    galleryUrls.push(img.src);
    thumbnail.append(img);
    const label = document.createElement('div');
    label.className = 'own-title';
    label.textContent = title;
    label.title = title;
    const actions = document.createElement('div');
    actions.className = 'own-actions';
    const open = document.createElement('button');
    open.textContent = 'Открыть';
    open.onclick = thumbnail.onclick;
    const rename = document.createElement('button');
    rename.textContent = 'Переименовать';
    rename.onclick = async () => {
      const name = await askOwnName(record, true);
      if (name === null) return;
      try {
        await renameOwnReference(record.id, name);
        await renderOwnGallery();
      } catch (error) { byId('own-status').textContent = ownError(error); }
    };
    const remove = document.createElement('button');
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', 'Удалить: ' + title);
    remove.onclick = async () => {
      if (await askOwnAction('confirm-own-delete') !== 'delete') return;
      try {
        await deleteOwnReference(record, usedByArchive(record.id) || selection.parts.art?.id === record.id);
        artImages.delete(record.id);
        await renderOwnGallery();
      } catch (error) { byId('own-status').textContent = ownError(error); }
    };
    actions.append(open, rename, remove);
    entry.append(thumbnail, label, actions);
    grid.append(entry);
  }
}

byId('show-own').onclick = async () => {
  if (archivedWork || turning || ownTransition || active || ownDialog.open) return;
  if (selection.parts.art?.own && !await switchOwnReference(null)) return;
  byId('own-status').textContent = '';
  ownDialog.showModal();
  renderOwnGallery().catch(error => { byId('own-status').textContent = ownError(error); });
};
byId('close-own').onclick = () => ownDialog.close();
ownDialog.addEventListener('close', () => { if (!ownDialog.open) clearOwnGallery(); });
byId('leave-own').onclick = () => switchOwnReference(null);
byId('add-own').onclick = () => byId('own-files').click();
byId('own-files').onchange = async event => {
  const input = event.target;
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const status = byId('own-status');
  byId('add-own').disabled = true;
  status.textContent = 'Добавляем изображения…';
  let count = 0;
  const errors = [];
  try {
    for (const [index, file] of files.entries()) {
      if (!ownDialog.open) break;
      try {
        const record = await prepareOwnReference(file);
        if (!ownDialog.open) break;
        const name = await askOwnName(record);
        if (name === null) continue;
        await storeOwnReference({...record, name});
        count++;
      } catch (error) { errors.push('Изображение ' + (index + 1) + ' — ' + ownError(error)); }
    }
    await renderOwnGallery();
    status.textContent = [count ? 'Добавлено: ' + count + '.' : '', ...errors].filter(Boolean).join(' ');
  } catch (error) { status.textContent = ownError(error); }
  finally { byId('add-own').disabled = false; }
};

byId('close-archive').onclick = () => archiveDialog.close();
for (const id of ['ink', 'width']) byId(id).addEventListener('change', saveDrawingDraft);

function paintTurnSnapshot(ctx, base) {
  if (!mobileSpread.matches) {
    for (const margin of anchors.slice(1)) {
      const box = margin.getBoundingClientRect();
      const edge = parseFloat(getComputedStyle(margin).paddingLeft);
      const x = box.left - base.left + edge;
      const y = box.top - base.top + 40;
      const width = box.width - 2 * edge;
      const height = box.height - 64;
      ctx.fillStyle = '#efd1af2e';
      for (let row = 27; row < height; row += 28) ctx.fillRect(x, y + row, width, 1);
      ctx.fillStyle = '#e07d6a80';
      ctx.fillRect(x + width * (margin.classList.contains('right') ? .79 : .21), y, 1, height);
    }
  }
  for (const label of document.querySelectorAll('.identity strong, .identity span, .book-actions button, .tool-row button, .actions button, .drawer-tab, .folio, .sheet-date')) {
    const box = label.getBoundingClientRect();
    const style = getComputedStyle(label);
    if (!box.width || style.visibility === 'hidden') continue;
    const button = label.tagName === 'BUTTON';
    const x = box.left - base.left;
    const y = box.top - base.top;
    ctx.save();
    ctx.translate(x, y);
    if (button) {
      ctx.beginPath();
      ctx.roundRect(.5, .5, box.width - 1, box.height - 1, parseFloat(style.borderTopLeftRadius) || 0);
      ctx.fillStyle = style.backgroundColor;
      ctx.fill();
      ctx.strokeStyle = style.borderTopColor;
      ctx.stroke();
    }
    ctx.fillStyle = style.color;
    const icon = label.querySelector('svg');
    if (icon) {
      const size = icon.getBoundingClientRect().width;
      ctx.translate((box.width - size) / 2, (box.height - size) / 2);
      ctx.scale(size / 24, size / 24);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1.6;
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const path of icon.querySelectorAll('path')) ctx.stroke(new Path2D(path.getAttribute('d')));
    } else {
      ctx.font = [style.fontWeight, style.fontSize, style.fontFamily].join(' ');
      ctx.textAlign = button ? 'center' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.textContent, button ? box.width / 2 : 0, box.height / 2);
    }
    ctx.restore();
  }
  paintSpread(ctx, base);
}

function paintSpread(ctx, base) {
  const rect = reference.getBoundingClientRect();
  if (rect.width && rect.height && !reference.parentElement.classList.contains('reference-empty')) {
    ctx.fillStyle = '#ead5b4';
    ctx.fillRect(rect.left - base.left - 4, rect.top - base.top - 4, rect.width + 8, rect.height + 8);
    ctx.drawImage(reference, rect.left - base.left, rect.top - base.top, rect.width, rect.height);
  }
  for (const [index, color] of currentColors.entries()) {
    const box = byId('palette').children[index].getBoundingClientRect();
    if (!box.width || box.top < base.top) continue;
    ctx.fillStyle = color;
    ctx.fillRect(box.left - base.left, box.top - base.top, box.width, box.height);
  }
  const drawingBox = drawing.getBoundingClientRect();
  if (drawingBox.width && drawingBox.height) {
    ctx.drawImage(drawing, drawingBox.left - base.left, drawingBox.top - base.top, drawingBox.width, drawingBox.height);
  }
  for (const button of workspace.querySelectorAll('.placed-sticker')) {
    if (button.hidden || getComputedStyle(button).visibility === 'hidden') continue;
    const sticker = stickers.find(item => item.id === button.dataset.sticker);
    const box = button.getBoundingClientRect();
    const preview = button.firstElementChild;
    const width = parseFloat(preview.style.width);
    const height = parseFloat(preview.style.height);
    ctx.save();
    ctx.translate(box.left + box.width / 2 - base.left, box.top + box.height / 2 - base.top);
    ctx.rotate(sticker.angle * Math.PI / 180);
    ctx.drawImage(preview, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
}

byId('export').onclick = async () => {
  if (archivedWork) return;
  await storedStickersReady;
  await referenceReady;
  try {
    await Promise.all([...new Set(stickers.map(sticker => sticker.kind))].map(kind => stickerAssets[kind].image.decode()));
  } catch {
    return announce('Не удалось загрузить вклейки для PNG.');
  }
  const canvas = document.createElement('canvas');
  byId('desktop-palette').append(byId('palette'));
  workspace.classList.add('exporting');
  try {
    renderDrawing();
    layoutStickers();
    const base = drawing.getBoundingClientRect();
    canvas.width = Math.ceil(base.width * 2);
    canvas.height = Math.ceil(base.height * 2);
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = '#151413';
    ctx.fillRect(0, 0, base.width, base.height);
    paintSpread(ctx, base);
  } finally {
    workspace.classList.remove('exporting');
    layoutDrawers();
    renderDrawing();
    layoutStickers();
  }
  canvas.toBlob(blob => {
    if (!blob) return announce('Не удалось создать PNG.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'polya.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    announce('Композиция подготовлена к скачиванию.');
  }, 'image/png');
};

refreshMode();
layoutDrawers();
renderIdea();
updateHistory();
updateArchiveCount();
syncStickerControls();
const sheetDate = new Date();
byId('sheet-date').textContent = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short'}).format(sheetDate);
const sheetSeal = stickerAssets.seal.image.cloneNode();
sheetSeal.className = 'sheet-seal';
sheetSeal.alt = '';
byId('right-margin').append(sheetSeal);
const workspaceObserver = new ResizeObserver(() => {
  renderDrawing();
  layoutStickers();
});
for (const element of [workspace, ...anchors, composition]) workspaceObserver.observe(element);
setupBookCover({
  blocked: () => turning || ownTransition || savingOwn || !!archivedWork || archiveDialog.open,
  beforeClose: () => !selection.parts.art?.own || switchOwnReference(null),
  save: () => { active = null; saveDrawingDraft(); },
  reducedMotion: reduceMotion,
  opened: repaintSpread,
});
