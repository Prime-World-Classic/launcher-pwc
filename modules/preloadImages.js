export class PreloadImages {
  static load(callback, url) {
    let preload = new Image();

    preload.src = url;

    preload.addEventListener('load', () => {
      callback();
    });
  }

  static async loadAsync(url) {
    let image = new Image();

    image.src = url;

    return new Promise((resolve, reject) => {
      image.addEventListener('load', () => {
        resolve(image);
      });

      image.addEventListener('error', (error) => reject(error));
    });
  }

  // Один общий IntersectionObserver на всё приложение вместо отдельного на каждый элемент.
  // Раньше каждый `new PreloadImages()` создавал свой observer — в библиотеке талантов это сотни observer'ов.
  static _observer = null;
  static fallbacks = {}; // имя -> (element) => url | null | Promise
  static _callbacks = new WeakMap();
  static _loadedUrls = new Set();

  static getObserver() {
    if (!PreloadImages._observer) {
      PreloadImages._observer = new IntersectionObserver((entries) => PreloadImages.handleEntries(entries));
    }
    return PreloadImages._observer;
  }

  static handleEntries(entries) {
    const observer = PreloadImages.getObserver();
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      const element = entry.target;
      observer.unobserve(element);

      const url = element.dataset.url;
      const callback = PreloadImages._callbacks.get(element);
      PreloadImages._callbacks.delete(element);

      const reveal = () => {
        const animation = element.animate({ opacity: [0, 1] }, { duration: 500, easing: 'ease-out' });
        // Фиксируем итог инлайн-стилем и не держим анимацию с fill: 'forwards' живой бесконечно.
        element.style.opacity = 1;
        animation.onfinish = () => {
          animation.onfinish = null;
          if (callback) callback(element);
        };
      };

      if (!url) {
        reveal();
        continue;
      }

      // картинка уже загружалась (в кэше браузера) — показываем сразу, без проявления:
      // иначе каждое открытие билда заново «проявляло» сотни иконок библиотеки
      if (PreloadImages._loadedUrls.has(url)) {
        element.style.backgroundImage = `url("${url}")`;
        element.style.opacity = 1;
        if (callback) callback(element);
        continue;
      }

      const preload = new Image();
      preload.decoding = 'async';
      preload.addEventListener(
        'load',
        () => {
          PreloadImages._loadedUrls.add(url);
          element.style.backgroundImage = `url("${url}")`;
          reveal();
        },
        { once: true },
      );
      // Без этого элемент с битой картинкой навсегда оставался с opacity: 0.
      // data-fallback — запасной источник картинки (PreloadImages.fallbacks), например иконка из данных игры.
      preload.addEventListener(
        'error',
        () => {
          const fallback = PreloadImages.fallbacks[element.dataset.fallback];
          if (!fallback) return reveal();
          Promise.resolve(fallback(element))
            .catch(() => null)
            .then((fallbackUrl) => {
              if (fallbackUrl) element.style.backgroundImage = `url("${fallbackUrl}")`;
              reveal();
            });
        },
        { once: true },
      );
      preload.src = url;
    }
  }

  constructor(target, callback) {
    this.target = target;

    this.callback = callback;
  }

  add(element, target) {
    element.style.opacity = 0;

    if (this.callback) {
      PreloadImages._callbacks.set(element, this.callback);
    }

    PreloadImages.getObserver().observe(element);

    if (target) {
      target.append(element);
    } else {
      this.target.append(element);
    }
  }
}
