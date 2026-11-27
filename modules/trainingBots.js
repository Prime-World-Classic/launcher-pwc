// Тренировка с ботами (режим «Тренировка» в списке режимов замка): игрок + 4 бота
// против 5 ботов. Бэкенд о ботах не знает — тренировка у него на одного игрока
// (pw-api mm.model.js training), ботов добавляет сама игра. Лаунчер выбирает героев
// ботов, показывает союзников в пати замка (View.syncCastleTrainingBots) и передаёт
// состав игре именованной опцией строки запуска (pwgame.js GetPlayPwProtocol):
//
//   bots=<союзник1>.<союзник2>.<союзник3>.<союзник4>-<враг1>.<враг2>.<враг3>.<враг4>.<враг5>
//
// Герои — игровые persistentId (content/talent_data/persistent_ids.json, hero[webId-1]),
// в них только [A-Za-z0-9_], поэтому «.» и «-» как разделители безопасны.
//
// Героев союзных ботов выбирает игрок (клик по карточке бота в пати), выбор хранится
// в localStorage по аккаунту. Выбор ничем не ограничен: один и тот же герой может
// стоять у любого числа ботов и совпадать с героем игрока. Слот без выбора —
// случайный герой: он показан в пати и после запуска боя выбирается заново.
// Враги — случайные на каждый бой. Случайные герои не повторяются, как в обычном
// лобби (pw-api heroMirror.js): в своей команде герой один, в разных командах один
// и тот же герой — только если у него разрешена зеркалка.
//
// Кнопка «Тренировка» в билде героя (build/heroPanel.js) остаётся прежней
// тренировкой с манекенами: опция bots= уходит только из режима в списке.
//
// Пати: бой = все игроки пати + боты до 5 в их команде против 5 ботов, ботов в пати
// столько, сколько свободных мест (5 − игроков). Левый шлем в режиме убирает ботов-союзников
// совсем (alliesOff). Героев ботам выбирает лидер: его лаунчер отправляет состав в pw-api
// (mm.trainingBots: 4 героя, флаги «выбран», alliesOff), участники берут его из данных пати
// (trainingBots в PUpdate/loadParty, событие PTrainingBots). При старте бэкенд запускает
// тренировку на всю пати и присылает всем одну строку bots в MMEnd.

export const TRAINING_BOT_ALLIES = 4;
export const TRAINING_BOT_ENEMIES = 5;

const PID_RE = /^[A-Za-z0-9_]{1,64}$/;

// Запрос тренировки с ботами живёт недолго: MMEnd от бэкенда приходит за секунды.
// Устаревший не применяем, чтобы обычная тренировка не стала ботовой.
const PENDING_TTL_MS = 60000;

function heroIdOf(value) {
  const id = Math.trunc(Number(value));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

export class TrainingBots {
  // web id героя -> persistentId (индекс id-1); null — ещё не загружено
  static pids = null;

  static pidsPromise = null;

  // выбор игрока по слотам союзных ботов (0 — случайный герой), хранится по аккаунту
  static chosen = [0, 0, 0, 0];

  static chosenOwner = null;

  // случайные герои слотов без выбора — до следующего запуска боя
  static rolled = [0, 0, 0, 0];

  // левый шлем: true — без ботов-союзников (команда — только игроки пати)
  static alliesOff = false;

  // зеркалки, известные лаунчеру помимо heroAll (MM.lobbyMirror последнего лобби)
  static extraMirror = new Set();

  // { lineup: {allies, enemies}, at } — запуск тренировки с ботами из этого лаунчера
  static pending = null;

  static random = Math.random;

  static setPersistentIds(heroPids) {
    TrainingBots.pids = Array.isArray(heroPids) ? heroPids.map((pid) => String(pid || '')) : [];
  }

  static loadPersistentIds() {
    if (TrainingBots.pids) return Promise.resolve(TrainingBots.pids);
    if (!TrainingBots.pidsPromise) {
      TrainingBots.pidsPromise = fetch('content/talent_data/persistent_ids.json')
        .then((response) => response.json())
        .then((ids) => {
          TrainingBots.setPersistentIds(ids?.hero);
          return TrainingBots.pids;
        })
        .catch((error) => {
          TrainingBots.pidsPromise = null;
          throw error;
        });
    }
    return TrainingBots.pidsPromise;
  }

  static pid(heroId) {
    const id = heroIdOf(heroId);
    const pid = id && TrainingBots.pids ? TrainingBots.pids[id - 1] : '';
    return pid && PID_RE.test(pid) ? pid : '';
  }

  // Герои, которых можно дать ботам: есть в списке героев лаунчера (build.heroAll)
  // и у них известен игровой persistentId.
  static pool(heroes) {
    const ids = new Set();
    for (const hero of Array.isArray(heroes) ? heroes : []) {
      const id = heroIdOf(hero?.id);
      if (id && TrainingBots.pid(id)) ids.add(id);
    }
    return [...ids];
  }

  // Зеркалки: флаг mirror в heroAll (если бэкенд его отдаёт) или список последнего лобби.
  static mirrorSet(heroes) {
    const ids = new Set(TrainingBots.extraMirror);
    for (const hero of Array.isArray(heroes) ? heroes : []) {
      if (Number(hero?.mirror) === 1) ids.add(heroIdOf(hero.id));
    }
    return ids;
  }

  static setExtraMirror(ids) {
    TrainingBots.extraMirror = new Set([...(ids || [])].map(heroIdOf).filter(Boolean));
  }

  static storageKey(accountId) {
    return `trainingBotAllies:${accountId || 0}`;
  }

  static loadChoice(accountId) {
    const owner = String(accountId || 0);
    if (TrainingBots.chosenOwner === owner) return;
    TrainingBots.chosenOwner = owner;
    let saved = [];
    try {
      saved = JSON.parse(globalThis.localStorage?.getItem(TrainingBots.storageKey(owner)) || '[]');
    } catch {
      saved = [];
    }
    TrainingBots.chosen = Array.from({ length: TRAINING_BOT_ALLIES }, (_, i) => heroIdOf(Array.isArray(saved) ? saved[i] : 0));
    TrainingBots.rolled = Array(TRAINING_BOT_ALLIES).fill(0);
    try {
      TrainingBots.alliesOff = globalThis.localStorage?.getItem(`${TrainingBots.storageKey(owner)}:off`) === '1';
    } catch {
      TrainingBots.alliesOff = false;
    }
  }

  static saveChoice() {
    try {
      globalThis.localStorage?.setItem(TrainingBots.storageKey(TrainingBots.chosenOwner), JSON.stringify(TrainingBots.chosen));
    } catch {
      // нет localStorage (превью) — выбор живёт до перезапуска
    }
  }

  // Левый шлем в режиме: убрать / вернуть ботов-союзников.
  static setAlliesOff(off) {
    TrainingBots.alliesOff = Boolean(off);
    try {
      globalThis.localStorage?.setItem(`${TrainingBots.storageKey(TrainingBots.chosenOwner)}:off`, TrainingBots.alliesOff ? '1' : '0');
    } catch {
      // без localStorage — до перезапуска
    }
    return TrainingBots.alliesOff;
  }

  // Сколько ботов-союзников при humans игроках в команде.
  static allyCount(humans = 1) {
    if (TrainingBots.alliesOff) return 0;
    return Math.max(0, Math.min(TRAINING_BOT_ALLIES, 5 - Math.max(1, Math.trunc(Number(humans) || 1))));
  }

  static pickRandom(pool, used, random = TrainingBots.random) {
    const free = pool.filter((id) => !used.has(id));
    if (!free.length) return 0;
    return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  }

  // Союзные боты для пати и запуска: [{ hero, chosen }].
  //   count       — сколько ботов (по умолчанию все 4 слота лидера);
  //   teamHeroes  — герои остальных игроков пати (случайные боты их не повторяют).
  // Выбранные игроком — как есть (повторы разрешены), случайные — из героев, которых
  // в команде ещё нет, и держатся до запуска боя.
  static allies(myHeroId, heroes, options = {}) {
    const count = Math.max(0, Math.min(TRAINING_BOT_ALLIES, options.count ?? TRAINING_BOT_ALLIES));
    const pool = TrainingBots.pool(heroes);
    const poolSet = new Set(pool);
    const used = new Set([heroIdOf(myHeroId), ...(options.teamHeroes || []).map(heroIdOf)].filter(Boolean));
    const result = Array.from({ length: count }, () => ({ hero: 0, chosen: false }));

    for (let i = 0; i < count; i++) {
      const id = heroIdOf(TrainingBots.chosen[i]);
      if (id && poolSet.has(id)) {
        used.add(id);
        result[i] = { hero: id, chosen: true };
      }
    }

    for (let i = 0; i < count; i++) {
      if (result[i].chosen) continue;
      let id = heroIdOf(TrainingBots.rolled[i]);
      if (!id || !poolSet.has(id) || used.has(id)) id = TrainingBots.pickRandom(pool, used);
      TrainingBots.rolled[i] = id;
      if (id) used.add(id);
      result[i] = { hero: id, chosen: false };
    }

    return result;
  }

  // Игрок выбрал героя боту в слоте index; heroId 0 — «случайный герой». Любой герой
  // из пула, в том числе уже стоящий у других ботов или у самого игрока.
  static setAlly(index, heroId, heroes) {
    const slot = Math.trunc(Number(index));
    if (!(slot >= 0 && slot < TRAINING_BOT_ALLIES)) return false;
    const id = heroIdOf(heroId);
    if (id && !TrainingBots.pool(heroes).includes(id)) return false;

    // случайный бот с этим героем получит другого: случайные не повторяют команду
    if (id) TrainingBots.rolled = TrainingBots.rolled.map((value) => (heroIdOf(value) === id ? 0 : value));
    TrainingBots.chosen[slot] = id;
    TrainingBots.rolled[slot] = 0;
    TrainingBots.saveChoice();
    return true;
  }

  // Полный состав боя: союзники (как в пати) + 5 случайных врагов без повторов между собой.
  // Герой своей команды (игрок или бот) у врагов — только зеркалка. options — как у allies.
  static lineup(myHeroId, heroes, options = {}) {
    const allies = TrainingBots.allies(myHeroId, heroes, options).map((bot) => bot.hero).filter(Boolean);
    const pool = TrainingBots.pool(heroes);
    const mirror = TrainingBots.mirrorSet(heroes);
    const team = [heroIdOf(myHeroId), ...(options.teamHeroes || []).map(heroIdOf), ...allies];
    const used = new Set(team.filter((id) => id && !mirror.has(id)));
    const enemies = [];
    for (let i = 0; i < TRAINING_BOT_ENEMIES; i++) {
      const id = TrainingBots.pickRandom(pool, used);
      if (!id) break;
      used.add(id);
      enemies.push(id);
    }
    return { allies, enemies };
  }

  static protocolValue(lineup) {
    const part = (ids) => (ids || []).map((id) => TrainingBots.pid(id)).filter(Boolean).join('.');
    const allies = part(lineup?.allies);
    const enemies = part(lineup?.enemies);
    return enemies ? `${allies}-${enemies}` : '';
  }

  // «В бой!» в режиме «Тренировка»: следующий MMEnd режима 99 — бой с ботами.
  // Случайные союзники этого боя зафиксированы в составе, к следующему — новые.
  static arm(myHeroId, heroes, options = {}) {
    const lineup = TrainingBots.lineup(myHeroId, heroes, options);
    TrainingBots.pending = TrainingBots.protocolValue(lineup) ? { lineup, at: Date.now() } : null;
    TrainingBots.rolled = Array(TRAINING_BOT_ALLIES).fill(0);
    return TrainingBots.pending;
  }

  static disarm() {
    TrainingBots.pending = null;
  }

  // ---- состав ботов пати (pw-api: mm.trainingBots, PTrainingBots, trainingBots в PUpdate)

  // id пати -> { allies: [4 web id], chosen: [4 bool], alliesOff }
  static party = new Map();

  static setPartySettings(partyId, value) {
    const id = String(partyId || '');
    if (!id) return;
    if (!value || typeof value !== 'object') {
      TrainingBots.party.delete(id);
      return;
    }
    const allies = Array.from({ length: TRAINING_BOT_ALLIES }, (_, i) => heroIdOf(value.allies?.[i]));
    TrainingBots.party.set(id, {
      allies,
      chosen: allies.map((hero, i) => Boolean(hero && value.chosen?.[i])),
      alliesOff: Boolean(value.alliesOff),
    });
  }

  // Что лидер отправляет в pw-api: 4 слота (выбранные и уже подставленные случайные).
  static settingsPayload(bots) {
    const allies = Array.from({ length: TRAINING_BOT_ALLIES }, (_, i) => heroIdOf(bots?.[i]?.hero));
    return { allies, chosen: allies.map((hero, i) => Boolean(hero && bots?.[i]?.chosen)), alliesOff: TrainingBots.alliesOff };
  }

  static sameAsParty(partyId, payload) {
    const current = TrainingBots.party.get(String(partyId || ''));
    return Boolean(current) && JSON.stringify(current) === JSON.stringify(payload);
  }

  // Боты для участника пати (не лидера): как задал лидер; без данных — пустые «случайные».
  static partyAllies(partyId, humans) {
    const settings = TrainingBots.party.get(String(partyId || ''));
    if (settings?.alliesOff) return [];
    const count = Math.max(0, Math.min(TRAINING_BOT_ALLIES, 5 - Math.max(1, humans)));
    return Array.from({ length: count }, (_, i) => ({ hero: settings?.allies[i] || 0, chosen: Boolean(settings?.chosen[i]) }));
  }

  // Опция запуска из MMEnd: состав от pw-api (data.bots, один на всю пати), иначе запасной
  // локальный (takeProtocolToken). Строку бэкенда проверяем: только persistentId, «.» и «-».
  static protocolToken(data) {
    const fallback = TrainingBots.takeProtocolToken(data?.mode);
    const value = String(data?.bots || '');
    if (Number(data?.mode) === 99 && /^[A-Za-z0-9_.]*-[A-Za-z0-9_.]+$/.test(value) && value.length <= 1024) {
      return `/bots=${value}`;
    }
    return fallback;
  }

  // Токен строки запуска для MMEnd (MM.finish): «/bots=…» только для тренировки (99),
  // запущенной из этого лаунчера кнопкой режима; запрос одноразовый.
  static takeProtocolToken(mode) {
    const pending = TrainingBots.pending;
    if (Number(mode) !== 99 || !pending) return '';
    TrainingBots.pending = null;
    if (Date.now() - pending.at > PENDING_TTL_MS) return '';
    const value = TrainingBots.protocolValue(pending.lineup);
    return value ? `/bots=${value}` : '';
  }
}
