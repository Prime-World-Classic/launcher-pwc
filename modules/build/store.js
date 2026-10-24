// Данные окна билда с сервера: build.data (билд), build.peek (остальные билды героя — заранее,
// без смены выбранного), build.inventory (справочник талантов героя для библиотеки).
// Вкладка билда открывается из кэша сразу, свежий ответ сервера догоняет её в фоне.
// Любая правка билда (окно, лобби, админка) сбрасывает то, что могла сделать устаревшим.

import { App } from '../app.js';

const key = (heroId, buildId) => `${Number(heroId)}:${Number(buildId)}`;

// запросы, которые билд не меняют
const READ_METHODS = new Set([
  'data', 'peek', 'inventory', 'get', 'my', 'target', 'sets', 'setsPopularity', 'addSetPopularity',
  'favouriteSet', 'heroData', 'heroAll', 'talentAll', 'talentHeroAll', 'heroAdminAll',
]);
// правки поля, панели или галочек одного билда (buildId или id в данных)
const BODY_METHODS = new Set([
  'optimisticLayout', 'set', 'optimisticSet', 'setZero', 'optimisticRemove', 'setActive', 'optimisticSetActive',
  'setZeroActive', 'optimisticClearActive', 'swap', 'optimisticSwap', 'random', 'clear', 'setProfile',
]);

const CATALOG_TTL_MS = 10 * 60 * 1000;

// Ждёт, пока у App.api нет запросов object(.method)
export function waitApiIdle(object, method = null, timeoutMs = 3000) {
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const busy = Object.values(App?.api?.awaiting || {}).some((v) => v?.object === object && (!method || v?.method === method));
      if (!busy) return resolve(true);
      if (performance.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export class BuildStore {
  static builds = new Map(); // "герой:билд" -> { data, json } — ответ сервера как пришёл
  static selected = new Map(); // герой -> выбранный на сервере билд
  static catalogs = new Map(); // герой -> { items, at } — все таланты героя по порядку сервера
  static gen = 0; // растёт на каждую правку билда: ответы, начатые раньше, в кэш не попадают
  static peekUnsupported = false; // старый бэкенд без build.peek
  static _fetching = null;
  static _watching = false;

  static watch() {
    if (BuildStore._watching) return;
    BuildStore._watching = true;
    App.api?.constructor?.requestObservers?.add(BuildStore.onRequest);
  }

  static onRequest(phase, object, method, data) {
    if (object !== 'build') return;
    if (method === 'target') return BuildStore.selected.clear();
    if (READ_METHODS.has(method)) return;
    BuildStore.gen++;
    if (method.startsWith('talent')) BuildStore.catalogs.clear();
    const buildId = Number(data?.buildId ?? data?.id);
    if (BODY_METHODS.has(method) && buildId) {
      for (const k of [...BuildStore.builds.keys()]) if (k.endsWith(`:${buildId}`)) BuildStore.builds.delete(k);
      // правка дошла — подтянуть билд заново, чтобы возврат на вкладку был мгновенным
      if (phase === 'done') BuildStore.onBodySaved?.();
      return;
    }
    BuildStore.builds.clear();
    BuildStore.selected.clear();
  }

  // Ответ build.data/peek в кэш, если с начала запроса билд никто не правил.
  // selected — ответ build.data: сервер теперь считает этот билд выбранным (peek — нет).
  static store(heroId, data, gen, { selected = false } = {}) {
    if (gen !== BuildStore.gen || !data || typeof data !== 'object' || !Number(data.id)) return;
    const json = JSON.stringify(data);
    BuildStore.builds.set(key(heroId, data.id), { data: JSON.parse(json), json });
    if (selected) BuildStore.selected.set(Number(heroId), Number(data.id));
  }

  // Копия ответа из кэша; buildId 0 — выбранный билд героя, если он известен
  static cached(heroId, buildId) {
    const id = Number(buildId) || BuildStore.selected.get(Number(heroId));
    const entry = id ? BuildStore.builds.get(key(heroId, id)) : null;
    return entry ? { data: JSON.parse(entry.json), json: entry.json } : null;
  }

  static has(heroId, buildId) {
    return BuildStore.builds.has(key(heroId, buildId));
  }

  // build.data «последний побеждает»: прежний запрос дожидается, при REQUEST_ALREADY_PENDING
  // (метод держит правка) — повтор, когда освободится. isCurrent() false — ответ не нужен (null).
  static fetch(heroId, buildId, isCurrent) {
    const previous = BuildStore._fetching;
    const phase = (async () => {
      await previous?.catch(() => {});
      if (!isCurrent()) return null;
      const request = async () => {
        const gen = BuildStore.gen;
        const data = await App.api.request('build', 'data', { heroId, target: buildId });
        BuildStore.store(heroId, data, gen, { selected: true });
        return data;
      };
      try {
        return await request();
      } catch (error) {
        if (error?.code !== 'REQUEST_ALREADY_PENDING') throw error;
        await waitApiIdle('build', null, 5000);
        return isCurrent() ? request() : null;
      }
    })();
    BuildStore._fetching = phase;
    return phase;
  }

  // Остальные билды героя — в кэш через build.peek, по одному, когда окно ничего не ждёт.
  // stillOn() false — окно ушло к другому герою, предзагрузка прекращается.
  static async prefetch(heroId, builds, stillOn, idle) {
    if (BuildStore.peekUnsupported || BuildStore._prefetching) return;
    BuildStore._prefetching = true;
    try {
      for (const build of builds) {
        if (!stillOn() || BuildStore.has(heroId, build.id)) continue;
        await idle();
        await waitApiIdle('build', null, 5000);
        if (!stillOn() || BuildStore.has(heroId, build.id)) continue;
        const gen = BuildStore.gen;
        try {
          BuildStore.store(heroId, await App.api.request('build', 'peek', { heroId, target: build.id }), gen);
        } catch (error) {
          if (String(error?.message ?? error).includes('Not method')) BuildStore.peekUnsupported = true;
          return;
        }
      }
    } finally {
      BuildStore._prefetching = false;
    }
  }

  // Справочник талантов героя: ответ build.inventory плюс таланты билда из build.data —
  // классовые по уровню, затем обычные по редкости (по убыванию), как отдаёт сервер
  static rememberCatalog(heroId, inventory, body, gen) {
    if (gen !== BuildStore.gen || !Array.isArray(inventory) || !Array.isArray(body)) return;
    const items = structuredClone(inventory);
    const known = new Set(items.map((talent) => Number(talent?.id)));
    const rank = (talent) => (Number(talent.id) < 0 ? [0, Number(talent.level) || 0] : [1, -(Number(talent.rarity) || 0)]);
    const after = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
    for (const talent of body) {
      if (!talent || known.has(Number(talent.id))) continue;
      const index = items.findIndex((other) => after(rank(other), rank(talent)));
      items.splice(index < 0 ? items.length : index, 0, structuredClone(talent));
      known.add(Number(talent.id));
    }
    BuildStore.catalogs.set(Number(heroId), { items, at: Date.now() });
  }

  // Все таланты героя (копия) или null, если справочника ещё нет; устаревший обновляется в фоне
  static catalog(heroId, buildId, body) {
    const entry = BuildStore.catalogs.get(Number(heroId));
    if (!entry) return null;
    if (Date.now() - entry.at > CATALOG_TTL_MS) BuildStore.loadCatalog(heroId, buildId, body).catch(() => {});
    return structuredClone(entry.items);
  }

  // build.inventory (страницами под лимит фрейма) -> справочник героя
  static async loadCatalog(heroId, buildId, body, isCurrent = () => true) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!isCurrent()) return null;
      const gen = BuildStore.gen;
      try {
        const inventory = await App.api.requestPaged('build', 'inventory', { buildId });
        BuildStore.rememberCatalog(heroId, inventory, body, gen);
        // правка во время запроса: справочник не запомнился, но библиотеке он нужен сейчас
        return BuildStore.catalogs.get(Number(heroId))?.items ? structuredClone(BuildStore.catalogs.get(Number(heroId)).items) : [...inventory, ...body.filter(Boolean)];
      } catch (error) {
        if (error?.code === 'REQUEST_ALREADY_PENDING') await waitApiIdle('build', 'inventory', 5000);
        else if (attempt >= 1) return [];
      }
    }
    return [];
  }
}
