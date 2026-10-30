export class Sound {
  static all = new Object();
  static cache = new Object();

  // canplaythrough приходит НЕ всегда: отсутствующий/битый файл, оборванный ответ,
  // или просто потерянное событие при нескольких сотнях параллельных Audio.load().
  // Резолвиться только по canplaythrough нельзя: App.initSounds() ждёт все загрузки,
  // и одна незакрытая навсегда вешает запуск лончера (фон есть, интерфейса нет,
  // ошибок нет). Проверено на реальной установке: из 313 загрузок одна не закрылась,
  // UI не построился.
  static PRELOAD_TIMEOUT_MS = 10000;
  static PRELOAD_CONCURRENCY = 12;

  /**
   * Preload a sound with the given name and src.
   * @param {string} name - The name of the sound to preload.
   * @param {string} src - The src of the sound to preload.
   * @returns {Promise<boolean>} resolves (never rejects) when the sound is ready;
   *          false — загрузка не удалась/не дошла, файл в кэше не лежит.
   */
  static preload(name, src) {
    return new Promise((resolve) => {
      const audio = new Audio();
      let done = false;

      const finish = (ok) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        if (ok) {
          Sound.cache[name] = audio;
        } else {
          console.warn(
            'Sound: предзагрузка не завершена:',
            name,
            src,
            audio.error ? `code=${audio.error.code}` : `timeout>${Sound.PRELOAD_TIMEOUT_MS}ms`,
          );
        }
        resolve(ok);
      };

      const timer = setTimeout(() => finish(false), Sound.PRELOAD_TIMEOUT_MS);

      audio.addEventListener("canplaythrough", () => finish(true));
      audio.addEventListener("error", () => finish(false));

      audio.src = src;
      audio.preload = "auto";
      audio.load();
    });
  }

  /**
   * Пакетная предзагрузка: ограничивает параллельность (шторм из нескольких сотен
   * Audio — источник потерянных canplaythrough) и не валится на отдельном файле.
   * @param {Array<[string,string]>} entries - пары name/src
   * @returns {Promise<{loaded:number, failed:string[]}>}
   */
  static async preloadAll(entries) {
    const queue = entries.slice();
    const failed = [];
    let loaded = 0;
    const workers = [];
    const n = Math.max(1, Math.min(Sound.PRELOAD_CONCURRENCY, queue.length));

    for (let i = 0; i < n; i++) {
      workers.push(
        (async () => {
          while (queue.length) {
            const [name, src] = queue.shift();
            if (await Sound.preload(name, src)) {
              loaded++;
            } else {
              failed.push(name);
            }
          }
        })(),
      );
    }

    await Promise.all(workers);

    if (failed.length) {
      console.warn(`Sound: ${failed.length} из ${entries.length} не предзагружены`, failed.slice(0, 10));
    }

    return { loaded, failed };
  }

  static play(source, object = {}, callback) {
    let baseAudio = null;

    for (const name in Sound.cache) {
      if (Sound.cache[name].src.includes(source)) {
        baseAudio = Sound.cache[name];
        break;
      }
    }

    if (!baseAudio) {
      console.error("Sound not preloaded:", source);
      return;
    }

    const audio = baseAudio.cloneNode(true);

    if ("loop" in object) {
      audio.loop = object.loop ? true : false;
    }

    if ("id" in object && object.id) {
      if (object.id in Sound.all) {
        Sound.stop(object.id);
      }

      Sound.all[object.id] = audio;

      if ("volume" in object) {
        Sound.all[object.id].volume = Math.min(Math.max(object.volume || 0, 0), 1);
      }
    }

    if (callback) {
      audio.addEventListener("ended", callback);
    }

    audio.play();
  }

  static stop(id) {
    if (id in Sound.all) {
      Sound.all[id].pause();

      delete Sound.all[id];
    }
  }

  static setVolume(id, volume) {
    if (id in Sound.all) {
      Sound.all[id].volume = volume;
    }
  }

  static pause(id) {
    if (id in Sound.all) {
      Sound.all[id].pause();
    }
  }
  static unpause(id) {
    if (id in Sound.all) {
      Sound.all[id].play();
    }
  }
}
