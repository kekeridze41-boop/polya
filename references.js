// Original procedural illustrations. Each seed renders the same local reference.
const references = [
  { title: 'Сад под красной луной', prompt: 'Нарисуйте сад, в котором луна освещает только одну тропу. Что останется в тени?', mood: 'Тихое предчувствие', colors: ['#25292b','#433c43','#8b534b','#c2775e','#e7b28c'], sky: ['#272533','#a55f54'], sun: '#e39a7c', hills: ['#735457','#51474e','#36383d','#263432','#182321'], seed: 42 },
  { title: 'Утро в апельсиновой роще', prompt: 'Представьте, что тепло пахнет апельсиновой кожурой. Передайте этот запах цветом.', mood: 'Солнечное спокойствие', colors: ['#364c42','#647c54','#e6924f','#e8b86e','#f3d8a9'], sky: ['#858b8c','#efb974'], sun: '#ffe3a0', hills: ['#b38159','#9b8059','#6d7952','#4b664d','#304a3d'], seed: 78 },
  { title: 'Там, где туман спит', prompt: 'Оставьте в пейзаже один след присутствия человека. Пусть он будет почти незаметен.', mood: 'Меланхолия', colors: ['#243b46','#50616a','#7c8592','#a6a7b0','#d5c7bc'], sky: ['#566981','#aab4ba'], sun: '#e6d3ca', hills: ['#939fa9','#7f8d9e','#667a87','#49606b','#304750'], seed: 590 },
  { title: 'Планета забытых будильников', prompt: 'Изобразите планету, где солнце восходит каждый раз, когда кто-нибудь нажимает «ещё пять минут».', mood: 'Весёлый абсурд', colors: ['#442745','#824a74','#c26081','#e08873','#ffd16d'], sky: ['#703765','#eb817f'], sun: '#ffce66', hills: ['#de7097','#b55786','#924871','#653858','#4c2949'], seed: 16 },
  { title: 'Острова над облаками', prompt: 'Нарисуйте дорогу к острову, который можно увидеть только с высоты птичьего полёта.', mood: 'Сказочное изумление', colors: ['#253254','#3c5678','#658c9e','#99c1ba','#d9e4c1'], sky: ['#4c5f91','#9fc5bf'], sun: '#edebb9', hills: ['#95abae','#779ba9','#577b94','#3b5a7b','#283f63'], seed: 310 }
];

function paintReference(canvas, art) {
  const ctx = canvas.getContext('2d');
  const {width, height} = canvas;
  let seed = art.seed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, art.sky[0]);
  gradient.addColorStop(1, art.sky[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const sunX = width * (.45 + random() * .21);
  const sunY = height * .36;
  const radius = height * .145;
  const halo = ctx.createRadialGradient(sunX, sunY, radius * .65, sunX, sunY, radius * 2.6);
  halo.addColorStop(0, art.sun + '55');
  halo.addColorStop(1, art.sun + '00');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = art.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, radius, 0, 2 * Math.PI);
  ctx.fill();

  for (let i = 0; i < 1050; i++) {
    const x = random() * width;
    const y = random() * height * .62;
    ctx.fillStyle = i % 2 ? '#f8dec00b' : '#2b253014';
    ctx.fillRect(x, y, 4 + random() * 42, 1 + random() * 3);
  }

  for (const [layer, color] of art.hills.entries()) {
    const phase = random() * 5;
    const ridge = x => {
      const t = x / width;
      return height * (.56 + layer * .075 + Math.sin(t * 8 + phase) * .076 +
        Math.sin(t * 22 + phase) * .021 + Math.sin(t * 75) * .006);
    };
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 2) ctx.lineTo(x, ridge(x));
    ctx.lineTo(width, height);
    ctx.fill();
    for (let i = 0; i < 260; i++) {
      const x = random() * width;
      const y = ridge(x) + random() * height * .15;
      const size = (6 + random() * 28) * (layer + 2) / 5;
      ctx.fillStyle = i % 5 ? color : '#17171b30';
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x - size * .25, y + 2);
      ctx.lineTo(x + size * .25, y + 2);
      ctx.fill();
    }
  }

  if (art.seed === 78) {
    for (const x of [95, 220, 760, 855]) {
      const y = 385 + random() * 74;
      ctx.fillStyle = '#423a32';
      ctx.fillRect(x - 4, y, 8, 68);
      for (let i = 0; i < 48; i++) {
        const angle = random() * Math.PI * 2;
        const distance = random() * 60;
        ctx.fillStyle = i % 5 === 0 ? '#de934c' : i % 2 ? '#577356' : '#405a49';
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, i % 5 ? 13 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (art.seed === 16) {
    ctx.strokeStyle = '#653858';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sunX, sunY - radius * .65);
    ctx.lineTo(sunX, sunY);
    ctx.lineTo(sunX + radius * .38, sunY + radius * .26);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      ctx.fillStyle = '#653858';
      ctx.beginPath();
      ctx.arc(sunX + Math.cos(angle) * radius * .81, sunY + Math.sin(angle) * radius * .81, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (art.seed === 310) {
    for (const [x, y, size] of [[177, 162, 80], [420, 245, 127], [765, 210, 92]]) {
      ctx.fillStyle = '#3b526d';
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x + size * .45, y + size * .27);
      ctx.lineTo(x - size * .22, y + size * .67);
      ctx.lineTo(x - size * .65, y + size * .28);
      ctx.fill();
      ctx.fillStyle = '#76998e';
      ctx.beginPath();
      ctx.ellipse(x, y, size, size * .11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const grain = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < grain.data.length; i += 4) {
    const shade = (random() - .52) * 26;
    grain.data[i] += shade;
    grain.data[i + 1] += shade;
    grain.data[i + 2] += shade;
  }
  ctx.putImageData(grain, 0, 0);
}
