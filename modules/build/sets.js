// Сеты лаунчера (sets.list.js через TalentSets): справочник, разобранный один раз, —
// таланты сета, главный талант, бонусы к статам (addStats) и к откату (cdMods).

import { TalentSets } from '../talentSets.js';

// addStats: { 2: {...} } | [[2, {...}]] | [{ need, stats }] | [{ 2: {...} }] -> [{ need, stats }] по возрастанию need
function normalizeAddStats(addStats) {
  const rules = [];
  const push = (need, stats) => {
    need = Number(need);
    if (need > 0 && stats && typeof stats === 'object' && !Array.isArray(stats)) rules.push({ need, stats });
  };
  if (Array.isArray(addStats)) {
    for (const entry of addStats) {
      if (Array.isArray(entry) && entry.length >= 2) push(entry[0], entry[1]);
      else if (entry && typeof entry === 'object') {
        if ('need' in entry && 'stats' in entry) push(entry.need, entry.stats);
        else for (const [need, stats] of Object.entries(entry)) push(need, stats);
      }
    }
  } else if (addStats && typeof addStats === 'object') {
    for (const [need, stats] of Object.entries(addStats)) push(need, stats);
  }
  return rules.sort((a, b) => a.need - b.need);
}

// cdMods: { [цель]: { [источник]: [сек], bySetCount: { [N]: [сек] } } }
// -> [{ target, sources: [{ id, delta }], byCount: [{ need, delta }] }]
function normalizeCdMods(raw) {
  const rules = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return rules;
  const delta = (value) => {
    const n = Number(Array.isArray(value) ? value[0] : value);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  for (const [targetRaw, sourcesRaw] of Object.entries(raw)) {
    const target = Math.abs(Number(targetRaw));
    if (!(target > 0) || !sourcesRaw || typeof sourcesRaw !== 'object' || Array.isArray(sourcesRaw)) continue;
    const sources = [];
    let byCount = [];
    for (const [sourceRaw, value] of Object.entries(sourcesRaw)) {
      if (['bySetCount', 'setCount', 'count', 'need'].includes(sourceRaw)) {
        byCount = [];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [need, d] of Object.entries(value)) {
            if (Number(need) > 0 && delta(d) !== null) byCount.push({ need: Number(need), delta: delta(d) });
          }
        }
        byCount.sort((a, b) => a.need - b.need);
        continue;
      }
      const id = Math.abs(Number(sourceRaw));
      if (id > 0 && delta(value) !== null) sources.push({ id, delta: delta(value) });
    }
    if (sources.length || byCount.length) rules.push({ target, sources, byCount });
  }
  return rules;
}

export class Sets {
  static _list = null;

  // Сеты в порядке списка окна (новые сверху)
  static list() {
    if (!Sets._list) {
      Sets._list = TalentSets.list().map((set) => {
        const ids = TalentSets.getTalentIds(set).map(Number).filter((id) => Number.isFinite(id) && id !== 0);
        return {
          raw: set,
          key: String(set.key || ''),
          ids,
          mainId: TalentSets.chooseMainTalentId(set),
          mainNeed: Number(set.mainNeed) || 0,
          addRules: normalizeAddStats(set.addStats),
          cdRules: normalizeCdMods(set.cdMods),
          popularityId: Number(/^setId_(\d+)$/i.exec(set.key || '')?.[1]) || 0,
        };
      });
    }
    return Sets._list;
  }

  // Сет таланта (первый по списку окна) — для раскладки сетов по колонкам
  static ofTalent(id) {
    if (!Sets._byTalent) {
      Sets._byTalent = new Map();
      for (const set of Sets.list()) for (const tid of set.ids) if (!Sets._byTalent.has(Math.abs(tid))) Sets._byTalent.set(Math.abs(tid), set);
    }
    return Sets._byTalent.get(Math.abs(Number(id))) || null;
  }

  // Сет таланта и его место в сете по порядку sets.list.js — группировка в библиотеке
  static groupOf(id) {
    if (!Sets._groups) {
      Sets._groups = new Map();
      for (const set of [...Sets.list()].reverse()) {
        set.ids.forEach((tid, order) => {
          if (!Sets._groups.has(tid)) Sets._groups.set(tid, { set, order });
        });
      }
    }
    return Sets._groups.get(Number(id)) || null;
  }

  // Первый сет, в который входит талант (подсветка сета при наведении на талант)
  static containing(id) {
    return Sets.list().find((set) => set.ids.includes(Number(id))) || null;
  }

  static count(set, ids) {
    let count = 0;
    for (const id of set.ids) if (ids.has(id)) count++;
    return count;
  }

  // Сеты, бонусы которых сейчас работают: собран хотя бы один талант и главный, если он нужен
  static *active(installedIds) {
    for (const set of Sets.list()) {
      const count = Sets.count(set, installedIds);
      if (count <= 0) continue;
      if (set.mainNeed && !installedIds.has(set.mainNeed)) continue;
      yield { set, count };
    }
  }

  // Сдвиг отката таланта (сек) от сетов, собранных в билде
  static cooldownDelta(talentId, installed) {
    const target = Math.abs(Number(talentId));
    const ids = new Set();
    for (const talent of installed) if (talent) ids.add(Math.abs(Number(talent.id)));
    if (!(target > 0) || !ids.size) return 0;
    let delta = 0;
    for (const set of Sets.list()) {
      let count = 0;
      for (const id of set.ids) if (ids.has(Math.abs(id))) count++;
      if (count <= 0) continue;
      if (set.mainNeed && !ids.has(Math.abs(set.mainNeed))) continue;
      for (const rule of set.cdRules) {
        if (rule.target !== target) continue;
        for (const item of rule.byCount) if (count >= item.need) delta += item.delta;
        for (const item of rule.sources) if (ids.has(item.id)) delta += item.delta;
      }
    }
    return delta;
  }
}
