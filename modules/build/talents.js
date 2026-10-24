// Таланты окна билда: данные из talent_data + данные игры, заточка и мощь по редкости,
// конфликты. Талант с id > 0 — обычный, id < 0 — классовый (иконка htalents/|id|).

import { TalentData } from '../talentData.js';
import { BuildClientTooltip } from '../buildClientTooltip.js';
import { getMainHeroTalentId } from '../mainHeroTalent.js';

// заточка талантов в билде по редкости (классовые — как красные)
export const REFINE_BY_RARITY = { 4: 5.0, 3: 7.0, 2: 9.0, 1: 12.0 };

const POWER_FIRST_LEVEL = { 4: 53.04, 3: 47.04, 2: 43.2, 1: 36, 0: 45.12 };
const POWER_PER_LEVEL = { 4: 3.978, 3: 3.528, 2: 3.24, 1: 2.625, 0: 11.28 };

// мощь таланта с заточкой билда; 0 — классовые (у них своя таблица, заточка как у красных)
const POWER_BY_RARITY = Object.fromEntries(
  [4, 3, 2, 1, 0].map((r) => [r, POWER_FIRST_LEVEL[r] + POWER_PER_LEVEL[r] * (REFINE_BY_RARITY[r || 4] - 1)]),
);

// Доля ряда (снизу вверх: I..VI) в мощи; сумма по 6 слотам ряда — вес ряда
export const LINE_WEIGHTS = [6 / 600, 9 / 600, 13 / 600, 16 / 600, 23 / 600, 33 / 600];

// прибавка к стату за заточку (сверх первой)
export const refineBonus = (rarity) => (rarity ? REFINE_BY_RARITY[rarity] - 1.0 : 4.0);

export const talentPower = (talent) => POWER_BY_RARITY['rarity' in talent ? talent.rarity : 0] ?? POWER_BY_RARITY[0];

// Значение стата таланта с заточкой билда
export function statWithRefine(talent, key) {
  let value = parseFloat(talent.stats[key]);
  if ('statsRefine' in talent && 'rarity' in talent) {
    value += refineBonus(talent.rarity) * parseFloat(talent.statsRefine[key]);
  }
  return value;
}

// Условные ключи статов (родная/вражеская земля, стаки, баффы, доп.) и скорость:
// в описании таланта не печатаются, из txtNum берутся как есть
export const isConditionalStatKey = (key) =>
  /stak|rz|vz|dop|buff/.test(key) || (key.includes('speed') && !key.includes('speedtal'));

export const iconUrl = (id) => (Number(id) > 0 ? `content/talents/${id}.webp` : `content/htalents/${Math.abs(id)}.webp`);

const txtNumCache = new Map();
function parseTxtNum(txtNum) {
  let parsed = txtNumCache.get(txtNum);
  if (!parsed) {
    parsed = String(txtNum)
      .split(';')
      .map((part) => {
        const [value, refine, key] = part.split(',');
        return [parseFloat(value), parseFloat(refine), key];
      });
    txtNumCache.set(txtNum, parsed);
  }
  return parsed;
}

// Данные талантов списка (build.data body / build.inventory): talent_data, поверх — статы
// из данных игры, затем ключи txtNum. initialStats — базовые статы героя: стат, который
// у героя уже есть, из txtNum приходит как «бафф» (ключ + buff).
export function prepareTalents(items, initialStats) {
  // нового таланта может не быть в talent_data: всё нужное есть в данных игры
  TalentData.enrich(items, { optional: (id) => BuildClientTooltip.available(id) });
  BuildClientTooltip.enrichStats(items);
  for (const talent of items) {
    if (!talent) continue;
    // свои копии: TalentData.enrich кладёт в талант общие объекты talent_data
    if (talent.stats) talent.stats = { ...talent.stats };
    if (talent.statsRefine) talent.statsRefine = { ...talent.statsRefine };
    if (talent.txtNum) {
      talent.stats ||= {};
      talent.statsRefine ||= {};
      for (const [value, refine, key] of parseTxtNum(talent.txtNum)) {
        if (isConditionalStatKey(key)) {
          talent.stats[key] = value;
          talent.statsRefine[key] = refine;
        } else if (!(key in talent.stats) && initialStats[key] > 0) {
          talent.stats[`${key}buff`] = value;
          talent.statsRefine[`${key}buff`] = refine;
        }
      }
    }
    talent.params = talent.txtNum ? talent.txtNum : talent.params;
  }
  return items;
}

// Главный классовый талант героя: его нельзя снять, с него начинается боевой режим
export function isMainTalent(heroId, talent) {
  const main = Math.abs(Number(getMainHeroTalentId(heroId)));
  return !!main && Number(talent?.id) === -main;
}

// Слоты поля, с которыми талант конфликтует (тот же тип таланта, id в его conflict)
export function conflictSlots(talent, body) {
  if (!Array.isArray(talent?.conflict)) return [];
  const result = [];
  body.forEach((other, slot) => {
    if (!other || other.id > 0 !== talent.id > 0) return;
    if (talent.conflict.some((id) => Math.abs(other.id) == id)) result.push(slot);
  });
  return result;
}
