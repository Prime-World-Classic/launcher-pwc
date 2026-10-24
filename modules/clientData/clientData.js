// Данные игры для лаунчера — прямо из pile-архивов клиента (Game/Packs), как их видит игра:
// таланты (имя, описание, константы и формулы, условия подсказки, цена/КД, статы),
// герои (статы, имена), подсказки UI (макросы $(TThead)…, стили шрифтов, картинки).
//
// Новый талант/герой в игре появляется в лаунчере сам: достаточно связи web id ->
// persistentId в content/talent_data/persistent_ids.json (генератор —
// tools/client-data/gen_persistent_ids.py, те же строки, что бэкенд кладёт в
// persistent_talents / persistent_hero).
//
// Источник файлов: NW.js — ../Game/Packs/*.pile; dev-сервер Vite — папка Data
// репозитория Prime-World (vite.config.js, /__pwdata/). Нет ни того, ни другого —
// ClientData.ready === false, и лаунчер показывает прежние тексты из lang / talent_data.

import { PileFs, HttpDataFs, normalizeKey } from './pileFs.js';
import { parseXml, child, at, textAt, items, refOf, dbidToKey, textrefToKey, decodeText } from './xdb.js';

export const LANGS = ['ru', 'en'];
const INDEX_CACHE_KEY = 'clientData.index.v1';

// Типы талантов (EAbilityType) -> mAbilityType
export const ABILITY_TYPES = { Simple: 0, Active: 1, MultiActive: 2, Passive: 3, AutoCastable: 4, Switchable: 5, Channelling: 6 };

// Редкость таланта (ETalentRarity) -> rarity лаунчера (0 — классовый)
export const RARITY = { Class: 0, class: 0, ordinary: 1, good: 1, excellent: 1, magnificent: 2, exclusive: 3, outstanding: 4 };

function formulaOf(node) {
  if (!node) return null;
  return { src: textAt(node, 'sString'), type: textAt(node, 'returnType', 'float') };
}

export class ClientData {
  static fs = null;
  static ready = false;
  static error = null;
  static ids = { talent: [], class_talent: [], hero: [] };
  static globals = null; // { scaling, consts, conds }
  static ui = null; // { macros: {lang: {id: text}}, fonts, images }
  static talentIndex = new Map(); // pid -> key
  static heroIndex = new Map(); // pid -> key
  static _initPromise = null;
  static _talents = new Map(); // web id -> Promise<талант>
  static loaded = new Map(); // web id -> талант (прочитанные)
  static done = new Set(); // web id талантов, чтение которых завершено (в т. ч. неудачно)
  static settled = false; // init завершён (успешно или нет)
  static _heroes = new Map(); // web id -> Promise<герой>
  static loadedHeroes = new Map(); // web id -> герой | null (чтение завершено)
  static _xdb = new Map(); // key -> Promise<node>
  static _texts = new Map(); // key -> Promise<string>

  static init() {
    if (!ClientData._initPromise) ClientData._initPromise = ClientData._init();
    return ClientData._initPromise;
  }

  static async _init() {
    try {
      ClientData.fs = await ClientData.openFs();
      if (!ClientData.fs) return false;
      const ids = await fetch('content/talent_data/persistent_ids.json').then((response) => response.json());
      ClientData.ids = { talent: ids.talent || [], class_talent: ids.class_talent || [], hero: ids.hero || [] };
      await Promise.all([ClientData.loadGlobals(), ClientData.loadUi(), ClientData.loadIndex()]);
      ClientData.ready = true;
      console.log('ClientData: данные игры загружены,', ClientData.talentIndex.size, 'талантов,', ClientData.heroIndex.size, 'героев');
    } catch (error) {
      ClientData.error = error;
      ClientData.ready = false;
      console.warn('ClientData: данные игры недоступны, лаунчер берёт тексты из lang/talent_data', error);
    }
    ClientData.settled = true;
    return ClientData.ready;
  }

  static async openFs() {
    const nodeRequire = typeof require === 'function' ? require : globalThis.nw?.require;
    if (nodeRequire && typeof process !== 'undefined') {
      const fs = nodeRequire('fs');
      const path = nodeRequire('path');
      // игра рядом с лаунчером (как PWGame.PATH); для проверки из NW SDK путь можно задать
      // переменной окружения PW_GAME_PACKS или localStorage['clientData.packsDir']
      let override = process.env?.PW_GAME_PACKS || '';
      try {
        override = override || localStorage.getItem('clientData.packsDir') || '';
      } catch {}
      const dir = override || path.join(process.cwd(), '../Game/Packs');
      if (!fs.existsSync(dir)) return null;
      return new PileFs({ fs, zlib: nodeRequire('zlib'), path, dir }).open();
    }
    if (typeof location !== 'undefined' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
      return new HttpDataFs().open().catch(() => null);
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // Файлы

  static xdb(key) {
    key = normalizeKey(key);
    if (!ClientData._xdb.has(key)) {
      ClientData._xdb.set(
        key,
        ClientData.fs.read(key).then((bytes) => (bytes ? parseXml(bytes) : null)),
      );
    }
    return ClientData._xdb.get(key);
  }

  static text(key) {
    key = normalizeKey(key);
    if (!key) return Promise.resolve(null);
    if (!ClientData._texts.has(key)) {
      ClientData._texts.set(
        key,
        ClientData.fs.read(key).then((bytes) => (bytes ? decodeText(bytes).replace(/\r\n?/g, '\n') : null)),
      );
    }
    return ClientData._texts.get(key);
  }

  // textref нужного языка; нет перевода — русский оригинал
  static async textref(textref, lang) {
    if (!textref) return '';
    if (lang !== 'ru') {
      const translated = await ClientData.text(textrefToKey(textref, lang));
      if (translated != null) return translated;
    }
    return (await ClientData.text(textrefToKey(textref, 'ru'))) ?? '';
  }

  // Объект ссылочного поля: встроенный или из файла по href; parent="…" — наследование полей
  static async resolve(field) {
    const { node, href } = refOf(field);
    let target = node;
    if (!target && href) target = await ClientData.xdb(dbidToKey(href));
    return target ? ClientData.inherit(target) : null;
  }

  static async inherit(node) {
    const parent = node?.attrs?.parent;
    if (!parent) return node;
    const base = await ClientData.xdb(dbidToKey(parent));
    if (!base) return node;
    const merged = await ClientData.inherit(base);
    const own = new Set(node.children.map((item) => item.tag));
    return { ...node, children: [...merged.children.filter((item) => !own.has(item.tag)), ...node.children] };
  }

  static async constants(field) {
    const result = {};
    const container = await ClientData.resolve(field);
    if (!container) return result;
    for (const item of items(container, 'vars')) {
      const constant = await ClientData.resolve(item);
      if (!constant) continue;
      const name = textAt(constant, 'name');
      if (name && !(name in result)) result[name] = formulaOf(child(constant, 'var'));
    }
    return result;
  }

  static async conditions(field) {
    const result = {};
    for (const item of items(field)) {
      const condition = await ClientData.resolve(item);
      if (!condition) continue;
      const name = textAt(condition, 'name');
      if (name && !(name in result)) result[name] = formulaOf(child(condition, 'condition'));
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------
  // Общие данные: AILogic.AILP (масштабы, глобальные константы, условия подсказок)

  static async loadGlobals() {
    const ai = await ClientData.xdb('GameLogic/AILogic.AILP.xdb');
    if (!ai) throw new Error('нет GameLogic/AILogic.AILP');
    const scaling = {};
    for (const item of child(ai, 'abilityAndDamageScalingParams')?.children || []) scaling[item.tag] = Number(item.text);
    ClientData.globals = {
      scaling,
      consts: await ClientData.constants(child(ai, 'globalConstants')),
      conds: await ClientData.conditions(child(ai, 'conditionFormulas')),
      ...(await ClientData.loadKits(child(ai, 'talentKits'))),
    };
  }

  // Наборы талантов игры (talentKits): название, состав, «особый» талант набора.
  // kitByTalent: ключ файла таланта -> набор
  static async loadKits(field) {
    const kits = [];
    const kitByTalent = new Map();
    const list = await ClientData.resolve(field);
    for (const item of items(list, 'kits')) {
      const kit = await ClientData.resolve(item);
      if (!kit) continue;
      const nameRef = child(kit, 'name')?.attrs?.textref;
      const entry = {
        name: {},
        capacity: Number(textAt(kit, 'kitCapacity', '0')),
        special: normalizeKey(dbidToKey(child(kit, 'special')?.attrs?.href)),
        talents: items(kit, 'talents').map((talent) => normalizeKey(dbidToKey(talent.attrs.href))).filter(Boolean),
      };
      for (const lang of LANGS) entry.name[lang] = (await ClientData.textref(nameRef, lang)).trim();
      // у части наборов вместо названия заглушка: пусто, «G623», латиница одинаковая в ru и en
      const ru = entry.name.ru;
      entry.named = !!ru && !/^G\d+$/i.test(ru) && !(ru === entry.name.en && /^[\x20-\x7e]+$/.test(ru));
      kits.push(entry);
      for (const key of entry.talents) if (!kitByTalent.has(key)) kitByTalent.set(key, entry);
    }
    return { kits, kitByTalent };
  }

  // persistentId таланта по ключу файла (для состава наборов)
  static pidByKey(key) {
    if (!ClientData._pidByKey) ClientData._pidByKey = new Map([...ClientData.talentIndex].map(([pid, file]) => [file, pid]));
    return ClientData._pidByKey.get(key) || null;
  }

  // UIRoot: макросы $(id) обоих языков, стили шрифтов, картинки <image:name>
  static async loadUi() {
    const root = await ClientData.xdb('UI/UIRoot.xdb');
    if (!root) throw new Error('нет UI/UIRoot');
    const macros = {};
    for (const lang of LANGS) macros[lang] = {};
    for (const item of items(root, 'substitutes')) {
      const id = textAt(item, 'id');
      const textref = child(item, 'captionText')?.attrs?.textref;
      if (!id || !textref) continue;
      for (const lang of LANGS) macros[lang][id] = await ClientData.textref(textref, lang);
    }
    const fonts = {};
    for (const item of items(root, 'fontStyles')) {
      const style = await ClientData.resolve(item);
      const name = textAt(style, 'styleName');
      if (name) fonts[name] = ClientData.fontStyle(style);
    }
    const images = {};
    for (const item of items(root, 'styleAliases')) {
      const name = textAt(item, 'name');
      const material = child(item, 'material')?.attrs?.href;
      if (name && material) images[name] = material;
    }
    // talent.rarityName (PFTalent::GetRarityName): UI/Content/_.UIDT rarityValue[ETalentRarity]
    const rarityNames = {};
    const uidt = await ClientData.xdb('UI/Content/_.UIDT.xdb');
    for (const lang of LANGS) {
      rarityNames[lang] = [];
      for (const item of items(uidt, 'rarityValue')) rarityNames[lang].push(await ClientData.textref(item.attrs.textref, lang));
    }
    ClientData.ui = { macros, fonts, images, rarityNames };
  }

  static fontStyle(style) {
    const color = (tag) => {
      const node = child(style, tag);
      if (!node) return null;
      const part = (name) => Math.round(Number(textAt(node, name, '0')) * 255);
      return [part('R'), part('G'), part('B'), Number(textAt(node, 'A', '1'))];
    };
    return {
      color: color('primaryColor'),
      outline: textAt(style, 'drawContour') === 'true' ? color('secondaryColor') : null,
      size: Number(textAt(style, 'fontSize', '10')),
      bold: textAt(style, 'bold') === 'true',
      italic: textAt(style, 'italic') === 'true',
    };
  }

  // Картинка по имени <image:name> (или материалу) -> { key, crop } текстуры .dds
  static async imageSource(name) {
    const material = ClientData.ui?.images?.[name] || (name.startsWith('/') ? name : null);
    if (!material) return null;
    const node = await ClientData.xdb(dbidToKey(material));
    if (!node) return null;
    const texture = await ClientData.resolve(at(node, 'DiffuseMap/texture'));
    const file = textAt(texture, 'textureFileName');
    if (!file) return null;
    const vec = (tag) => ({ x: Number(textAt(node, `${tag}/x`, '0')), y: Number(textAt(node, `${tag}/y`, '0')) });
    const shift = vec('textureShift');
    const size = vec('imageSize');
    const tile = vec('imageTileShift');
    const tileSize = vec('imageTileSize');
    return {
      key: normalizeKey(file),
      // кусок атласа — только при сдвиге; иначе текстура целиком растягивается в imageSize
      // (starOrange.dds 31×31 в материале 24×24)
      crop: (shift.x || shift.y) && size.x && size.y ? { x: shift.x, y: shift.y, width: size.x, height: size.y } : null,
      slice: tileSize.x ? { left: tile.x, top: tile.y, right: size.x - tile.x - tileSize.x, bottom: size.y - tile.y - tileSize.y } : null,
      width: size.x,
      height: size.y,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Индекс persistentId -> файл (таланты Items/**, герои Heroes/**). Строится по pile один раз
  // и хранится в localStorage до обновления игровых данных.

  static async loadIndex() {
    const signature = ClientData.fs.signature();
    try {
      const cached = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null');
      if (cached?.signature === signature && signature !== 'dev') {
        ClientData.talentIndex = new Map(cached.talents);
        ClientData.heroIndex = new Map(cached.heroes);
        return;
      }
    } catch {}
    ClientData.talentIndex = await ClientData.scan('items/', /\.talent\.xdb$/);
    ClientData.heroIndex = await ClientData.scan('heroes/', /\.hrob\.xdb$/);
    try {
      localStorage.setItem(
        INDEX_CACHE_KEY,
        JSON.stringify({ signature, talents: [...ClientData.talentIndex], heroes: [...ClientData.heroIndex] }),
      );
    } catch {}
  }

  static async scan(prefix, pattern) {
    if (ClientData.fs.persistentIds) {
      const fast = await ClientData.fs.persistentIds(prefix, pattern).catch(() => null);
      if (fast) return fast;
    }
    const index = new Map();
    const keys = (await ClientData.fs.list(prefix)).filter((key) => pattern.test(key)).sort();
    const decoder = new TextDecoder('utf-8');
    const batch = 32;
    for (let i = 0; i < keys.length; i += batch) {
      const part = keys.slice(i, i + batch);
      const bodies = await Promise.all(part.map((key) => ClientData.fs.read(key)));
      part.forEach((key, n) => {
        const match = bodies[n] && /<persistentId>([^<]+)<\/persistentId>/.exec(decoder.decode(bodies[n]));
        const pid = match?.[1]?.trim();
        if (pid && !index.has(pid)) index.set(pid, key);
      });
    }
    return index;
  }

  // ---------------------------------------------------------------------------------------
  // Таланты: web id > 0 — обычный (talent), < 0 — классовый (class_talent)

  static pidOf(webId) {
    const id = Number(webId);
    const list = id > 0 ? ClientData.ids.talent : ClientData.ids.class_talent;
    return list[Math.abs(id) - 1] || null;
  }

  static webIdOf(pid) {
    let index = ClientData.ids.class_talent.indexOf(pid);
    if (index >= 0) return -(index + 1);
    index = ClientData.ids.talent.indexOf(pid);
    return index >= 0 ? index + 1 : null;
  }

  static hasTalent(webId) {
    const pid = ClientData.pidOf(webId);
    return !!(ClientData.ready && pid && ClientData.talentIndex.has(pid));
  }

  static talent(webId) {
    const id = Number(webId);
    if (!ClientData._talents.has(id)) {
      ClientData._talents.set(
        id,
        ClientData.loadTalent(id)
          .then((talent) => {
            if (talent) ClientData.loaded.set(id, talent);
            return talent;
          })
          .catch((error) => {
            console.warn(`ClientData: талант ${id} не прочитан`, error);
            return null;
          })
          .finally(() => ClientData.done.add(id)),
      );
    }
    return ClientData._talents.get(id);
  }

  // Имя уже прочитанного таланта (после прогрева — любого) без ожидания; null — ещё не прочитан
  static talentName(webId, lang = 'ru') {
    const talent = ClientData.loaded.get(Number(webId));
    const name = talent?.texts?.[lang]?.name || talent?.texts?.ru?.name || '';
    return name.trim() || null;
  }

  // Талант по persistentId (для talconst/tal из формул других талантов)
  static talentByPid(pid) {
    const webId = ClientData.webIdOf(pid);
    if (webId != null) return ClientData.talent(webId);
    const key = ClientData.talentIndex.get(pid);
    return key ? ClientData.loadTalentFile(key, null) : Promise.resolve(null);
  }

  static async loadTalent(webId) {
    const pid = ClientData.pidOf(webId);
    const key = pid && ClientData.talentIndex.get(pid);
    if (!key) return null;
    return ClientData.loadTalentFile(key, webId);
  }

  static async loadTalentFile(key, webId) {
    // сам файл таланта не кэшируем: из него берётся только результат ниже
    const bytes = await ClientData.fs.read(key);
    const root = bytes ? await ClientData.inherit(parseXml(bytes)) : null;
    if (!root) return null;
    const textrefs = {};
    for (const tag of ['name', 'description', 'commonDescription', 'shortDescription']) textrefs[tag] = child(root, tag)?.attrs?.textref || '';
    const texts = {};
    for (const lang of LANGS) {
      texts[lang] = {};
      for (const [tag, textref] of Object.entries(textrefs)) texts[lang][tag] = await ClientData.textref(textref, lang);
    }
    const statMods = [];
    for (const item of items(root, 'passiveApplicators')) {
      const applicator = await ClientData.resolve(item);
      if (applicator?.tag !== 'PermanentStatModApplicator') continue;
      const modifier = child(applicator, 'modifier');
      statMods.push({
        stat: textAt(modifier, 'stat'),
        variable: textAt(modifier, 'variable'), // не пусто — счётчик, а не стат героя
        add: formulaOf(child(modifier, 'addValue')),
        mult: formulaOf(child(modifier, 'multValue')),
        enabled: formulaOf(child(applicator, 'enabled')),
        caption: textAt(applicator, 'caption'),
      });
    }
    return {
      webId,
      key,
      pid: textAt(root, 'persistentId'),
      rarity: textAt(root, 'rarity'),
      type: textAt(root, 'type', 'Passive'),
      flags: Number(textAt(root, 'flags', '0')),
      isUltimate: textAt(root, 'isUltimateTalent') === 'true',
      devPoints: Number(textAt(root, 'devPoints', '0')),
      minLevel: Number(textAt(root, 'minLevel', '0')),
      naftaCost: Number(textAt(root, 'naftaCost', '-1')),
      manaCost: formulaOf(child(root, 'manaCost')),
      cooldown: formulaOf(child(root, 'cooldownTime')),
      consts: await ClientData.constants(child(root, 'constants')),
      conds: await ClientData.conditions(child(root, 'conditionFormulas')),
      image: child(root, 'image')?.attrs?.href || '',
      statMods,
      texts,
    };
  }

  // Фоновый прогрев: все таланты лаунчера читаются заранее мелкими порциями в простое,
  // чтобы первое наведение в билде не ждало чтения pile.
  static warmUp({ chunk = 24, idle = globalThis.requestIdleCallback } = {}) {
    if (!ClientData.ready || ClientData._warm) return ClientData._warm || Promise.resolve();
    const ids = [];
    ClientData.ids.class_talent.forEach((pid, i) => pid && ids.push(-(i + 1)));
    ClientData.ids.talent.forEach((pid, i) => pid && ids.push(i + 1));
    const wait = () => new Promise((resolve) => (idle ? idle(() => resolve(), { timeout: 500 }) : setTimeout(resolve, 0)));
    ClientData._warm = (async () => {
      const started = Date.now();
      for (let i = 0; i < ids.length; i += chunk) {
        await wait();
        await Promise.all(ids.slice(i, i + chunk).map((id) => ClientData.talent(id)));
      }
      await wait();
      await Promise.all(ClientData.ids.hero.map((pid, i) => pid && ClientData.hero(i + 1)));
      console.log(`ClientData: ${ids.length} талантов и герои прочитаны заранее за ${Date.now() - started} мс`);
    })();
    return ClientData._warm;
  }

  // ---------------------------------------------------------------------------------------
  // Герои: web id 1..N -> HROB

  static hero(webId) {
    const id = Number(webId);
    if (!ClientData._heroes.has(id)) {
      ClientData._heroes.set(
        id,
        ClientData.loadHero(id)
          .catch((error) => {
            console.warn(`ClientData: герой ${id} не прочитан`, error);
            return null;
          })
          .then((hero) => {
            ClientData.loadedHeroes.set(id, hero);
            return hero;
          }),
      );
    }
    return ClientData._heroes.get(id);
  }

  static async loadHero(webId) {
    const pid = ClientData.ids.hero[Number(webId) - 1];
    const key = pid && ClientData.heroIndex.get(pid);
    if (!key) return null;
    const root = await ClientData.inherit(await ClientData.xdb(key));
    const statsNode = await ClientData.resolve(child(root, 'stats'));
    const stats = {};
    for (const item of items(statsNode, 'stats')) {
      const stat = textAt(item, 'statId');
      if (stat) stats[stat] = { value: formulaOf(child(item, 'value')), increment: formulaOf(child(item, 'increment')) };
    }
    const names = {};
    for (const lang of LANGS) {
      names[lang] = {
        A: await ClientData.textref(child(root, 'heroNameA')?.attrs?.textref, lang),
        B: await ClientData.textref(child(root, 'heroNameB')?.attrs?.textref, lang),
      };
    }
    const recommended = items(root, 'recommendedStats').map((item) => item.text.trim());
    return { webId: Number(webId), pid, key, stats, names, recommended };
  }
}
