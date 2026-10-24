// Расчёт статов героя по билду. Порядок как в игре на сервере лаунчера: таланты снизу вверх
// (слот 35 -> 0), «к наибольшему стату» выбирается по статам на момент таланта, мощь героя
// растёт по мере добавления; в конце — бонусы сетов. В боевом режиме — в порядке изучения.

import { LINE_WEIGHTS, talentPower, statWithRefine } from './talents.js';
import { Sets } from './sets.js';
import { SLOTS, levelOfSlot, num } from './grid.js';

export const TALENT_COOLDOWN_PCT_MAX = 30;
export const REGEN_HP_FROM_MAX_HP = 0.0015;
export const REGEN_MP_FROM_MAX_MP = 0.0036;

// статы, которые растут от мощи героя (прирост героя statModifiers)
const POWER_STATS = ['hp', 'mp', 'regenhp', 'regenmp', 'sila', 'razum', 'provorstvo', 'hitrost', 'stoikost', 'volia'];

// составные ключи: стат таланта уходит в наибольший (наименьший) из статов на момент таланта
export const COMPOSITE_STATS = {
  sr: [1, ['sila', 'razum']],
  ph: [1, ['provorstvo', 'hitrost']],
  sv: [1, ['stoikost', 'volia']],
  srsv: [1, ['sila', 'razum', 'stoikost', 'volia']],
  hpmp: [1, ['hp', 'mp']],
  srMin: [-1, ['sila', 'razum']],
  phMin: [-1, ['provorstvo', 'hitrost']],
  svMin: [-1, ['volia', 'stoikost']],
  srsvMin: [-1, ['sila', 'razum', 'stoikost', 'volia']],
  hpmpMin: [-1, ['hp', 'mp']],
};

// приоритет стата галочкой в панели героя перевешивает любое значение
const PROFILE_WEIGHT = 999;

export class StatEngine {
  // hero: { stats, statModifiers, overallModifier } из build.data (после данных игры)
  constructor(hero) {
    this.initial = {};
    this.calc = {};
    // строки панели, которые считаются формулами, и статы, которых у героя в базе нет
    const stats = {
      ...hero.stats,
      damage: 0, critProb: 0, attackSpeed: 0, punching: 0, protectionBody: 0, protectionSpirit: 0,
      regenhp: parseFloat(hero.stats?.regenhp) || 0,
      regenmp: parseFloat(hero.stats?.regenmp) || 0,
      krajahp: 0, krajamp: 0, speedtal: 0,
    };
    for (const [key, value] of Object.entries(stats)) {
      this.initial[key] = parseFloat(value);
      this.calc[key] = 0;
    }
    for (const key of ['speeda', 'crit']) {
      if (!(key in this.initial)) this.initial[key] = 0;
      if (!(key in this.calc)) this.calc[key] = 0;
    }
    this.initial.talentCdPct = 0;
    this.calc.talentCdPct = 0;
    this.statMods = hero.statModifiers || {};
    this.q = Number(hero.overallModifier);
    this.fromPower = Object.fromEntries(POWER_STATS.map((key) => [key, 0]));
    this.heroPower = 0;
    this.profile = {}; // ключ стата -> 0/1 (галочки)
    this.flags = { rz: true, vz: false, stak: true, buffs: true };
    this.combat = null; // { order: [слоты], learned: Set, factor } — боевой режим
    // у героев без энергии (база mp = 0) энергия талантов не считается, её реген идёт в здоровье
    this.noEnergy = Number.isFinite(this.initial.mp) && Math.abs(this.initial.mp) < 1e-9;
  }

  // копия для расчётов «что если» (подсветка по стату), без пересчёта
  clone() {
    const copy = Object.create(StatEngine.prototype);
    Object.assign(copy, this, { calc: { ...this.calc }, fromPower: { ...this.fromPower } });
    return copy;
  }

  total(key, { uncapped = false } = {}) {
    let value = num(this.initial[key]) + num(this.calc[key]) + (key in this.fromPower ? num(this.fromPower[key]) : 0);
    if (key === 'speed') value += num(this.calc.speeda);
    if (key === 'speedtal' && !uncapped) value = Math.max(0, Math.min(TALENT_COOLDOWN_PCT_MAX, value));
    return value;
  }

  // наибольший (dir 1) или наименьший (dir -1) стат из списка; при равенстве — первый
  pick(keys, dir = 1) {
    const score = (key) => this.total(key) + (key in this.profile ? this.profile[key] * PROFILE_WEIGHT : 0);
    let best = keys[0];
    let bestValue = score(best);
    for (let i = 1; i < keys.length; i++) {
      const value = score(keys[i]);
      if (dir > 0 ? value > bestValue : value < bestValue) {
        best = keys[i];
        bestValue = value;
      }
    }
    return best;
  }

  composite(key) {
    const rule = COMPOSITE_STATS[key];
    return rule ? this.pick(rule[1], rule[0]) : key;
  }

  // ключ стата бонуса сета: составной -> стат героя, critProb -> прямой шанс крита
  alias(key) {
    return key === 'critProb' ? 'crit' : this.composite(key);
  }

  // ключ с условием (stak/rz/vz/dop/buff) -> обычный, если условие включено
  conditional(key) {
    const { stak, rz, vz, buffs } = this.flags;
    if (stak && key.includes('stak')) return key.replace('stak', '');
    if (rz && key.includes('rz')) return key.replace('rz', '');
    if (vz && key.includes('vz')) return key.replace('vz', '');
    if (key.includes('dop')) return key.replace('dop', '');
    if (buffs && key.includes('buff')) return key.replace('buff', '');
    return key;
  }

  resource(key) {
    if (!key || !this.noEnergy) return key;
    if (key === 'mp') return null;
    if (key === 'regenmp') return 'regenhp';
    if (key === 'regenmpvz') return 'regenhpvz';
    return key;
  }

  add(key, value) {
    key = this.resource(key);
    if (!key || !(key in this.calc)) return;
    if (key === 'speed') this.calc.speed = Math.max(this.calc.speed, value);
    else this.calc[key] += value;
  }

  // прямой вклад талантов и сетов в стат (без базы и мощи)
  direct(key) {
    return key === 'speed' ? num(this.calc.speed) + num(this.calc.speeda) : num(this.calc[key]);
  }

  setPower(weightSum) {
    const m = this.heroPower * weightSum;
    for (const key of POWER_STATS) this.fromPower[key] = num(this.statMods[key]) * (0.6 * this.q * (m / 10.0 - 16.0) + 36.0);
  }

  applyTalent(talent) {
    this.heroPower += talentPower(talent);
    // ключ стата героя -> прибавка; составные ключи выбирают стат сейчас
    const add = {};
    for (const key in talent.stats) {
      let value = statWithRefine(talent, key);
      if (this.combat && key.includes('stak')) value *= this.combat.factor;
      add[this.composite(key)] = value;
    }
    let speed = null;
    let speedBonus = 0;
    for (const key in add) {
      const value = parseFloat(add[key]);
      const resolved = this.resource(this.conditional(key));
      if (!resolved) continue;
      if (resolved === 'speed') speed = Math.max(speed ?? -Infinity, Number.isFinite(value) ? value : -Infinity);
      else if (resolved === 'speedd') {
        speed ??= -Infinity;
        if (Number.isFinite(value)) speedBonus += value;
      } else if (resolved in this.calc) this.calc[resolved] += value;
    }
    // скорость не суммируется: наибольшая из талантов (+ надбавка speedd этого таланта)
    if (speed !== null) {
      const value = (Number.isFinite(speed) ? speed : 0) + speedBonus;
      if ('speed' in this.calc) this.calc.speed = Math.max(this.calc.speed, value);
    }
  }

  // скорость таланта по его ключам (наибольшая) — для надбавки сета к главному таланту
  talentSpeed(talent) {
    let best = -Infinity;
    for (const key in talent.stats || {}) {
      if (this.conditional(key) !== 'speed') continue;
      let value = parseFloat(talent.stats[key]);
      if (!Number.isFinite(value)) continue;
      if ('statsRefine' in talent && 'rarity' in talent) {
        const refine = parseFloat(talent.statsRefine[key]);
        if (Number.isFinite(refine)) value = statWithRefine(talent, key);
      }
      best = Math.max(best, value);
    }
    return Number.isFinite(best) ? best : 0;
  }

  applySets(installed) {
    const ids = new Set();
    for (const talent of installed) if (talent && Number(talent.id)) ids.add(Number(talent.id));
    if (!ids.size) return;
    const speedByMain = new Map();
    for (const { set, count } of Sets.active(ids)) {
      for (const rule of set.addRules) {
        if (count < rule.need) continue;
        const resolved = {};
        for (const [rawKey, rawValue] of Object.entries(rule.stats)) {
          // speedd сета — надбавка к скорости главного таланта сета
          if (this.conditional(rawKey) === 'speedd') {
            const value = Number(rawValue);
            const mainId = set.mainNeed > 0 ? set.mainNeed : Number(set.mainId);
            if (value && mainId && ids.has(mainId)) speedByMain.set(mainId, (speedByMain.get(mainId) || 0) + value);
            continue;
          }
          const value = Number(rawValue);
          if (!Number.isFinite(value)) continue;
          const key = this.alias(rawKey);
          resolved[key] = (resolved[key] || 0) + value;
        }
        for (const [key, value] of Object.entries(resolved)) this.add(this.conditional(key), value);
      }
    }
    for (const [mainId, bonus] of speedByMain) {
      const main = installed.find((talent) => talent && Math.abs(Number(talent.id)) === Math.abs(mainId));
      if (main) this.add('speed', this.talentSpeed(main) + bonus);
    }
  }

  reset() {
    this.heroPower = 0;
    for (const key in this.calc) this.calc[key] = 0;
  }

  // Полный расчёт. installed — 36 слотов поля (null — пусто).
  compute(installed) {
    this.reset();
    if (this.combat) return this.computeCombat(installed);
    let weightSum = 0;
    for (let slot = SLOTS - 1; slot >= 0; slot--) {
      const talent = installed[slot];
      if (!talent) continue;
      weightSum += LINE_WEIGHTS[levelOfSlot(slot) - 1];
      this.setPower(weightSum);
      this.applyTalent(talent);
    }
    this.setPower(weightSum);
    this.applySets(installed);
    return this;
  }

  // Боевой режим: изучены не все таланты. Мощь — доля полного билда по рядам изученных,
  // таланты — в порядке изучения, стаки — по уровню героя.
  computeCombat(installed) {
    const { order, learned } = this.combat;
    let power = 0;
    let weightFull = 0;
    installed.forEach((talent, slot) => {
      if (!talent) return;
      power += talentPower(talent);
      weightFull += LINE_WEIGHTS[levelOfSlot(slot) - 1];
    });
    let weightLearned = 0;
    for (const slot of learned) {
      const talent = installed[slot];
      if (talent) weightLearned += LINE_WEIGHTS[Math.max(0, Math.min(5, (Number(talent.level) || 1) - 1))];
    }
    const m = power * weightFull;
    for (const key of POWER_STATS) {
      this.fromPower[key] = num(this.statMods[key]) * (0.6 * this.q * (m / 10.0 - 16.0) + 36.0) * weightLearned;
    }
    const effective = installed.map((talent, slot) => (learned.has(slot) ? talent : null));
    for (const slot of order) if (effective[slot]) this.applyTalent(effective[slot]);
    this.applySets(effective);
    return this;
  }

  // Статы до таланта в слоте (таланты ниже него и их сеты) — куда ушёл бы составной стат
  computeBefore(installed, slot) {
    this.reset();
    const partial = installed.map((talent, i) => (i > slot ? talent : null));
    let weightSum = 0;
    for (let i = SLOTS - 1; i > slot; i--) {
      if (!partial[i]) continue;
      weightSum += LINE_WEIGHTS[levelOfSlot(i) - 1];
      this.setPower(weightSum);
      this.applyTalent(partial[i]);
    }
    this.applySets(partial);
    return this;
  }

  // Подписи панели статов: ключ строки -> текст
  display() {
    const t = (key) => this.total(key);
    const rows = {};
    for (const key of ['hp', 'mp', 'speed', 'krajahp', 'krajamp', 'sila', 'razum', 'provorstvo', 'hitrost', 'stoikost', 'volia']) {
      rows[key] = String(Math.round(t(key)));
    }
    rows.regenhp = formatRegen(t('regenhp') + t('hp') * REGEN_HP_FROM_MAX_HP);
    rows.regenmp = formatRegen(t('regenmp') + t('mp') * REGEN_MP_FROM_MAX_MP);
    return rows;
  }

  // Урон, пробивание, защита, крит, скорость атаки — формулы игры от итоговых статов
  derived(mainAttackParam, attackModifier) {
    const agility = this.total('provorstvo');
    const cunning = this.total('hitrost');
    const stamina = this.total('stoikost');
    const will = this.total('volia');
    const damage = mainAttackParam == 1 ? this.total('sila') : this.total('razum');
    let penetration = statAg(agility) + statCun(cunning);
    const crit = 62.765 - 11534.0 / (126.04 + cunning) + this.direct('crit');
    return {
      damage: [Math.round(damage * attackModifier * 0.9), Math.round(damage * attackModifier * 1.1)],
      physical: mainAttackParam == 1,
      punching: `${Math.round(penetration)}%`,
      protectionBody: `${Math.round(0.5355 * (stamina + 0.15 * will) - 20)}%`,
      protectionSpirit: `${Math.round(0.5355 * (will + 0.15 * stamina) - 20)}%`,
      critProb: `${Math.max(0.0, Math.round(crit))}%`,
      attackSpeed: String(Math.round(Math.min(2.0, 0.00364 * agility + 0.49) * 100.0) / 100.0),
    };
  }
}

const statAg = (v) => (v > 500.0 ? 61.72 + 0.6876 * v - 10.035 * Math.sqrt(v) : 48.45 + 0.764 * v - 11.15 * Math.sqrt(v));
const statCun = (v) => (v > 500.0 ? 85.78 + 0.43 * v - 15.55 * Math.log(v) : 59.83 + 0.57 * v - 20.73 * Math.log(v));

// реген: одна десятичная, без «.0» у целых
export function formatRegen(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  const text = rounded.toFixed(1);
  return text.endsWith('.0') ? String(Math.round(rounded)) : text;
}
