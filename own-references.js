const ownCollection = 'reference-images';
const ownDrawings = 'reference-drawings';
const ownStorageLimit = 64 * 1024 * 1024;
const ownImageLimit = 120;

function ownReferences() {
  return stickerStore('readonly', store => store.getAll(), ownCollection);
}

function ownReference(id) {
  return stickerStore('readonly', store => store.get(id), ownCollection);
}

function ownName(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : 'Без названия';
}

function ownDrawing(id) {
  return stickerStore('readonly', store => store.get(id), ownDrawings);
}

function saveOwnDrawing(id, strokes) {
  return stickerStore('readwrite', store => store.put({id, strokes}), ownDrawings);
}

async function renameOwnReference(id, name) {
  const database = await openStickerDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ownCollection, 'readwrite');
    const store = transaction.objectStore(ownCollection);
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (record && !record.hidden) store.put({...record, name: ownName(name)});
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

async function deleteOwnReference(record, keepForArchive) {
  const database = await openStickerDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ownCollection, ownDrawings], 'readwrite');
    const images = transaction.objectStore(ownCollection);
    if (keepForArchive) images.put({...record, hidden: true});
    else images.delete(record.id);
    transaction.objectStore(ownDrawings).delete(record.id);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

async function storeOwnReference(record) {
  const database = await openStickerDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ownCollection, 'readwrite');
    const store = transaction.objectStore(ownCollection);
    let limitReached = false;
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result;
      const total = records.reduce((sum, item) => sum + item.blob.size + item.thumbnail.size, 0);
      if (records.length >= ownImageLimit || total + record.blob.size + record.thumbnail.size > ownStorageLimit) {
        limitReached = true;
        transaction.abort();
      } else store.add(record);
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(limitReached ? new Error('Библиотека достигла лимита 120 изображений или 64 МБ.') : transaction.error);
  });
}

function encodeReference(image, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Не удалось подготовить изображение.'));
  }, 'image/webp', quality));
}

async function prepareOwnReference(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Размер файла больше 25 МБ.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = new TextDecoder('ascii').decode(bytes);
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('Поддерживаются JPEG, PNG и WebP.');
  const url = URL.createObjectURL(file.slice(0, file.size, png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp'));
  const image = new Image();
  try {
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error('Файл повреждён или его не удалось прочитать.'); }
    if (image.naturalWidth * image.naturalHeight > 48_000_000) throw new Error('Разрешение файла больше 48 мегапикселей.');
    const blob = await encodeReference(image, 1600, .88);
    const thumbnail = await encodeReference(image, 320, .8);
    const id = 'own-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    return {id, date: Date.now(), blob, thumbnail};
  } finally { URL.revokeObjectURL(url); }
}
