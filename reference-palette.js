function characteristicColors(pixels, limit = 5) {
  const buckets = new Map();
  let total = 0;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const cell = rgb.map(value => value >> 5).join(',');
    const bucket = buckets.get(cell) ?? {count: 0, sum: [0, 0, 0]};
    bucket.count++;
    rgb.forEach((value, channel) => { bucket.sum[channel] += value; });
    buckets.set(cell, bucket);
    total++;
  }
  const candidates = [...buckets.values()].map(({count, sum}) => ({count, rgb: sum.map(value => Math.round(value / count))}));
  candidates.sort((a, b) => b.count - a.count);
  if (!candidates.length) return [];
  for (const candidate of candidates) {
    candidate.support = candidates.reduce((sum, neighbor) => sum + (distance(candidate.rgb, neighbor.rgb) < 36 ? neighbor.count : 0), 0);
  }
  const picked = [candidates.shift().rgb];
  while (picked.length < limit) {
    let best = null;
    let score = 0;
    for (const candidate of candidates) {
      const separation = Math.min(...picked.map(color => distance(candidate.rgb, color)));
      const {support} = candidate;
      if (separation < 44 || support < total * .009) continue;
      const chroma = Math.max(...candidate.rgb) - Math.min(...candidate.rgb);
      const priority = Math.sqrt(support) * Math.min(separation, 150) * (1 + chroma / 180);
      if (priority > score) { best = candidate; score = priority; }
    }
    if (!best) break;
    picked.push(best.rgb);
  }
  return picked.map(rgb => `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`);
}

function paletteFromReference(source) {
  const sample = document.createElement('canvas');
  const width = source.naturalWidth ?? source.width;
  const height = source.naturalHeight ?? source.height;
  const scale = 64 / Math.max(width, height);
  sample.width = Math.max(1, Math.round(width * scale));
  sample.height = Math.max(1, Math.round(height * scale));
  const ctx = sample.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(source, 0, 0, sample.width, sample.height);
  return characteristicColors(ctx.getImageData(0, 0, sample.width, sample.height).data);
}
