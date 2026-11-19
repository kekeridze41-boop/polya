const stickerFinishes = new Set(['plain', 'photo', 'fold', 'torn', 'tape']);

function stickerFinish(sticker, asset) {
  return stickerFinishes.has(sticker.finish) ? sticker.finish : asset?.paper ? 'photo' : 'plain';
}

function tornPaper(ctx, width, height, edge) {
  const corners = [[-edge, -edge], [width + edge, -edge], [width + edge, height + edge], [-edge, height + edge]];
  ctx.beginPath();
  ctx.moveTo(...corners[0]);
  corners.forEach(([x, y], side) => {
    const [endX, endY] = corners[(side + 1) % corners.length];
    const count = Math.max(3, Math.ceil(Math.hypot(endX - x, endY - y) / 4));
    const nx = Math.sign(endY - y);
    const ny = -Math.sign(endX - x);
    let previous = [x, y];
    for (let i = 1; i < count; i++) {
      const t = (i + .24 * Math.sin(i * 2.74 + side)) / count;
      const offset = edge * (.23 * Math.sin(i * 2.22 + side * 7.2) + .17 * Math.sin(i * .91 + side));
      const next = [x + (endX - x) * t + nx * offset, y + (endY - y) * t + ny * offset];
      ctx.quadraticCurveTo(...previous, (previous[0] + next[0]) / 2, (previous[1] + next[1]) / 2);
      previous = next;
    }
    ctx.quadraticCurveTo(...previous, endX, endY);
  });
  ctx.closePath();
}

function paintTape(ctx, x, y, length, depth, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-length / 2, -depth / 2);
  ctx.lineTo(length / 2, -depth * .45);
  ctx.lineTo(length / 2 - 1.5, -depth * .16);
  ctx.lineTo(length / 2 + .5, depth * .09);
  ctx.lineTo(length / 2 - .7, depth / 2);
  ctx.lineTo(-length / 2, depth * .48);
  ctx.lineTo(-length / 2 + 1.1, depth * .14);
  ctx.lineTo(-length / 2 - .7, -depth * .12);
  ctx.closePath();
  ctx.fillStyle = '#e8c68b8a';
  ctx.fill();
  ctx.strokeStyle = '#fff0be46';
  ctx.lineWidth = .45;
  ctx.stroke();
  ctx.restore();
}

// The export composites this same transparent canvas, including its outer padding.
function paintStickerFinish(canvas, image, width, height, finish) {
  const padding = finish === 'plain' ? 0 : Math.ceil(Math.max(10, Math.min(30, Math.max(width, height) * .22)));
  const outerWidth = width + padding * 2;
  const outerHeight = height + padding * 2;
  const key = `${width}:${height}:${finish}`;
  const bounds = {width: outerWidth, height: outerHeight};
  if (canvas.dataset.paint === key) return bounds;
  canvas.width = Math.ceil(outerWidth * 2);
  canvas.height = Math.ceil(outerHeight * 2);
  canvas.style.width = `${outerWidth}px`;
  canvas.style.height = `${outerHeight}px`;
  if (!image.naturalWidth) return bounds;

  canvas.dataset.paint = key;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / outerWidth, 0, 0, canvas.height / outerHeight, 0, 0);
  ctx.translate(padding, padding);
  const shortSide = Math.min(width, height);
  const edge = Math.max(1, Math.min(6, shortSide * .065));

  if (finish === 'photo' || finish === 'torn') {
    ctx.save();
    ctx.fillStyle = '#ecdbc1';
    ctx.shadowColor = '#23150d85';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;
    if (finish === 'photo') ctx.fillRect(-edge, -edge, width + edge * 2, height + edge * 3.15);
    else {
      tornPaper(ctx, width, height, edge * 1.35);
      ctx.fill();
    }
    ctx.restore();
  }

  if (finish === 'fold') {
    const fold = Math.min(14, shortSide * .24);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width - fold, 0);
    ctx.quadraticCurveTo(width - fold * .54, fold * .5, width, fold * .9);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();

    const back = ctx.createLinearGradient(width - fold, 0, width, fold);
    back.addColorStop(0, '#a17a53');
    back.addColorStop(.46, '#f0d8b3');
    back.addColorStop(1, '#b79268');
    ctx.fillStyle = back;
    ctx.shadowColor = '#1e110c99';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.moveTo(width - fold, 0);
    ctx.quadraticCurveTo(width - fold * .92, fold * .55, width - fold * .83, fold * .87);
    ctx.quadraticCurveTo(width - fold * .4, fold * .73, width, fold * .9);
    ctx.quadraticCurveTo(width - fold * .61, fold * .35, width - fold, 0);
    ctx.fill();
    return bounds;
  }

  ctx.drawImage(image, 0, 0, width, height);
  if (finish === 'tape') {
    const length = Math.min(29, width * .48);
    const depth = Math.min(9, shortSide * .21);
    paintTape(ctx, width * .23, edge * .15, length, depth, -.22);
    if (width >= 48 && height >= 28) paintTape(ctx, width * .82, height - edge * .26, length * .76, depth, -.35);
  }
  return bounds;
}
