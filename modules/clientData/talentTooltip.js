// Подсказка таланта как в игре: текст, формулы и условия из данных клиента (ClientData),
// числа — от героя лаунчера (статы билда, родная земля, таланты в билде).
//
// hero — адаптер героя лаунчера (см. Build.clientHeroModel):
//   stat(name)                 стат по имени аксессора игры без Get: Strength, MaxLife, BaseWill…
//   isRecommended(statIndex)   рекомендованный стат героя (EStat)
//   hasTalent(pid)             талант с таким persistentId стоит в билде
//   talentRefineRate(pid)      заточка таланта билда (null — нет в билде)
//   nativeTerrain()            «на родной земле» (переключатель лаунчера)
//   isMale()
//   talents()                  [{ id, refineRate }] талантов билда (переменные героя sender.vX)
// state — { refineRate, level (ряд таланта, 0…5), bought, inBuild (талант стоит в билде — для наборов) }

import { ClientData, ABILITY_TYPES } from './clientData.js';
import { runFormula, abilityScale } from './formula.js';
import { precompileMarkup, renderUiMarkup, formatValue, escapeHtml } from './tooltipMarkup.js';
import { ddsToDataUrl } from './dds.js';

const ABILITYFLAGS_SPENDLIFE = 16384;
const RARITY_INDEX = { Class: 0, class: 0, ordinary: 1, good: 2, excellent: 3, magnificent: 4, exclusive: 5, outstanding: 6 };
const EXTRA_REFS = /\b(?:talconst|talconstNoCheck|stalconst|tal|getTalentRefineRate)\s*\(\s*"([^"]+)"/g;
const MAX_DEPTH = 24;

// Макросы UIRoot со значком «рекомендуемый стат» для статов с галочкой в лаунчере
const RECOMMEND_MACROS = {
  Strength: 'TTRecommendedStrength',
  Intellect: 'TTRecommendedIntellect',
  AttackSpeed: 'TTRecommendedAttackSpeed',
  Dexterity: 'TTRecommendedDexterity',
  Stamina: 'TTRecommendedStamina',
  Will: 'TTRecommendedWill',
};
// EStat этих статов — для IsRecommended(n)
const RECOMMEND_STAT_INDEX = { Strength: 15, Intellect: 16, AttackSpeed: 4, Dexterity: 17, Stamina: 19, Will: 20 };
// Условия выбора стата пары для макросов TTRecommendedStrOrInt и т. п., если у таланта их нет
// (формулы — Items/Talents/_commonData/conditionFormula_StrOrInt/StaOrWill/AspdOrDex)
const pairCondition = (a, b, baseA, baseB) => ({
  src: `(pFirst->IsRecommended(${a}) > pFirst->IsRecommended(${b}) ? 1 : pFirst->IsRecommended(${a}) < pFirst->IsRecommended(${b}) ? 0 : s${baseA}>=s${baseB})`,
  type: 'bool',
});
const FALLBACK_CONDS = {
  StrOrInt: pairCondition(15, 16, 'BaseStrength', 'BaseIntellect'),
  StaOrWill: pairCondition(19, 20, 'BaseStamina', 'BaseWill'),
  SpdOrDex: pairCondition(4, 17, 'BaseAttackSpeed', 'BaseDexterity'),
  StrengthGeqIntellect: { src: 'sStrength >= sIntellect', type: 'bool' },
  StaminaGeqWill: { src: 'sStamina >= sWill', type: 'bool' },
  AttackSpeedGeqDexterity: { src: 'sAttackSpeed >= sDexterity', type: 'bool' },
};
// Пары «наибольший из …»: условие выбора стата по рекомендациям (_commonData/conditionFormula_*)
const RECOMMEND_PAIRS = [
  { condition: /IsRecommended\(15\)>pFirst->IsRecommended\(16\)/, macro: 'TTRecommendedStrOrInt' },
  { condition: /IsRecommended\(19\)>pFirst->IsRecommended\(20\)/, macro: 'TTRecommendedStaOrWill' },
  { condition: /IsRecommended\(4\)>pFirst->IsRecommended\(17\)/, macro: 'TTRecommendedSpdOrDex' },
];

// Формулы таланта, которые подсказка может вычислить (для предзагрузки чужих талантов)
function formulaSources(talent) {
  const list = [talent.manaCost?.src, talent.cooldown?.src];
  for (const value of Object.values(talent.consts)) list.push(value?.src);
  for (const value of Object.values(talent.conds)) list.push(value?.src);
  return list.filter(Boolean);
}

export class TalentTooltip {
  static images = new Map(); // имя -> Promise<{ url, width, height } | null>
  static stylesInstalled = false;

  constructor(talent, hero, state = {}, lang = 'ru') {
    this.talent = talent;
    this.hero = hero;
    this.state = state;
    this.lang = lang;
    this.others = new Map(); // pid -> талант (talconst)
    this.unknown = new Set();
    this.stack = [];
  }

  static async create(webId, hero, state, lang) {
    const talent = await ClientData.talent(webId);
    if (!talent) return null;
    const tooltip = new TalentTooltip(talent, hero, state, lang);
    await tooltip.preload();
    return tooltip;
  }

  async preload() {
    const pids = new Set();
    for (const src of formulaSources(this.talent)) for (const m of src.matchAll(EXTRA_REFS)) pids.add(m[1]);
    pids.delete(this.talent.pid);
    await Promise.all(
      [...pids].map(async (pid) => {
        const other = await ClientData.talentByPid(pid).catch(() => null);
        if (other) this.others.set(pid, other);
      }),
    );
  }

  // --- Контекст формул ------------------------------------------------------------------

  context(talent = this.talent, refineRate = this.state.refineRate) {
    const self = this;
    const heroObj = { kind: 'hero' };
    const miscObj = { kind: 'misc' };
    return {
      unknown: this.unknown,
      unit: () => heroObj,
      misc: () => miscObj,
      call(obj, name, args) {
        if (obj === heroObj) return self.heroCall(name, args);
        // у способности (PFAbilityData) GetObjectParent() — она сама
        if (obj === miscObj && name === 'ObjectParent') return miscObj;
        if (obj === miscObj) return self.miscCall(talent, refineRate, name, args);
        self.unknown.add(`?.${name}`);
        return 0;
      },
      variable(obj, name) {
        // переменная героя (sender.vX): её выставляют постоянные модификаторы талантов билда
        if (obj === heroObj) {
          const value = self.heroVariable(name);
          if (value !== null) return value;
        }
        self.unknown.add(`v${name}`);
        return 0;
      },
      constant: (name) => this.constant(talent, refineRate, name),
      object(obj, name) {
        if (name === 'Owner') return heroObj;
        self.unknown.add(`o${name}`);
        return null;
      },
      scale: (isDamage, mode, stat, left, right, round) => abilityScale(ClientData.globals?.scaling, isDamage, mode, stat, left, right, round),
      refineRate: () => refineRate,
      hasTalent: (pid) => pid === talent.pid || !!(this.hero.hasUpgrade || this.hero.hasTalent)(pid),
      talentRefineRate: (pid) => this.hero.talentRefineRate(pid),
      talentConstant: (pid, name) => {
        const other = pid === talent.pid ? talent : this.others.get(pid);
        if (!other) {
          this.unknown.add(`talconst(${pid})`);
          return 0;
        }
        return this.constant(other, this.hero.talentRefineRate(pid) ?? refineRate, name);
      },
      nativeTerrain: () => !!this.hero.nativeTerrain(),
    };
  }

  // Переменная героя, как её выставил бы бой: сумма PermanentStatModApplicator с <variable>
  // у талантов билда (счётчики наборов vSeaSymbolKitCounter, флаги улучшений vG793_active…).
  // null — такую переменную ни один талант билда не задаёт. Сам талант считается изученным.
  heroVariable(name) {
    if (!this._heroVariables) {
      this._heroVariables = new Map();
      const talents = this.hero.talents?.() || [];
      const selfId = Number(this.talent.webId);
      if (this.hero.talents && Number.isFinite(selfId) && !talents.some((item) => Number(item.id) === selfId)) {
        talents.push({ id: selfId, refineRate: this.state.refineRate });
      }
      for (const { id, refineRate } of talents) {
        const talent = ClientData.loaded.get(Number(id));
        for (const mod of talent?.statMods || []) {
          if (!mod.variable || !mod.add) continue;
          if (mod.enabled && !this.evaluate(talent, refineRate, mod.enabled, 'bool')) continue;
          const value = this.evaluate(talent, refineRate, mod.add);
          this._heroVariables.set(mod.variable, (this._heroVariables.get(mod.variable) || 0) + value);
        }
      }
    }
    return this._heroVariables.has(name) ? this._heroVariables.get(name) : this.hero.talents ? 0 : null;
  }

  heroCall(name, args) {
    switch (name) {
      case 'IsRecommended':
        return !!this.hero.isRecommended(args[0]);
      case 'UnitCheck':
        return args[0] === 0; // UNITCHECKID_ISHERO
      case 'IsHero':
        return true;
      case 'IsMale':
        return !!this.hero.isMale?.();
      case 'GetTalent':
        return null;
      default: {
        const value = this.hero.stat(name);
        if (value === undefined || value === null) {
          this.unknown.add(`s${name}`);
          return 0;
        }
        return value;
      }
    }
  }

  miscCall(talent, refineRate, name) {
    switch (name) {
      case 'RefineRate':
        return refineRate;
      case 'TalentLevel':
        return this.state.level ?? 0;
      case 'Rank':
        return (this.state.level ?? 0) + 1;
      case 'AbilityType':
        return ABILITY_TYPES[talent.type] ?? 3;
      case 'ManaCost':
        return this.evaluate(talent, refineRate, talent.manaCost);
      case 'Cooldown':
        return this.evaluate(talent, refineRate, talent.cooldown);
      case 'TalentDevPoints':
        return talent.devPoints;
      case 'NaftaCost':
        return Math.max(0, talent.naftaCost);
      case 'IsTalentBought':
        return true;
      case 'IsAbilityOn':
        return false;
      case 'ActivatedWithinKit':
        return talent === this.talent ? this.activatedInKit() : 0;
      case 'TalentsWithinKit':
        return talent === this.talent ? this.kit()?.talents.length ?? 0 : 0;
      case 'ScrollLevel':
        return 0;
      case 'IsNight':
        return false;
      case 'Scale':
        return 1; // PFAbilityData::GetScale без модификаторов масштаба
      default:
        this.unknown.add(`m${name}`);
        return 0;
    }
  }

  evaluate(talent, refineRate, formula, type) {
    if (!formula) return 0;
    if (this.stack.length > MAX_DEPTH) {
      this.unknown.add('рекурсия');
      return 0;
    }
    this.stack.push(formula);
    try {
      return runFormula(formula.src, this.context(talent, refineRate), type || formula.type || 'float');
    } finally {
      this.stack.pop();
    }
  }

  constant(talent, refineRate, name) {
    const formula = talent.consts[name] || ClientData.globals?.consts?.[name];
    if (!formula) {
      this.unknown.add(`c${name}`);
      return 0;
    }
    return this.evaluate(talent, refineRate, formula);
  }

  condition(name) {
    const formula = this.talent.conds[name] || ClientData.globals?.conds?.[name] || FALLBACK_CONDS[name];
    if (!formula) return null;
    return !!this.evaluate(this.talent, this.state.refineRate, formula, 'bool');
  }

  // --- Набор талантов (talentKits) ------------------------------------------------------

  kit() {
    return ClientData.globals?.kitByTalent?.get(this.talent.key) || null;
  }

  // сколько талантов набора стоит в билде (в замке игра пишет «собрано N»)
  activatedInKit() {
    const kit = this.kit();
    if (!kit) return 0;
    return kit.talents.filter((key) => {
      const pid = ClientData.pidByKey(key);
      return pid && (pid === this.talent.pid ? this.state.inBuild ?? true : this.hero.hasTalent(pid));
    }).length;
  }

  // --- Значения разметки ----------------------------------------------------------------

  rarityIndex() {
    return RARITY_INDEX[this.talent.rarity] ?? 0;
  }

  cond(path) {
    const t = this.talent;
    if (path.startsWith('talent.if.')) return this.condition(path.slice(10));
    // лаунчер: отмечен ли любой из статов (talent.recommendedAny.15_16_17)
    if (path.startsWith('talent.recommendedAny.')) return path.slice(22).split('_').some((index) => this.hero.isRecommended(Number(index)));
    // сравнение значения из NameMap с числом или другим значением:
    // talent.activatedInKit.greaterOrEqual.2, talent.activatedInKitWithoutSelf.greater.talent.kitCapacity
    const compare = /^(.+?)\.(greaterOrEqual|greater|lessOrEqual|less|equal|notEqual)\.(.+)$/.exec(path);
    if (compare) {
      const value = this.value(compare[1]);
      const limit = /^-?\d+(?:\.\d+)?$/.test(compare[3]) ? Number(compare[3]) : this.value(compare[3]);
      if (typeof value !== 'number' || typeof limit !== 'number') return null;
      return { greaterOrEqual: value >= limit, greater: value > limit, lessOrEqual: value <= limit, less: value < limit, equal: value === limit, notEqual: value !== limit }[compare[2]];
    }
    switch (path) {
      case 'talent.isBought':
        return this.state.bought ?? true;
      case 'talent.spendsLife':
        return !!(t.flags & ABILITYFLAGS_SPENDLIFE);
      case 'talent.isClass':
        return this.rarityIndex() === 0;
      case 'talent.isOrdinary':
        return this.rarityIndex() === 1;
      case 'talent.isGood':
        return this.rarityIndex() === 2;
      case 'talent.isExcellent':
        return this.rarityIndex() === 3;
      case 'talent.isMagnificent':
        return this.rarityIndex() === 4;
      case 'talent.isExclusive':
        return this.rarityIndex() === 5;
      case 'talent.isInKit':
        return !!this.kit();
      case 'talent.isSpecialInKit':
        return !!this.kit() && this.kit().special === t.key;
      case 'talent.isInPack':
      case 'talent.isInGroup':
      case 'talent.mConsumptionBonusPercent':
        return false;
      default:
        return null;
    }
  }

  value(path, params) {
    const t = this.talent;
    if (path.startsWith('talent.const.')) return this.constant(t, this.state.refineRate, path.slice(13));
    if (path.startsWith('unit.')) return this.heroCall(path.slice(5), []);
    switch (path) {
      case 'talent.cooldown':
        // <cd> — лаунчер пересчитывает откат с бонусами билда
        return `<cd>${formatValue(this.evaluate(t, this.state.refineRate, t.cooldown), params?.format)}</cd>`;
      case 'talent.manaCost':
        return this.evaluate(t, this.state.refineRate, t.manaCost);
      case 'talent.refineRate':
        return this.state.refineRate;
      case 'talent.rank':
        return (this.state.level ?? 0) + 1;
      case 'talent.devPoints':
        return t.devPoints;
      case 'talent.minLevel':
        return t.minLevel;
      case 'talent.abilityName':
      case 'talent.name':
        return this.name();
      case 'talent.rarityName':
        return ClientData.ui?.rarityNames?.[this.lang]?.[this.rarityIndex()] ?? '';
      case 'talent.kitName':
        return this.kitName();
      case 'talent.activatedInKit':
        return this.kit() ? this.activatedInKit() : null;
      case 'talent.totalInKit':
        return this.kit()?.talents.length ?? null;
      case 'talent.activatedInKitWithoutSelf':
        return this.kit() ? this.activatedInKit() - (this.state.inBuild ?? true ? 1 : 0) : null;
      case 'talent.kitCapacity':
        return this.kit()?.capacity ?? null;
      default:
        return null;
    }
  }

  name() {
    return (this.talent.texts[this.lang]?.name || this.talent.texts.ru?.name || '').trim();
  }

  macros() {
    const texts = this.talent.texts[this.lang] || this.talent.texts.ru;
    return { ...(ClientData.ui?.macros?.[this.lang] || {}), commonDescription: this.markRecommended(texts.commonDescription || '') };
  }

  // Строка стата без значка рекомендации ($(TTNone) +<значение константы> Хитрости): если константа —
  // бонус к одному из статов с галочкой в лаунчере (Сила, Разум, Проворство, Хитрость, Стойкость,
  // Воля или пара «наибольший из …»), ставим макрос рекомендации этого стата, чтобы галочка
  // показывалась по галочкам статов билда, как у остальных талантов
  markRecommended(text) {
    if (!text || text.indexOf('$(TTNone)') === -1) return text;
    return text.replace(/\$\(TTNone\)(\s*<style:TT_MARK>\s*\+?\s*<value=talent\.const\.(\w+))/g, (match, rest, name) => {
      const mark = this.recommendMarkup(name);
      return mark ? `${mark}${rest}` : match;
    });
  }

  // Значок для бонуса константы: один стат — макрос его рекомендации, пара — макрос пары,
  // несколько статов («ко всем характеристикам») — галочка, если отмечен любой из них
  recommendMarkup(constName) {
    const stats = new Set();
    for (const mod of this.talent.statMods || []) {
      if (mod.variable || String(mod.add?.src || '').replace(/\s+/g, '') !== `c${constName}`) continue;
      const enabled = String(mod.enabled?.src || 'true').replace(/\s+/g, '');
      if (enabled !== 'true') {
        const pair = RECOMMEND_PAIRS.find((item) => item.condition.test(enabled));
        if (pair) return `$(${pair.macro})`;
        continue;
      }
      if (RECOMMEND_MACROS[mod.stat]) stats.add(mod.stat);
    }
    if (!stats.size) return null;
    if (stats.size === 1) return `$(${RECOMMEND_MACROS[[...stats][0]]})`;
    const indices = [...stats].map((stat) => RECOMMEND_STAT_INDEX[stat]).join('_');
    return `<if=talent.recommendedAny.${indices}><image:recommended><else><image:recommendedempty></if>`;
  }

  // Полная подсказка как в игре ($(TThead) … $(TTbottom)) или только описание без шапки
  async html({ withHead = true } = {}) {
    const texts = this.talent.texts[this.lang] || this.talent.texts.ru;
    const macros = this.macros();
    if (!withHead) {
      for (const id of Object.keys(macros)) if (/^TThead|^TTbottom/.test(id)) macros[id] = '';
    }
    const env = this.env();
    const ui = precompileMarkup(this.markRecommended(texts.description || texts.commonDescription || ''), env, macros);
    await TalentTooltip.preloadImages(ui);
    return renderUiMarkup(ui, env);
  }

  // Блок набора, как в подсказке игры: название набора, «собрано N», бонусы за 2/3/4 таланта.
  // Это макрос UIRoot ($(TTKit…CommonDescription)) из описания таланта; нет его — одно название.
  async kitHtml() {
    if (!this.kit()) return null;
    const texts = this.talent.texts[this.lang] || this.talent.texts.ru;
    const macros = this.macros();
    const source = `${texts.description || ''}\n${texts.commonDescription || ''}`;
    // шапка $(TThead) тоже упоминает kitName (особый талант набора), а commonDescription —
    // собственный текст таланта: блоком набора их не считаем
    const id = [...source.matchAll(/\$\(([A-Za-z0-9_]+)\)/g)]
      .map((m) => m[1])
      .find((name) => name !== 'commonDescription' && !/^TT(head|bottom|line)/i.test(name) && /talent\.kitName/.test(macros[name] || ''));
    const env = this.env();
    // блок набора; нет его — описание таланта без шапки
    if (!id) for (const name of Object.keys(macros)) if (/^TThead|^TTbottom/.test(name)) macros[name] = '';
    let ui = precompileMarkup(id ? `$(${id})` : this.markRecommended(texts.description || texts.commonDescription || ''), env, macros);
    // название набора сверху; «N/M» в билде — если текст сам не пишет «Название (собрано N)».
    // Блок набора с названием (красные наборы) заголовка не требует; у части наборов название
    // в блоке только для боя (<session>) — тогда заголовок нужен
    const shown = ui.replace(/<[^>]*>/g, ' ').includes(this.kitName());
    if (!id || !shown) {
      const count = shown ? '' : '<space:2>(<value=talent.activatedInKit>/<value=talent.totalInKit>)';
      ui = precompileMarkup(`<atom><style:TT_MARK><value=talent.kitName></style>${count}</atom><br><br:50>`, env, macros) + ui;
    }
    await TalentTooltip.preloadImages(ui);
    return renderUiMarkup(ui, env);
  }

  // название набора; у наборов с заглушкой вместо названия — имя таланта
  kitName() {
    const kit = this.kit();
    if (!kit) return null;
    return kit.named ? kit.name[this.lang] || kit.name.ru : this.name();
  }

  env() {
    return {
      cond: (path) => this.cond(path),
      value: (path, params) => this.value(path, params),
      styleClass: (name) => `pw-tt-s pw-tt-s-${String(name).replace(/[^\w-]/g, '_')}`,
      image: (name) => TalentTooltip.imageHtml(name),
    };
  }

  // --- Картинки и стили -----------------------------------------------------------------

  static async preloadImages(markup) {
    const names = new Set();
    for (const m of markup.matchAll(/<image:([^\s>]+)/g)) names.add(m[1]);
    await Promise.all([...names].map((name) => TalentTooltip.image(name)));
  }

  static image(name) {
    if (!TalentTooltip.images.has(name)) {
      const promise = (async () => {
        const source = await ClientData.imageSource(name);
        if (!source) return null;
        const bytes = await ClientData.fs.read(source.key);
        if (!bytes) return null;
        return { url: ddsToDataUrl(bytes, source.crop), width: source.width, height: source.height, slice: source.slice };
      })().catch((error) => {
        console.warn(`TalentTooltip: картинка ${name}`, error);
        return null;
      });
      promise.then((result) => (promise.result = result));
      TalentTooltip.images.set(name, promise);
    }
    return TalentTooltip.images.get(name);
  }

  static imageHtml(name) {
    const result = TalentTooltip.images.get(name)?.result;
    if (!result) return '';
    // звёзды заточки — все одной высоты и на 30% меньше остальных картинок
    const scale = /^TTstar/i.test(name) ? 0.7 : 1;
    const height = result.height ? `${((result.height / 16) * scale).toFixed(3)}em` : '1.2em';
    return `<img class="pw-tt-img" alt="" src="${result.url}" style="height:${height}">`;
  }

  // Прогрев при старте лаунчера: стили, шрифт, рамка, картинки макросов подсказок, все таланты
  static async warmUp() {
    if (!ClientData.ready) return;
    await TalentTooltip.installStyles();
    const macros = Object.values(ClientData.ui?.macros || {}).flatMap((list) => Object.values(list));
    await TalentTooltip.preloadImages(macros.join('\n'));
    await ClientData.warmUp();
  }

  // CSS стилей шрифтов игры (UIRoot fontStyles), шрифт и фон подсказки — один раз
  static async installStyles() {
    if (TalentTooltip.stylesInstalled || typeof document === 'undefined') return;
    TalentTooltip.stylesInstalled = true;
    const rgba = (c) => `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
    let css = '';
    for (const [name, style] of Object.entries(ClientData.ui?.fonts || {})) {
      const rules = [];
      if (style.color) rules.push(`color:${rgba(style.color)}`);
      if (style.outline) {
        const o = rgba(style.outline);
        rules.push(`text-shadow:1px 0 ${o},-1px 0 ${o},0 1px ${o},0 -1px ${o},1px 1px ${o},-1px -1px ${o}`);
      }
      if (style.size && style.size !== 10) rules.push(`font-size:${(style.size / 10).toFixed(2)}em`);
      if (style.bold) rules.push('font-weight:bold');
      if (style.italic) rules.push('font-style:italic');
      // специфичность выше общих правил панели описания (.build-description … span)
      const cls = `pw-tt-s-${name.replace(/[^\w-]/g, '_')}`;
      css += `.pw-tt span.pw-tt-s.${cls},.build-description .pw-tt span.pw-tt-s.${cls}{${rules.join(';')}}\n`;
    }
    try {
      const font = await ClientData.fs.read('UI/Fonts/DejaVu_book/DejaVuLGCSans.ttf');
      if (font && typeof FontFace !== 'undefined') {
        const face = new FontFace('PW Tooltip', font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
        await face.load();
        document.fonts.add(face);
      }
    } catch (error) {
      console.warn('TalentTooltip: шрифт подсказок игры не загружен', error);
    }
    try {
      // рамка подсказок боя (материал tooltip_base, Screens/Tooltips/Simple): сине-серый фон 83%, края 5 px.
      // Tooltip_Back.dds — рамка лобби (чёрный фон), в лаунчере выходило слишком темно
      const bytes = await ClientData.fs.read('UI/Styles/ASSETS_UI/tooltip/Tooltip_frame.dds');
      if (bytes) {
        const url = ddsToDataUrl(bytes);
        css += `:root{--pw-tt-frame:url(${url})}\n:root .pw-tt.pw-tt-frame{background:none}\n`;
      }
    } catch (error) {
      console.warn('TalentTooltip: фон подсказки игры не загружен', error);
    }
    const element = document.createElement('style');
    element.id = 'pw-client-tooltip-styles';
    element.textContent = css;
    document.head.append(element);
  }

  static escape(text) {
    return escapeHtml(text);
  }
}
