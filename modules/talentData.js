import { HTTP } from './http.js';

// Статические данные талантов (txtNum/stats/statsRefine у общих, params у hero)
// живут в контенте лончера (talent_data/*.json, генератор — pw-api stats.js
// «talent-data»), бэкенд их в build.data / build.inventory не отправляет.
// Загрузка — по аналогии с локализацией (Lang.init): один раз при старте, жёстко.
export class TalentData {
  static common = {}; // id → { txtNum, stats, statsRefine }
  static hero = {};   // |id| → { params }
  // Таланты, у которых в бою можно включить смарткаст (как IsSmartCastableTalent в игре:
  // активный, на цель/в точку, без UseAttackTarget). Генератор — tools/gen-smartcast.
  // null — файла нет (старый контент): переключатель у всех, как раньше.
  static smartcast = null; // { talent: Set<id>, hero: Set<|id|> }
  static _loaded = false;

  static async init() {
    console.log('Loading talent data...');

    try {
      [TalentData.common, TalentData.hero] = await Promise.all([
        HTTP.request('content/talent_data/talents.json'),
        HTTP.request('content/talent_data/hero_talents.json'),
      ]);
    } catch (error) {
      console.error('Error loading talent data files:', error);
      throw new Error('Failed to load talent data: ' + error.message);
    }

    try {
      const smartcast = await HTTP.request('content/talent_data/smartcast.json');
      if (Array.isArray(smartcast?.talent) && Array.isArray(smartcast?.hero)) {
        TalentData.smartcast = {
          talent: new Set(smartcast.talent.map(Number)),
          hero: new Set(smartcast.hero.map(Number)),
        };
      }
    } catch (error) {
      console.warn('TalentData: нет smartcast.json, смарткаст доступен у всех талантов', error);
    }

    TalentData._loaded = true;
    console.log(
      'Talent data loaded:',
      Object.keys(TalentData.common).length,
      'common,',
      Object.keys(TalentData.hero).length,
      'hero'
    );
  }

  // id > 0 — обычный талант, id < 0 — классовый
  static canSmartcast(id) {
    const value = Number(id);
    if (!TalentData.smartcast || !value) return true;
    return value > 0 ? TalentData.smartcast.talent.has(value) : TalentData.smartcast.hero.has(-value);
  }

  // Наполняет предметы списка (build.data body / build.inventory items) данными
  // из локальных файлов. предметы null пропускаются; id без локальных данных —
  // громко в лог, если его данных нет и в другом источнике (optional — есть в данных игры).
  static enrich(items, { optional = () => false } = {}) {
    if (!TalentData._loaded || !Array.isArray(items)) {
      return items;
    }

    for (let item of items) {
      if (!item) {
        continue;
      }

      const id = Number(item.id);

      if (!id) {
        continue;
      }

      const local = id > 0 ? TalentData.common[id] : TalentData.hero[Math.abs(id)];

      if (!local) {
        if (!optional(id)) console.error(`TalentData: талант ${id} отсутствует в talent_data`);
        continue;
      }

      Object.assign(item, local);
    }

    return items;
  }
}
