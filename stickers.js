// Local SVG artwork. Data URLs also keep PNG export usable from file://.
const stickerCatalog = Object.entries({
  fern: ['Папоротник', `<g fill="none" stroke="#c5cf9e" stroke-width="3" stroke-linecap="round"><path d="M16 58Q42 42 49 7M25 51Q26 35 14 30M29 47Q46 50 54 41M34 42Q35 28 25 22M39 35Q53 34 57 25M43 28Q44 17 37 14M47 19Q55 17 57 12"/></g>`],
  poppy: ['Мак', `<path d="M24 58Q39 42 33 24M32 47q-9-8-16-5 4 9 14 9" fill="none" stroke="#c0c497" stroke-width="3"/><path d="M17 24Q10 10 24 11Q32 1 40 11Q54 9 51 22Q49 36 33 31Q23 37 17 24" fill="#cc7866" stroke="#f3b6a0" stroke-width="2"/><circle cx="33" cy="22" r="5" fill="#51362d"/>`],
  sprig: ['Веточка с ягодами', `<g stroke="#d3c096" stroke-width="2" fill="none"><path d="M22 58Q42 34 34 9M34 40L16 27M36 30l15-10M36 22L24 13"/><path fill="#a4a779" d="M31 49Q49 43 50 33Q37 33 31 49M34 34Q14 38 10 29Q24 23 34 34"/></g><g fill="#d78370"><circle cx="34" cy="9" r="5"/><circle cx="52" cy="19" r="5"/><circle cx="23" cy="12" r="4"/></g>`],
  moonStamp: ['Марка с луной', `<path d="M10 8h44v48H10z" fill="#e8d1a6" stroke="#f4e2c0" stroke-width="6" stroke-dasharray="2 3"/><path d="M15 13h34v38H15z" fill="#65546b"/><path d="M37 20a13 13 0 1 0 5 21 12 12 0 0 1-5-21" fill="#efd2a3"/><path d="m42 23 1 2 3 1-3 1-1 2-1-2-2-1 2-1z" fill="#efd2a3"/>`],
  hillStamp: ['Марка с горами', `<path d="M8 12h48v40H8z" fill="#ddc09a" stroke="#ead8b6" stroke-width="6" stroke-dasharray="2 3"/><path d="M13 17h38v30H13z" fill="#758171"/><circle cx="39" cy="26" r="5" fill="#f5ce94"/><path d="m14 45 13-18 9 12 5-5 10 11" fill="#414d48"/><path d="m23 32 4-5 4 5-4-2z" fill="#d1c7ab"/>`],
  seal: ['Архивная печать', `<g fill="none" stroke="#e4917e" stroke-width="2"><circle cx="32" cy="32" r="23"/><circle cx="32" cy="32" r="18" stroke-dasharray="2 2"/><path d="M32 18l3 10 10 4-10 3-3 11-4-11-10-3 10-4z"/></g>`],
  plainTape: ['Бумажный скотч', `<path d="m5 22 54-8-3 5 4 4-3 5 4 4-55 9 2-5-4-4 4-5z" fill="#e1bc86" opacity=".86"/><path d="m8 26 46-7M10 34l45-7" stroke="#9d714a" stroke-opacity=".45"/>`],
  stripedTape: ['Полосатый скотч', `<path d="m7 21 49 2 4 3-3 4 3 5-4 5-49-3-3-4 3-4-3-5z" fill="#bd796e" opacity=".9"/><path d="m12 36 9-14m1 15 9-15m1 15 9-14m1 15 9-15m1 15 7-11" stroke="#edc0a5" stroke-width="2" opacity=".65"/>`],
  stars: ['Нарисованные звёзды', `<g fill="none" stroke="#efd3a0" stroke-width="2.5" stroke-linejoin="round"><path d="M25 9l4 15 15 4-15 4-4 15-4-15-15-4 15-4zM48 39l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/><path d="M48 12v9m-5-4h10"/></g>`],
  orbit: ['Орбита', `<g fill="none" stroke="#c6c1de" stroke-width="2.5"><circle cx="31" cy="31" r="15"/><ellipse cx="31" cy="31" rx="28" ry="8" transform="rotate(-28 31 31)"/><path d="M47 10v8m-4-4h8"/></g><circle cx="15" cy="50" r="3" fill="#e7b390"/>`],
}).map(([id, [label, art]]) => {
  const image = new Image();
  image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${art}</svg>`)}`;
  return [id, {label, image}];
});
const stickerAssets = Object.fromEntries(stickerCatalog);
