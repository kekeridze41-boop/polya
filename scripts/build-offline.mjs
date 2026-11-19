import {readFile, writeFile} from 'node:fs/promises';

const data = new URL('../data/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(`${name}.json`, data), 'utf8'));
const fields = ['subject', 'place', 'mood', 'detail', 'technique', 'palette'];
const library = Object.fromEntries(await Promise.all(fields.map(async field => [field, await read(field)])));
const legacy = await read('art');
const catalog = await read('reference-catalog');
const byId = new Map(catalog.map(item => [item.id, item]));
const imported = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : [];
if (!Array.isArray(imported)) throw Error('Файл импорта должен содержать массив объектов.');
const formats = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml'};
const requiredText = value => typeof value === 'string' && value.trim().length > 0;
const requiredList = value => Array.isArray(value) && value.length > 0 && value.every(requiredText);
const importedIds = new Set();
for (const item of imported) {
  if (importedIds.has(item?.id)) throw Error(`Повтор идентификатора в импорте: ${item.id}`);
  importedIds.add(item?.id);
  byId.set(item?.id, item);
}
const references = [...byId.values()];
for (const item of references) {
  if (!item || !/^[a-z0-9][a-z0-9-]*$/.test(item.id ?? '') || legacy.some(art => art.id === item.id) ||
      !/^data\/references\/[a-z0-9_-]+\.(png|jpe?g|webp|svg)$/i.test(item.src ?? '') ||
      !requiredText(item.title) || !requiredText(item.technique) || !requiredList(item.themes) || !requiredList(item.moods) ||
      !requiredList(item.palette) || !item.palette.every(color => /^#[0-9a-f]{6}$/i.test(color)) ||
      (item.composition !== undefined && !requiredList(item.composition)) ||
      ['source', 'license'].some(key => item[key] !== undefined && !requiredText(item[key])) ||
      (item.directions !== undefined && (!Array.isArray(item.directions) || !item.directions.every(key => ['daily', 'odd', 'dark', 'fun', 'abstract'].includes(key))))) {
    throw Error(`Неверные метаданные референса: ${item?.id ?? 'без id'}`);
  }
}
const artSources = Object.fromEntries(await Promise.all([...legacy, ...references].map(async ({id, src}) => {
  const extension = src.split('.').at(-1).toLowerCase();
  const bytes = await readFile(new URL(`../${src}`, data));
  return [id, `data:${formats[extension]};base64,${bytes.toString('base64')}`];
})));
if (process.argv[2]) await writeFile(new URL('reference-catalog.json', data), `${JSON.stringify(references, null, 2)}\n`);
await writeFile(new URL('offline.js', data), [
  '// Generated from the JSON libraries for opening index.html directly.',
  `const offlineIdeaLibrary = ${JSON.stringify(library)};`,
  `const offlineReferenceCatalog = ${JSON.stringify(references)};`,
  '',
].join('\n'));
await writeFile(new URL('offline-art.js', data), `// Generated for direct file:// opening.\nconst offlineArtSources = ${JSON.stringify(artSources)};\n`);
