let stickerDatabase;

function openStickerDatabase() {
  if (!stickerDatabase) stickerDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('polya-stickers', 3);
    request.onupgradeneeded = event => {
      if (event.oldVersion < 1) request.result.createObjectStore('images', {keyPath: 'id'});
      if (event.oldVersion < 2) request.result.createObjectStore('layouts');
      if (event.oldVersion < 3) request.result.createObjectStore('idea-variants', {keyPath: 'id'});
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); stickerDatabase = null; };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Хранилище открыто в другой вкладке.'));
  }).catch(error => {
    stickerDatabase = null;
    throw error;
  });
  return stickerDatabase;
}

async function stickerStore(mode, operation, collection = 'images') {
  const database = await openStickerDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(collection, mode);
    const request = operation(transaction.objectStore(collection));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Ошибка хранилища.'));
  });
}

async function findStickerOriginal(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const id = `user-sha256-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    return {id, existing: await stickerStore('readonly', store => store.get(id))};
  }
  // Web Crypto digests are unavailable on a plain HTTP address in the home LAN.
  for (const entry of await stickerStore('readonly', store => store.getAll())) {
    if (entry.blob.size !== blob.size) continue;
    const saved = new Uint8Array(await entry.blob.arrayBuffer());
    if (bytes.every((byte, index) => byte === saved[index])) return {id: entry.id, existing: entry};
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  return {id: `user-lan-${Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('')}`};
}

async function prepareStickerFile(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Файл должен быть не больше 2 МБ.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = new TextDecoder('ascii').decode(bytes);
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const webp = text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP';
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !webp && !jpeg) throw new Error('Выберите изображение PNG, WebP или JPEG.');
  const blob = file.slice(0, file.size, png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg');
  const {id, existing} = await findStickerOriginal(blob);
  if (existing) return [id, makeStoredSticker(existing)];
  const record = {id, label: file.name.slice(0, 100), blob};
  const asset = makeStoredSticker(record);
  try {
    try { await asset.image.decode(); }
    catch { throw new Error('Изображение не удалось прочитать.'); }
    if (asset.image.naturalWidth > 2048 || asset.image.naturalHeight > 2048) {
      throw new Error('Размер изображения должен быть не больше 2048 × 2048 пикселей.');
    }
    record.paper = jpeg || !hasTransparency(asset.image);
    asset.paper = record.paper;
    await stickerStore('readwrite', store => store.put(record));
    return [record.id, asset];
  } catch (error) {
    URL.revokeObjectURL(asset.image.src);
    throw error;
  }
}

function makeStoredSticker(record) {
  const image = new Image();
  image.src = URL.createObjectURL(record.blob);
  return {label: record.label, image, paper: record.paper ?? record.blob.type === 'image/jpeg'};
}

function hasTransparency(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(image, 0, 0);
  const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}
