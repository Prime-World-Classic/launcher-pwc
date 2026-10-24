// Окно билда <-> данные игры (clientData): подсказка таланта как в клиенте и статы героя
// из его HROB. Числа подсказки считаются формулами игры от героя билда: статы — как в
// панели статов (Build.totalStat), «родная земля» — переключатель билда, tal()/talconst()
// — таланты, стоящие в билде. Нет данных игры — Build показывает прежние тексты lang.

import { ClientData } from './clientData/clientData.js';
import { TalentTooltip } from './clientData/talentTooltip.js';
import { runFormula } from './clientData/formula.js';
import { textAt, dbidToKey } from './clientData/xdb.js';
import { ddsToDataUrl } from './clientData/dds.js';
import { Lang } from './lang.js';
import { PreloadImages } from './preloadImages.js';

// Стат игры (аксессор без Get) -> ключ стата лаунчера
const STAT_KEYS = {
  Life: 'hp',
  MaxLife: 'hp',
  Energy: 'mp',
  MaxEnergy: 'mp',
  Strength: 'sila',
  Intellect: 'razum',
  Dexterity: 'hitrost',
  AttackSpeed: 'provorstvo',
  Stamina: 'stoikost',
  Will: 'volia',
  MoveSpeed: 'speed',
  LifeRegenAbs: 'regenhp',
  EnergyRegenAbs: 'regenmp',
  LifeDrain: 'krajahp',
  EnergyDrain: 'krajamp',
};

// statId в HROB -> ключ стата лаунчера (строка героя в БД: «база,прирост,ключ»)
const HERO_STAT_KEYS = {
  Life: 'hp',
  Energy: 'mp',
  Strength: 'sila',
  Intellect: 'razum',
  Dexterity: 'hitrost',
  AttackSpeed: 'provorstvo',
  Stamina: 'stoikost',
  Will: 'volia',
  MoveSpeed: 'speed',
  LifeRegenerationAbsolute: 'regenhp',
  EnergyRegenerationAbsolute: 'regenmp',
  LifeDrain: 'krajahp',
  EnergyDrain: 'krajamp',
};

// Статы с галочкой в панели героя (Build.profileStats): EStat -> ключ лаунчера
const PROFILE_STAT_KEYS = {
  Strength: 'sila',
  Intellect: 'razum',
  AttackSpeed: 'provorstvo',
  Dexterity: 'hitrost',
  Stamina: 'stoikost',
  Will: 'volia',
};

// EStat (DBStats.h) — номер для IsRecommended(n)
const ESTAT = [
  'Life', 'Energy', 'Range', 'MoveSpeed', 'AttackSpeed', 'CriticalChance', 'CriticalMultiplier', 'LifeDrain',
  'EnergyDrain', 'Evasion', 'LifeRegeneration', 'LifeRegenerationAbsolute', 'EnergyRegeneration',
  'EnergyRegenerationAbsolute', 'VisibilityRange', 'Strength', 'Intellect', 'Dexterity', 'BaseAttack', 'Stamina', 'Will',
];

const EMPTY_CONTEXT = {
  unit: () => null,
  misc: () => null,
  call: () => 0,
  variable: () => 0,
  constant: (name) => (ClientData.globals?.consts?.[name] ? runFormula(ClientData.globals.consts[name].src, EMPTY_CONTEXT) : 0),
  object: () => null,
  scale: () => 0,
  refineRate: () => 1,
  hasTalent: () => false,
  talentRefineRate: () => null,
  talentConstant: () => 0,
  nativeTerrain: () => false,
};

// Пары «Сила или Разум» и т. п.: условие в данных игры выбирает стат по рекомендованным
// статам героя (_commonData/conditionFormula_StrOrInt…); в лаунчере это составной стат.
const STAT_PAIRS = [
  { condition: /IsRecommended\(15\)>pFirst->IsRecommended\(16\)/, stats: ['Strength', 'Intellect'], key: 'sr' },
  { condition: /IsRecommended\(19\)>pFirst->IsRecommended\(20\)/, stats: ['Stamina', 'Will'], key: 'sv' },
  { condition: /IsRecommended\(4\)>pFirst->IsRecommended\(17\)/, stats: ['AttackSpeed', 'Dexterity'], key: 'ph' },
];

// Статы талантов не зависят от героя: формулы — refineScale, константы, бюджеты
const NEUTRAL_HERO = {
  stat: () => 0,
  isRecommended: () => false,
  hasTalent: () => false,
  talentRefineRate: () => null,
  nativeTerrain: () => false,
};

export class BuildClientTooltip {
  static heroData = null; // ClientData.hero текущего героя билда
  static _statsCache = new WeakMap(); // талант -> clientStats

  static lang() {
    return Lang.target === 'en' ? 'en' : 'ru';
  }

  static available(talentId) {
    return ClientData.hasTalent(talentId);
  }

  static refineRate(Build, talent) {
    const rarity = Number(talent?.rarity) || 4; // классовые — как самые редкие
    return Build.talentRefineByRarity[rarity] ?? 5;
  }

  // Статы героя из его HROB в формате бэкенда: stats[ключ] = база, statModifiers[ключ] = прирост.
  // Ключи, которых нет в данных игры, остаются как пришли с сервера.
  static async applyHeroStats(hero, heroId) {
    BuildClientTooltip.heroData = null;
    if (!(await ClientData.init())) return false;
    return BuildClientTooltip.applyHeroData(hero, await ClientData.hero(heroId));
  }

  // Подготовка окна билда без ожидания, если данные игры уже прочитаны (после прогрева —
  // всегда): статы героя и таланты списка. false — данных ещё нет, нужно await prepare().
  // Build.init очищает Build.talents до этого шага, поэтому лишнее ожидание оставляло
  // на экране старые иконки без данных («Не найден талант в билде»).
  static prepareSync(hero, heroId, items) {
    if (!BuildClientTooltip.talentsReady(items)) return false;
    if (ClientData.ready && !ClientData.loadedHeroes.has(Number(heroId))) return false;
    BuildClientTooltip.heroData = null;
    if (!ClientData.ready) return true;
    BuildClientTooltip.applyHeroData(hero, ClientData.loadedHeroes.get(Number(heroId)));
    return true;
  }

  // данные игры для талантов списка прочитаны (или их нет вовсе) — ждать нечего
  static talentsReady(items) {
    if (!ClientData.settled) return false;
    if (!ClientData.ready) return true;
    return (items || []).every((item) => {
      const id = Number(item?.id);
      return !id || !BuildClientTooltip.available(id) || ClientData.done.has(id);
    });
  }

  static async prepare(hero, heroId, items) {
    await Promise.all([BuildClientTooltip.applyHeroStats(hero, heroId), BuildClientTooltip.prepareTalents(items)]);
  }

  static applyHeroData(hero, data) {
    if (!data) return false;
    BuildClientTooltip.heroData = data;
    hero.stats = hero.stats || {};
    hero.statModifiers = hero.statModifiers || {};
    for (const [statId, stat] of Object.entries(data.stats)) {
      const key = HERO_STAT_KEYS[statId];
      if (!key) continue;
      // формулы игры считаются во float32 (3.3 -> 3.2999999523) — округляем как в данных
      const round = (value) => Math.round(value * 10000) / 10000;
      if (stat.value) hero.stats[key] = String(round(runFormula(stat.value.src, EMPTY_CONTEXT)));
      if (stat.increment) hero.statModifiers[key] = round(runFormula(stat.increment.src, EMPTY_CONTEXT));
    }
    return true;
  }

  static heroModel(Build) {
    const installed = new Map(); // pid -> талант билда
    for (const talent of Build.installedTalents || []) {
      const pid = talent && ClientData.pidOf(talent.id);
      if (pid) installed.set(pid, talent);
    }
    const recommended = new Set(BuildClientTooltip.heroData?.recommended || []);
    const baseStat = (key) => (Number(Build.initialStats?.[key]) || 0) + (Number(Build.heroStatsFromPower?.[key]) || 0);
    return {
      stat(name) {
        if (name === 'NaftaLevel') return 0;
        if (name.startsWith('Base')) {
          const key = STAT_KEYS[name.slice(4)];
          return key ? baseStat(key) : null;
        }
        const key = STAT_KEYS[name];
        return key ? Build.totalStat(key) : null;
      },
      // «рекомендуемый стат» (галочка в подсказке, выбор Сила/Разум и т. п.) — по галочкам статов
      // в панели героя; для статов без галочки (Здоровье, Энергия…) — рекомендация героя из игры
      isRecommended: (index) => {
        const key = PROFILE_STAT_KEYS[ESTAT[index]];
        if (key) return Number(Build.profileStats?.[key]) === 1;
        return recommended.has(ESTAT[index]);
      },
      hasTalent: (pid) => installed.has(pid),
      // таланты билда с заточкой — для переменных героя (счётчики наборов и т. п.)
      talents: () => [...installed.values()].map((talent) => ({ id: Number(talent.id), refineRate: BuildClientTooltip.refineRate(Build, talent) })),
      talentRefineRate: (pid) => (installed.has(pid) ? BuildClientTooltip.refineRate(Build, installed.get(pid)) : null),
      nativeTerrain: () => !!Build.applyRz,
      isMale: () => true,
    };
  }

  // HTML подсказки таланта (рамка, шрифт и стили игры) или null, если данных игры нет.
  // frame: false — без рамки, для вставки в другую панель (описание сета)
  static async render(Build, talent, { frame = true } = {}) {
    if (!BuildClientTooltip.available(talent?.id)) return null;
    await TalentTooltip.installStyles();
    const state = {
      refineRate: BuildClientTooltip.refineRate(Build, talent),
      level: Math.max(0, (Number(talent.level) || 1) - 1),
      bought: true,
      inBuild: (Build.installedTalents || []).some((item) => item && Number(item.id) === Number(talent.id)),
    };
    const tooltip = await TalentTooltip.create(talent.id, BuildClientTooltip.heroModel(Build), state, BuildClientTooltip.lang());
    if (!tooltip) return null;
    const html = await tooltip.html();
    return `<div class="pw-tt${frame ? ' pw-tt-frame' : ''}">${html}</div>`;
  }

  // Описание сета как в игре: набор игры, в который входит главный талант сета (название,
  // «собрано N», бонусы). Таланта нет ни в одном наборе игры — null.
  static async renderSet(Build, talent) {
    if (!BuildClientTooltip.available(talent?.id)) return null;
    await TalentTooltip.installStyles();
    const state = {
      refineRate: BuildClientTooltip.refineRate(Build, talent),
      level: Math.max(0, (Number(talent.level) || 1) - 1),
      bought: true,
      inBuild: (Build.installedTalents || []).some((item) => item && Number(item.id) === Number(talent.id)),
    };
    const tooltip = await TalentTooltip.create(talent.id, BuildClientTooltip.heroModel(Build), state, BuildClientTooltip.lang());
    const html = await tooltip?.kitHtml();
    return html ? `<div class="pw-tt">${html}</div>` : null;
  }

  // Золотая черта-разделитель подсказки игры ($(TTline) — картинка TTline), если она загружена
  static separatorHtml() {
    const line = TalentTooltip.imageHtml('TTline');
    return line ? `<div class="pw-tt-center pw-tt-separator">${line}</div>` : '';
  }

  // Название набора игры для таланта, если он уже прочитан, иначе null
  static loadedKitName(talentId) {
    if (!ClientData.ready) return null;
    const talent = ClientData.loaded.get(Number(talentId));
    const kit = talent && ClientData.globals?.kitByTalent?.get(talent.key);
    // у наборов с заглушкой вместо названия — имя таланта (loadedName)
    return kit?.named ? kit.name[BuildClientTooltip.lang()] || kit.name.ru || null : null;
  }

  // --- Статы талантов -------------------------------------------------------------------

  // Прочитать данные игры для талантов списка заранее (enrichStats работает синхронно)
  static async prepareTalents(items) {
    if (!(await ClientData.init())) return;
    const ids = (items || []).map((item) => Number(item?.id)).filter((id) => id && BuildClientTooltip.available(id));
    await Promise.all(ids.map((id) => ClientData.talent(id)));
  }

  // Статы таланта по данным игры: { ключ лаунчера: [значение при заточке 1, прирост за заточку] }.
  // Берутся постоянные модификаторы статов (PermanentStatModApplicator): безусловные и пары
  // «по рекомендованному стату героя» (-> составные sr / sv / ph, их лаунчер выбирает сам).
  static clientStats(talent) {
    if (BuildClientTooltip._statsCache.has(talent)) return BuildClientTooltip._statsCache.get(talent);
    const tooltip = new TalentTooltip(talent, NEUTRAL_HERO, { refineRate: 1 }, 'ru');
    const result = {};
    for (const mod of talent.statMods || []) {
      if (mod.variable || !mod.add) continue;
      const enabled = String(mod.enabled?.src || 'true').replace(/\s+/g, '');
      let key = null;
      let pair = null;
      if (enabled === 'true') key = HERO_STAT_KEYS[mod.stat];
      else {
        pair = STAT_PAIRS.find((item) => item.condition.test(enabled) && item.stats.includes(mod.stat));
        key = pair?.key ?? null;
      }
      // скорость у лаунчера не суммируется (берётся наибольшая) и приходит из txtNum
      if (!key || key === 'speed') continue;
      const atRefine1 = tooltip.evaluate(talent, 1, mod.add);
      const atRefine2 = tooltip.evaluate(talent, 2, mod.add);
      if (!atRefine1 && !atRefine2) continue;
      if (pair && key in result) continue; // вторая половина пары — то же значение
      const prev = result[key] || [0, 0];
      result[key] = [prev[0] + atRefine1, prev[1] + (atRefine2 - atRefine1)];
    }
    BuildClientTooltip._statsCache.set(talent, result);
    return result;
  }

  // Подставить статы из данных игры в предметы списка (после TalentData.enrich).
  // Ключи, которых в данных игры нет (родная земля, стаки, баффы…), остаются из talent_data.
  static enrichStats(items) {
    if (!ClientData.ready || !Array.isArray(items)) return items;
    const round = (value) => Math.round(value * 10000) / 10000;
    for (const item of items) {
      const id = Number(item?.id);
      if (!(id > 0)) continue;
      const talent = ClientData.loaded.get(id);
      if (!talent) continue;
      const stats = BuildClientTooltip.clientStats(talent);
      if (!Object.keys(stats).length) continue;
      // копии: TalentData.enrich кладёт в предмет общие объекты talent_data
      item.stats = item.stats && typeof item.stats === 'object' ? { ...item.stats } : {};
      item.statsRefine = item.statsRefine && typeof item.statsRefine === 'object' ? { ...item.statsRefine } : {};
      for (const [key, [value, refine]] of Object.entries(stats)) {
        item.stats[key] = String(round(value));
        item.statsRefine[key] = String(round(refine));
      }
    }
    return items;
  }

  // Иконка таланта из данных игры (image -> ITEX -> .dds) — для талантов без content/talents/<id>.webp
  static _icons = new Map();

  static iconUrl(talentId) {
    const id = Number(talentId);
    if (!BuildClientTooltip.available(id)) return null;
    if (!BuildClientTooltip._icons.has(id)) {
      BuildClientTooltip._icons.set(
        id,
        (async () => {
          const talent = await ClientData.talent(id);
          const texture = talent?.image ? await ClientData.xdb(dbidToKey(talent.image)) : null;
          const file = textAt(texture, 'textureFileName');
          const bytes = file ? await ClientData.fs.read(file) : null;
          return bytes ? ddsToDataUrl(bytes) : null;
        })().catch(() => null),
      );
    }
    return BuildClientTooltip._icons.get(id);
  }

  // Имя таланта из данных игры, если он уже прочитан (поиск по библиотеке, сеты), иначе null
  static loadedName(talentId) {
    return ClientData.ready ? ClientData.talentName(talentId, BuildClientTooltip.lang()) : null;
  }
}

PreloadImages.fallbacks.clientTalentIcon = (element) => BuildClientTooltip.iconUrl(element.dataset.id);
