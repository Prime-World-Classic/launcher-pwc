// Платформа «Мастерской свитков»: всё, что зависит от среды, — загрузка файлов и картинок, звук, хранилище, время, кадр.
// По умолчанию — браузер (лаунчер на NW.js, dev-сервер). Android-приложение (NativeScript + @nativescript/canvas)
// подменяет эти функции через setEaselPlatform() до первого обращения к мини-игре, остальной код зумы общий.
// Модуль ни от чего не зависит: его импортируют рендер, звук и контроллер, циклов быть не должно.

export const EaselPlatform = {
  name: 'web',

  // Файл по адресу: type — 'json' | 'buf' (ArrayBuffer) | 'blob'
  async fetch(url, type = 'json') {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(`Не удалось загрузить ${url}`);
    }
    if (!res.ok) throw new Error(`Не удалось загрузить ${url} (${res.status})`);
    return type === 'json' ? res.json() : type === 'blob' ? res.blob() : res.arrayBuffer();
  },

  // Картинка для gl.texImage2D. raw — без премультипликации альфы и цветокоррекции (альфа — данные, напр. карта
  // растекания краски); null — не загрузилась
  async image(url, raw = false) {
    if (raw) {
      const blob = await EaselPlatform.fetch(url, 'blob');
      return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  },

  // Освободить картинку после загрузки в текстуру
  releaseImage(img) {
    if (img && img.close) img.close();
  },

  // Звук: класс с интерфейсом EaselSound (load, play, stop, stopAll, pause, setVolume, destroy, volume);
  // null — Web Audio (easelSound.js)
  Sound: null,

  storage: {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // localStorage недоступен — прогресс только на сессию
      }
    },
  },

  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  // Плотность пикселей для буфера кадра (не больше 2: дороже — без видимой разницы)
  pixelRatio: () => Math.min(globalThis.devicePixelRatio || 1, 2),
};

export function setEaselPlatform(p) {
  Object.assign(EaselPlatform, p);
}
