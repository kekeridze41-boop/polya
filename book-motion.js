function bindHorizontalPull(handle, handlers) {
  let gesture = null;
  let suppressClick = false;
  handle.onpointerdown = event => {
    if (event.button !== 0 || gesture || handlers.blocked?.()) return;
    suppressClick = false;
    gesture = {id: event.pointerId, x: event.clientX, moved: false};
    handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    if (Math.abs(dx) < 5 && !gesture.moved) return;
    gesture.moved = true;
    handlers.move(dx);
  };
  handle.onpointerup = event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    suppressClick = gesture.moved;
    gesture = null;
    if (suppressClick) handlers.release(dx);
  };
  handle.onpointercancel = handle.onlostpointercapture = event => {
    if (gesture?.id !== event.pointerId) return;
    const moved = gesture.moved;
    gesture = null;
    if (moved) handlers.release(0);
  };
  handle.onclick = event => {
    if (suppressClick && event.detail) { suppressClick = false; return; }
    if (!handlers.blocked?.()) handlers.tap();
  };
}

function setupBookCover({blocked, save, reducedMotion, opened}) {
  const key = 'polya.cover-opened.v1';
  const cover = document.getElementById('cover-stage');
  const notebook = document.querySelector('.notebook');
  const strap = document.getElementById('cover-strap');
  const close = document.getElementById('close-book');
  let busy = false;
  let seen = false;
  try { seen = localStorage.getItem(key) === '1'; } catch { /* The cover still opens without storage. */ }

  const setClosed = (closed, focus = false) => {
    cover.hidden = !closed;
    notebook.inert = closed;
    document.body.classList.toggle('book-closed', closed);
    if (closed && focus) strap.focus();
  };

  async function open() {
    if (busy || cover.hidden) return;
    busy = true;
    cover.classList.remove('pulling');
    cover.classList.add('opening');
    if (!reducedMotion.matches) await new Promise(resolve => setTimeout(resolve, 840));
    cover.classList.remove('opening');
    strap.style.removeProperty('--strap-offset');
    setClosed(false);
    try { localStorage.setItem(key, '1'); } catch { /* Opening is still usable. */ }
    opened();
    close.focus();
    busy = false;
  }

  bindHorizontalPull(strap, {
    blocked: () => busy,
    move(dx) {
      cover.classList.add('pulling');
      strap.style.setProperty('--strap-offset', `${Math.max(0, Math.min(140, dx))}px`);
    },
    release(dx) {
      cover.classList.remove('pulling');
      if (dx >= 58) open();
      else strap.style.removeProperty('--strap-offset');
    },
    tap: open,
  });
  close.onclick = () => {
    if (busy || blocked()) return;
    save();
    setClosed(true, true);
  };
  setClosed(!seen);
}

function beginPaperTurn(notebook, paint, singlePage) {
  const layer = document.createElement('div');
  layer.className = 'turn-sheet';
  layer.classList.toggle('single-page-turn', singlePage);
  layer.setAttribute('aria-hidden', 'true');
  const leaf = document.createElement('div');
  leaf.className = 'turn-leaf';

  // Use the notebook's padding box: the border and stack of leaves stay in place.
  const outer = notebook.getBoundingClientRect();
  const bounds = {
    left: outer.left + notebook.clientLeft, top: outer.top + notebook.clientTop,
    width: notebook.clientWidth, height: notebook.clientHeight,
  };
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const snapshot = document.createElement('canvas');
  snapshot.width = Math.max(1, Math.round(bounds.width * scale));
  snapshot.height = Math.max(1, Math.round(bounds.height * scale));
  const ctx = snapshot.getContext('2d');
  ctx.setTransform(snapshot.width / bounds.width, 0, 0, snapshot.height / bounds.height, 0, 0);
  paint(ctx, bounds);

  function face(name, side) {
    const element = document.createElement('div');
    element.className = name;
    if (side === undefined) return element;
    const image = document.createElement('canvas');
    const split = singlePage ? 0 : Math.floor(snapshot.width / 2);
    const x = side === 'right' ? split : 0;
    image.width = side === 'right' ? snapshot.width - split : split;
    image.height = snapshot.height;
    image.getContext('2d').drawImage(snapshot, x, 0, image.width, image.height, 0, 0, image.width, image.height);
    element.append(image);
    return element;
  }

  const oldLeft = singlePage ? null : face('turn-old-left', 'left');
  if (oldLeft) layer.append(oldLeft);
  leaf.append(face('turn-front', 'right'), face('turn-back'));
  layer.append(leaf);
  notebook.append(layer);

  async function play() {
    layer.classList.add('turn-running');
    const animation = leaf.getAnimations()[0];
    if (!animation) return;
    let frame;
    if (oldLeft) {
      const midpoint = animation.effect.getTiming().duration / 2;
      const reveal = () => {
        if (animation.currentTime >= midpoint) oldLeft.remove();
        else frame = requestAnimationFrame(reveal);
      };
      frame = requestAnimationFrame(reveal);
    }
    try { await animation.finished; }
    catch { /* A viewport or motion preference change can cancel the transition. */ }
    finally { cancelAnimationFrame(frame); }
  }

  return {play, remove: () => layer.remove()};
}
