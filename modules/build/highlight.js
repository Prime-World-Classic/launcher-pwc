// Подсветки окна билда: таланты сета (поле и библиотека), мигающие превью свободных слотов,
// таланты и сеты, дающие стат строки панели героя, ряд таланта библиотеки, счётчик подсвеченных.
// Здесь же порядок талантов сета при установке — по галочкам статов героя.

import { Sets } from './sets.js';
import { firstEmptySlot } from './grid.js';
import { iconUrl } from './talents.js';

// Ключи статов талантов, которые показывает строка панели героя (фильтр библиотеки по стату)
export const STAT_ROW_KEYS = {
  hp: ['hp', 'hpmp'],
  mp: ['mp', 'hpmp'],
  regenhp: ['regenhp', 'regenhpvz'],
  regenmp: ['regenmp', 'regenmpvz'],
  krajahp: ['krajahp', 'krajahprz', 'krajahpvz'],
  krajamp: ['krajamp'],
  talentCdPct: ['speedtal', 'speedtalrz', 'speedtalvz'],
  speed: ['speed', 'speedrz', 'speedvz', 'speeda', 'speedarz', 'speedavz', 'speedd', 'speeddrz', 'speeddvz'],
  sila: ['sila', 'sr', 'srsv', 'silarz', 'silavz'],
  razum: ['razum', 'sr', 'srsv', 'razumrz', 'razumvz'],
  provorstvo: ['provorstvo', 'ph', 'provorstvorz', 'provorstvovz'],
  hitrost: ['hitrost', 'ph', 'hitrostrz', 'hitrostvz'],
  stoikost: ['stoikost', 'sv', 'srsv', 'stoikostrz', 'svvz', 'vs'],
  volia: ['volia', 'sv', 'srsv', 'voliarz', 'svvz', 'vs'],
};
export const rowKeys = (row) => STAT_ROW_KEYS[row]?.slice() || [row];

// Строки, где стат таланта может уйти в другой («к наибольшему»): чей он — по статам на момент таланта
const ROW_CHOICES = {
  hitrost: { own: ['hitrost', 'hitrostrz', 'hitrostvz'], pairs: { ph: [1, ['provorstvo', 'hitrost']], phMin: [-1, ['provorstvo', 'hitrost']] } },
  provorstvo: { own: ['provorstvo', 'provorstvorz', 'provorstvovz'], pairs: { ph: [1, ['provorstvo', 'hitrost']], phMin: [-1, ['provorstvo', 'hitrost']] } },
  sila: { own: ['sila', 'silarz', 'silavz'], pairs: { sr: [1, ['sila', 'razum']], srsv: [1, ['sila', 'razum', 'stoikost', 'volia']], srMin: [-1, ['sila', 'razum']], srsvMin: [-1, ['sila', 'razum', 'stoikost', 'volia']] } },
  razum: { own: ['razum', 'razumrz', 'razumvz'], pairs: { sr: [1, ['sila', 'razum']], srsv: [1, ['sila', 'razum', 'stoikost', 'volia']], srMin: [-1, ['sila', 'razum']], srsvMin: [-1, ['sila', 'razum', 'stoikost', 'volia']] } },
  stoikost: { own: ['stoikost', 'stoikostrz'], pairs: { sv: [1, ['stoikost', 'volia']], srsv: [1, ['sila', 'razum', 'stoikost', 'volia']], svMin: [-1, ['volia', 'stoikost']], srsvMin: [-1, ['sila', 'razum', 'stoikost', 'volia']] }, marginal: ['svvz', 'vs'] },
  volia: { own: ['volia', 'voliarz'], pairs: { sv: [1, ['stoikost', 'volia']], srsv: [1, ['sila', 'razum', 'stoikost', 'volia']], svMin: [-1, ['volia', 'stoikost']], srsvMin: [-1, ['sila', 'razum', 'stoikost', 'volia']] }, marginal: ['svvz', 'vs'] },
  hp: { own: ['hp'], pairs: { hpmp: [1, ['hp', 'mp']], hpmpMin: [-1, ['hp', 'mp']] } },
  mp: { own: ['mp'], pairs: { hpmp: [1, ['hp', 'mp']], hpmpMin: [-1, ['hp', 'mp']] } },
};

// Семьи статов для порядка талантов сета: чистые ключи весят больше смешанных
const FAMILIES = {
  sila: { pure: ['sila', 'silarz', 'silavz'], mixed: ['sr', 'srsv'] },
  razum: { pure: ['razum', 'razumrz', 'razumvz'], mixed: ['sr', 'srsv'] },
  provorstvo: { pure: ['provorstvo', 'provorstvorz', 'provorstvovz'], mixed: ['ph'] },
  hitrost: { pure: ['hitrost', 'hitrostrz', 'hitrostvz'], mixed: ['ph'] },
  stoikost: { pure: ['stoikost', 'stoikostrz'], mixed: ['sv', 'svvz', 'vs', 'srsv'] },
  volia: { pure: ['volia', 'voliarz'], mixed: ['sv', 'svvz', 'vs', 'srsv'] },
};
const CHECKBOX_KEYS = new Set(['srMin', 'phMin', 'svMin', 'srsvMin', ...Object.values(FAMILIES).flatMap((f) => [...f.pure, ...f.mixed])]);
const hasKey = (stats, key) => key in stats || `${key}buff` in stats;
const baseKey = (key) => (key.endsWith('buff') ? key.slice(0, -4) : key);

export class Highlight {
  constructor(ed) {
    this.ed = ed;
    this.statRow = null; // строка панели героя под курсором
    this.hoveredSet = null; // { set, item } — сет под курсором (или нажатый)
    this.blinkTimer = 0;
  }

  get field() {
    return this.ed.fieldView;
  }

  libraryNodes() {
    return this.ed.library.list?.querySelectorAll('.build-talent-item') || [];
  }

  fieldNodes() {
    return this.field.querySelectorAll('.build-talent-item');
  }

  // --- Сеты ---------------------------------------------------------------------------------

  clearSet() {
    for (const node of this.field.querySelectorAll('.build-set-highlight')) node.classList.remove('build-set-highlight');
    for (const node of this.ed.library.list?.querySelectorAll('.build-set-highlight-lib') || []) node.classList.remove('build-set-highlight-lib');
    this.clearPreviews();
    this.updateCount();
  }

  // таланты сета: на поле и видимые (в прокрутке) в библиотеке
  // Сначала все чтения размеров, потом запись классов: чтение после правки классов заставляет браузер
  // заново считать раскладку окна, и так на каждый талант сета (пролаг при наведении).
  showSet(ids, { libraryOnly = false } = {}) {
    const wanted = new Set(ids.map(String));
    const visible = [];
    const list = this.ed.library.list;
    if (list) {
      const view = list.getBoundingClientRect();
      for (const node of this.libraryNodes()) {
        if (!wanted.has(node.dataset.id)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width && rect.bottom > view.top && rect.top < view.bottom && rect.right > view.left && rect.left < view.right) visible.push(node);
      }
    }
    this.clearSet();
    if (!libraryOnly) for (const node of this.fieldNodes()) if (wanted.has(node.dataset.id)) node.classList.add('build-set-highlight');
    for (const node of visible) node.classList.add('build-set-highlight-lib');
    this.updateCount();
  }

  // наведение на сет в списке сетов
  enterSet(set, item) {
    this.hoveredSet = { set, item };
    this.ed.tooltip.showSet(set, item, this.ed.setting('buildSetLmbMode'));
    this.showSet(set.ids);
    this.previewSet(set);
  }

  leaveSet() {
    this.hoveredSet = null;
    this.ed.tooltip.hide();
    this.clearSet();
  }

  // Сет при наведении на талант (настройка): единственный собранный талант сета на поле —
  // подсвечиваем остальные только в библиотеке. true — подсветка сета есть.
  talentSet(talent) {
    if (this.hoveredSet) return true;
    if (!(Number(talent.id) > 0) || !this.ed.setting('buildSetHoverOnTalent')) return false;
    const set = Sets.containing(talent.id);
    if (!set) return false;
    const installed = set.ids.filter((id) => this.ed.inBuild(id)).length;
    this.showSet(set.ids, { libraryOnly: installed <= 1 && this.ed.inBuild(talent.id) });
    return true;
  }

  // --- Превью свободных слотов --------------------------------------------------------------

  clearPreviews() {
    for (const cell of this.field.querySelectorAll('.build-set-empty-slot-preview, .build-talent-empty-slot-preview')) {
      cell.classList.remove('build-set-empty-slot-preview', 'build-talent-empty-slot-preview');
      cell.style.backgroundImage = '';
    }
    clearInterval(this.blinkTimer);
    this.blinkTimer = 0;
    this.field.classList.remove('build-preview-blink-on');
  }

  // Куда встанут недостающие таланты: сет — справа налево по порядку установки, талант — слева
  preview(ids, { fromLeft = false, className = 'build-set-empty-slot-preview' } = {}) {
    this.clearPreviews();
    const body = this.ed.body.slice();
    for (const id of ids) {
      const talent = this.ed.talents.get(Number(id));
      if (!talent || !(talent.level > 0) || this.ed.inBuild(id)) continue;
      const slot = firstEmptySlot(body, talent.level, fromLeft);
      if (slot < 0) continue;
      body[slot] = talent;
      const cell = this.ed.cells[slot];
      cell.classList.add(className);
      // иконка, которую уже нашла библиотека (у нового таланта — из данных игры)
      cell.style.backgroundImage = this.ed.nodes.get(Number(id))?.style.backgroundImage || `url("${iconUrl(id)}")`;
    }
    if (!this.field.querySelector(`.${className}`)) return;
    let on = false;
    const tick = () => this.field.classList.toggle('build-preview-blink-on', (on = !on));
    tick();
    this.blinkTimer = setInterval(tick, 450);
  }

  previewSet(set) {
    this.preview(this.setOrder(set));
  }

  previewTalent(talent) {
    this.preview([talent.id], { fromLeft: true, className: 'build-talent-empty-slot-preview' });
  }

  // --- Ряд таланта библиотеки ---------------------------------------------------------------

  showRow(level) {
    this.clearRow();
    if (!this.ed.setting('buildRowHoverHighlight') || !(level > 0)) return;
    this.row = document.getElementById(`bfr${level}`);
    this.row?.classList.add('build-field-row--library-hover');
  }

  clearRow() {
    this.row?.classList.remove('build-field-row--library-hover');
    this.row = null;
  }

  // --- Порядок талантов сета ----------------------------------------------------------------

  // статы с галочкой в панели героя
  checkedBases() {
    const profile = this.ed.engine.profile;
    return new Set(Object.keys(FAMILIES).filter((key) => Number(profile[key]) === 1));
  }

  score(talent, bases, dominantSr = null) {
    const stats = talent?.stats || {};
    let score = 0;
    for (const base of bases) {
      const family = FAMILIES[base];
      if (!family) continue;
      let pure = 10;
      let mixed = 3;
      // отмечены и Сила, и Разум — больший из них в приоритете
      if (dominantSr && (base === 'sila' || base === 'razum')) {
        if (base === dominantSr) {
          pure += 4;
          mixed += 1;
        } else {
          pure = Math.max(0, pure - 2);
          mixed = Math.max(0, mixed - 1);
        }
      }
      for (const key of family.pure) if (hasKey(stats, key)) score += pure;
      for (const key of family.mixed) if (hasKey(stats, key)) score += mixed;
    }
    return score;
  }

  // Порядок установки талантов сета: по галочкам статов; с настройкой «только подходящие» —
  // без талантов на статы, которые не отмечены
  setOrder(set) {
    let ids = set.ids.slice();
    const bases = this.checkedBases();
    const bothSr = bases.has('sila') && bases.has('razum');
    const dominantSr = bothSr ? this.ed.engine.pick(['sila', 'razum']) : null;
    const talent = (id) => this.ed.talents.get(Number(id));
    if (ids.length > 1 && bases.size) {
      ids = ids
        .map((id, index) => ({ id, index, score: this.score(talent(id), bases, dominantSr) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((item) => item.id);
    }
    if (!this.ed.setting('buildSetOnlyMatchingStats')) return ids;
    const nonSr = new Set([...bases].filter((base) => base !== 'sila' && base !== 'razum'));
    return ids.filter((id) => {
      const stats = talent(id)?.stats || {};
      const keys = Object.keys(stats).map(baseKey);
      const checkbox = keys.some((key) => CHECKBOX_KEYS.has(key));
      const other = keys.some((key) => !CHECKBOX_KEYS.has(key));
      if (!bases.size) return !checkbox && other;
      // таланты только на другие статы (без галочек) подходят всегда
      if (!checkbox && other) return true;
      const pureSila = FAMILIES.sila.pure.some((key) => hasKey(stats, key));
      const pureRazum = FAMILIES.razum.pure.some((key) => hasKey(stats, key));
      const srMax = ['sr', 'srsv'].some((key) => hasKey(stats, key));
      if (bases.has('razum') && !bases.has('sila') && pureSila) return false;
      if (bases.has('sila') && !bases.has('razum') && pureRazum) return false;
      if (!bases.has('sila') && !bases.has('razum') && (pureSila || pureRazum || srMax) && this.score(talent(id), nonSr) <= 0) return false;
      return this.score(talent(id), bases, dominantSr) > 0;
    });
  }

  // --- Строка стата панели героя ------------------------------------------------------------

  // Таланты поля, которые дают стат строки: 1 — есть ключ стата, 2 — меняют итог
  talentsForRow(row, mode) {
    const ed = this.ed;
    const body = ed.body;
    const slots = [];
    if (mode === 1) {
      const keys = rowKeys(row);
      body.forEach((talent, slot) => talent && keys.some((key) => key in (talent.stats || {})) && slots.push(slot));
      return slots;
    }
    const choice = ROW_CHOICES[row];
    if (choice) {
      body.forEach((talent, slot) => {
        if (!talent) return;
        const stats = talent.stats || {};
        if (choice.own.some((key) => key in stats)) return slots.push(slot);
        const pair = Object.keys(choice.pairs).find((key) => key in stats);
        if (pair) {
          const [dir, keys] = choice.pairs[pair];
          if (ed.engine.clone().computeBefore(body, slot).pick(keys, dir) === row) slots.push(slot);
          return;
        }
        if (choice.marginal?.some((key) => key in stats) && this.changes(slot, row)) slots.push(slot);
      });
      return slots;
    }
    const key = row === 'talentCdPct' ? 'speedtal' : row;
    body.forEach((talent, slot) => talent && this.changes(slot, key) && slots.push(slot));
    return slots;
  }

  // меняется ли прямой вклад в стат, если убрать талант слота
  changes(slot, key) {
    const ed = this.ed;
    const full = ed.engine.clone().compute(ed.body).direct(key);
    const body = ed.body.slice();
    body[slot] = null;
    const engine = ed.engine.clone();
    if (ed.combat) engine.combat = { order: ed.combat.order.filter((s) => s !== slot), learned: new Set([...ed.combat.learned].filter((s) => s !== slot)), factor: ed.combat.factor };
    return Math.abs(full - engine.compute(body).direct(key)) > 1e-4;
  }

  // сеты, бонус которых сейчас идёт в стат строки
  setsForRow(row) {
    const engine = this.ed.engine;
    const ids = new Set(this.ed.body.filter(Boolean).map((talent) => Number(talent.id)));
    const normalize = (key) => engine.conditional(engine.alias(key));
    const matches = (key) => {
      key = normalize(key);
      if (row === 'critProb' && key === 'crit') return true;
      return rowKeys(row).some((rowKey) => normalize(rowKey) === key);
    };
    const result = new Set();
    for (const { set, count } of Sets.active(ids)) {
      for (const rule of set.addRules) {
        if (count < rule.need) continue;
        let speedBonus = 0;
        let matched = false;
        for (const [rawKey, rawValue] of Object.entries(rule.stats)) {
          const value = Number(rawValue);
          if (!Number.isFinite(value) || value === 0) continue;
          const key = normalize(rawKey);
          if (key === 'speedd') speedBonus += value;
          else if (matches(key)) matched = true;
          if (matched) break;
        }
        const mainId = set.mainNeed > 0 ? set.mainNeed : Number(set.mainId);
        if (!matched && speedBonus && matches('speed') && mainId && ids.has(mainId)) matched = true;
        if (matched) {
          result.add(set.key);
          break;
        }
      }
    }
    return result;
  }

  enterStatRow(row) {
    this.leaveStatRow();
    const mode = Number(this.ed.setting('buildStatFilterHighlightMode'));
    if (!mode) return;
    this.statRow = row;
    for (const slot of this.talentsForRow(row, mode)) this.ed.nodes.get(Number(this.ed.body[slot].id))?.classList.add('build-stat-filter-hover');
    const sets = this.setsForRow(row);
    for (const { set, item } of this.ed.library.setItems) item.classList.toggle('build-stat-filter-hover-set', sets.has(set.key));
    this.updateCount();
  }

  leaveStatRow() {
    this.statRow = null;
    for (const node of this.field.querySelectorAll('.build-stat-filter-hover')) node.classList.remove('build-stat-filter-hover');
    for (const { item } of this.ed.library.setItems || []) item.classList.remove('build-stat-filter-hover-set');
    this.updateCount();
  }

  updateCount() {
    const value = this.ed.heroPanel?.countValue;
    if (value) value.textContent = String(this.field.querySelectorAll('.build-talent-item.build-stat-filter-hover, .build-talent-item.build-set-highlight').length);
  }

  // Подсветки — снова по текущему билду (после правки)
  refresh() {
    if (this.statRow) this.enterStatRow(this.statRow);
    if (this.hoveredSet?.item.isConnected) {
      this.showSet(this.hoveredSet.set.ids);
      this.previewSet(this.hoveredSet.set);
    }
    this.updateCount();
  }

  // ползунки цвета/толщины подсветки зажаты — подсвечены все таланты
  demo(on) {
    for (const node of this.fieldNodes()) node.classList.toggle('build-highlight-settings-demo', on);
    for (const node of this.libraryNodes()) node.classList.toggle('build-highlight-settings-demo-lib', on);
  }

  destroy() {
    clearInterval(this.blinkTimer);
  }
}
