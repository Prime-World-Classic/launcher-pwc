import { App } from './app.js';
import { Lang } from './lang.js';

// Ошибка с переводом (строки chatImageError* в content/lang).
function fail(key) {
  return new Error(Lang.text(key).replace('${max}', String(ChatImages.MAX_BYTES / 1024 / 1024)));
}

// Картинки в чате замка (протокол — objects/chatImage.js в pw-api).
// Отправляют администрация и хелперы: картинка сжимается здесь (JPEG, с прозрачностью — PNG,
// сторона до MAX_SIDE; gif — как есть) и уходит кусками user.chatImageUpload. Боты
// pw-api пересылают её в Telegram и беседу ВКонтакте. Показ — у всех: файл качается
// кусками user.chatImage по тому же WS (HTTP через Cloudflare у части игроков режется),
// собирается в Blob и живёт в памяти, пока открыт лаунчер.
export class ChatImages {
  // Как MAX_BYTES в pw-api.
  static MAX_BYTES = 2 * 1024 * 1024;

  static MAX_SIDE = 1600;

  static UPLOAD_CHUNK = 64 * 1024;

  // App.api.request не пускает второй запрос того же метода, пока не пришёл ответ
  // на первый (REQUEST_ALREADY_PENDING), — все куски всех картинок идут по очереди.
  static queue = Promise.resolve();

  // Сообщение картинки без подписи — такой текст ставит сервер (его видят старые клиенты).
  static PLACEHOLDER = '[картинка]';

  static TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  // key -> Promise<objectURL>
  static cache = new Map();

  static caption(message) {
    return message.image && message.text === ChatImages.PLACEHOLDER ? '' : message.text;
  }

  static load(key) {
    let promise = ChatImages.cache.get(key);
    if (!promise) {
      promise = ChatImages.download(key);
      ChatImages.cache.set(key, promise);
      // Ошибка (обрыв связи) — при следующем показе пробуем снова.
      promise.catch(() => ChatImages.cache.delete(key));
    }
    return promise;
  }

  // Своя только что загруженная картинка — без повторного скачивания.
  static prime(key, blob) {
    if (!ChatImages.cache.has(key)) ChatImages.cache.set(key, Promise.resolve(URL.createObjectURL(blob)));
  }

  // Картинка целиком — одна задача очереди: куски одной картинки не перемешиваются с другими.
  static download(key) {
    const task = ChatImages.queue.then(() => ChatImages.fetchAll(key));
    ChatImages.queue = task.catch(() => {});
    return task;
  }

  static async fetchAll(key) {
    const parts = [];
    let offset = 0;
    let size = Infinity;
    let mime = 'image/jpeg';
    while (offset < size) {
      const answer = await ChatImages.request('chatImage', { key, offset });
      const part = ChatImages.decode(answer?.data);
      size = Number(answer?.size || 0);
      mime = String(answer?.mime || mime);
      if (!(size > 0) || !part.length) throw fail('chatImageErrorMissing');
      parts.push(part);
      offset += part.length;
    }
    return URL.createObjectURL(new Blob(parts, { type: mime }));
  }

  // Тот же метод может быть занят другим кодом (загрузка своей картинки) — ждём и повторяем.
  static async request(method, data) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await App.api.request('user', method, data);
      } catch (error) {
        if (error?.code !== 'REQUEST_ALREADY_PENDING' || attempt >= 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  static decode(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  static encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // Есть ли прозрачные пиксели (проверяем уменьшенную копию — быстро и достаточно).
  static hasAlpha(bitmap) {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  }

  // Файл из выбора, буфера обмена или перетаскивания → { blob, w, h }.
  static async prepare(file) {
    if (!file || !ChatImages.TYPES.includes(file.type)) throw fail('chatImageErrorType');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw fail('chatImageErrorType');
    }
    const w = bitmap.width;
    const h = bitmap.height;

    // Анимацию gif канвас не сохранит — отправляем как есть.
    if (file.type === 'image/gif') {
      bitmap.close();
      if (file.size > ChatImages.MAX_BYTES) throw fail('chatImageErrorTooBig');
      return { blob: file, w, h };
    }

    // JPEG, а с прозрачностью — PNG: эти форматы без перекодирования принимают
    // и Telegram, и ВКонтакте (боты пересылают картинку туда же), webp фото VK не берёт.
    const type = ChatImages.hasAlpha(bitmap) ? 'image/png' : 'image/jpeg';
    let best = null;
    for (const [side, quality] of [
      [ChatImages.MAX_SIDE, 0.86],
      [ChatImages.MAX_SIDE, 0.74],
      [1200, 0.74],
      [900, 0.7],
    ]) {
      const scale = Math.min(1, side / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      if (blob && (!best || blob.size < best.blob.size)) best = { blob, w: canvas.width, h: canvas.height };
      if (best && best.blob.size <= ChatImages.MAX_BYTES) break;
    }
    bitmap.close();

    // Небольшой png/jpeg, который пережатие не уменьшило (пиксель-арт, скриншот), — оригинал.
    if (
      file.type !== 'image/webp' &&
      Math.max(w, h) <= ChatImages.MAX_SIDE &&
      file.size <= ChatImages.MAX_BYTES &&
      (!best || file.size <= best.blob.size)
    ) {
      return { blob: file, w, h };
    }
    if (!best || best.blob.size > ChatImages.MAX_BYTES) throw fail('chatImageErrorTooBig');
    return best;
  }

  // → { key, w, h }
  static async upload(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const count = Math.max(1, Math.ceil(bytes.length / ChatImages.UPLOAD_CHUNK));
    const uploadId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    let result = null;
    for (let index = 0; index < count; index++) {
      const data = ChatImages.encode(bytes.subarray(index * ChatImages.UPLOAD_CHUNK, (index + 1) * ChatImages.UPLOAD_CHUNK));
      result = await ChatImages.request('chatImageUpload', { uploadId, index, count, data });
    }
    if (!result?.key) throw fail('chatImageErrorBad');
    ChatImages.prime(result.key, blob);
    return result;
  }
}
