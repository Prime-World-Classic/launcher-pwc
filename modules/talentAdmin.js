import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { App } from './app.js';
import { HTTP } from './http.js';
import { View } from './view.js';
import { Window } from './window.js';
import { Splash } from './splash.js';
import { NativeAPI } from './nativeApi.js';
import { TalentData } from './talentData.js';
import { domAudioPresets } from './domAudioPresets.js';
import {
  readLangWords,
  setLangValue,
  bumpImportVersion,
  splitTalentName,
  composeTalentName,
  parseCosts,
  parseSimpleTail,
  buildSimpleTail,
  talentDataEntry,
  statsStringFromEntry,
  formatTalentDataJson,
} from './talentAdminFiles.js';

// Админка талантов и героев (View.talents / View.talents2), только для админов.
//
// Что где лежит и куда пишется:
//  - БД (через бэкенд, по ним сервер проверяет билды): у талантов уровень, редкость, тип, конфликты;
//    у героев основной стат атаки, коэффициент автоатаки, модификатор силы, статы;
//  - файлы лаунчера (пишутся прямо на диск через NW, бэкенд не нужен):
//    названия/описания ru и en (content/lang/*.js; стоимость и КД — разметка в названии),
//    статы и «число в описании» обычных, params классовых (content/talent_data/*.json).
// Папка лаунчера — репозиторий pw_classic_launcher (запоминается); после правки файлов их надо закоммитить.

const KINDS = {
  common: {
    title: 'Обычные',
    list: 'talentAll',
    edit: 'talentEdit',
    icon: (id) => `content/talents/${id}.webp`,
    langPrefix: 'talent_',
    file: 'talents.json',
    dbKeys: ['level', 'rarity', 'active', 'conflict'],
    fileKeys: ['stats', 'descriptionStat'],
  },
  hero: {
    title: 'Классовые',
    list: 'talentHeroAll',
    edit: 'talentHeroEdit',
    icon: (id) => `content/htalents/${id}.webp`,
    langPrefix: 'htalent_',
    file: 'hero_talents.json',
    dbKeys: ['level', 'active', 'conflict'],
    fileKeys: ['params'],
  },
  heroes: {
    title: 'Герои',
    list: 'heroAdminAll',
    edit: 'heroAdminEdit',
    icon: (id) => `content/hero/${id}/1.webp`,
    dbKeys: ['osnParam', 'aaKoef', 'modif', 'stats'],
    fileKeys: [],
  },
};

const LABELS = {
  level: 'уровень',
  rarity: 'редкость',
  active: 'тип',
  conflict: 'конфликты',
  stats: 'статы',
  descriptionStat: 'число в описании',
  params: 'параметры описания',
  osnParam: 'основной стат',
  aaKoef: 'коэф. автоатаки',
  modif: 'модификатор силы',
};

const RARITY = {
  0: { key: null, name: 'Без редкости' },
  1: { key: 'titleTheBlue', name: 'Синее' },
  2: { key: 'titleThePurple', name: 'Фиолетовое' },
  3: { key: 'titleTheOrange', name: 'Оранжевое' },
  4: { key: 'titleTheRed', name: 'Красное' },
};

// Статы из глоссария lang (раздел «Стата талантов»); к ним добавляются ключи, найденные в данных.
const STAT_KEYS = [
  'hp', 'mp', 'sila', 'razum', 'provorstvo', 'hitrost', 'stoikost', 'volia', 'health', 'speedtal',
  'sr', 'ph', 'sv', 'srsv', 'hpmp', 'regenhp', 'regenmp', 'krajahp', 'krajamp',
  'silarz', 'razumrz', 'provorstvorz', 'hitrostrz', 'stoikostrz', 'voliarz', 'speedtalrz', 'krajahprz',
  'silavz', 'razumvz', 'provorstvovz', 'hitrostvz', 'svvz', 'regenhpvz', 'regenmpvz', 'krajahpvz', 'speedtalvz',
];

const LEVELS = [1, 2, 3, 4, 5, 6];
const MMTEST_LEVELS = [11, 22, 33, 44, 55, 66];
const LANGS = ['ru', 'en'];
const ROOT_STORAGE_KEY = 'tadm.launcherRoot';

const clone = (value) => JSON.parse(JSON.stringify(value));

export class TalentAdmin {
  static render(kind = 'common') {
    return new TalentAdmin(kind).root;
  }

  constructor(kind) {
    this.kind = KINDS[kind] ? kind : 'common';
    this.rows = { common: [], hero: [], heroes: [] };
    this.byId = { common: new Map(), hero: new Map(), heroes: new Map() };
    this.items = { common: [], hero: [], heroes: [] };
    this.content = { common: {}, hero: {} };
    this.words = { ru: {}, en: {} };
    this.loaded = false;
    this.selectedId = null;
    this.draft = null;
    this.orig = null;
    this.filters = { text: '', level: '', rarity: '', active: '', hero: '' };
    this.sort = 'id';

    this.build();
    this.load();

    // Esc закрывает админку. Глобальный обработчик лаунчера (App) на Esc открывает меню —
    // перехватываем раньше него (capture), пока страница на экране и поверх нет окон/сплэша.
    this.onEscape = (e) => {
      if (!this.root.isConnected) {
        document.removeEventListener('keydown', this.onEscape, true);
        return;
      }
      if (e.key !== 'Escape' || Splash.body?.style.display === 'flex' || Window.anyOpen?.()) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    };
    document.addEventListener('keydown', this.onEscape, true);
  }

  close() {
    if (!this.confirmDiscard()) return;
    document.removeEventListener('keydown', this.onEscape, true);
    View.show('castle');
  }

  // ---------- папка лаунчера и файлы ----------

  get fs() {
    return NativeAPI.status && NativeAPI.fileSystem && NativeAPI.path ? NativeAPI.fileSystem : null;
  }

  filePath(...parts) {
    return NativeAPI.path.join(this.rootDir, ...parts);
  }

  // Папка репозитория лаунчера: сохранённая, иначе текущая папка, если это git-репозиторий с content/lang.
  resolveRoot() {
    this.rootDir = '';
    this.rootError = '';

    if (!this.fs) {
      this.rootError = 'Запись файлов работает только в лаунчере (NW)';
      return;
    }

    let saved = '';
    try {
      saved = localStorage.getItem(ROOT_STORAGE_KEY) || '';
    } catch {}

    const candidates = saved ? [saved] : [process.cwd()];

    for (const dir of candidates) {
      const ok = this.fs.existsSync(NativeAPI.path.join(dir, 'content', 'lang', 'ru.js'));
      if (ok && (saved || this.fs.existsSync(NativeAPI.path.join(dir, '.git')))) {
        this.rootDir = dir;
        return;
      }
    }

    this.rootError = saved ? `В папке ${saved} нет content/lang/ru.js` : 'Не задана папка репозитория лаунчера';
  }

  refreshRootButton() {
    this.rootButton.textContent = this.rootDir ? `Папка: ${this.rootDir}` : `Папка лаунчера: ${this.rootError}`;
    this.rootButton.classList.toggle('tadm-attention', !this.rootDir);
    this.rootButton.title = this.rootDir
      ? 'Сюда пишутся тексты (content/lang) и talent_data. Нажмите, чтобы сменить.'
      : 'Укажите папку репозитория pw_classic_launcher — туда будут записываться тексты и talent_data.';
  }

  changeRoot() {
    if (!this.fs) {
      App.error(this.rootError);
      return;
    }
    if (!this.confirmDiscard()) return;

    this.pickDirectory((picked) => {
      // Выбрали content или content/lang внутри репозитория — поднимаемся до корня.
      let dir = picked;
      for (let i = 0; i < 3 && dir && !this.fs.existsSync(NativeAPI.path.join(dir, 'content', 'lang', 'ru.js')); i++) {
        const parent = NativeAPI.path.dirname(dir);
        dir = parent === dir ? '' : parent;
      }

      if (!dir || !this.fs.existsSync(NativeAPI.path.join(dir, 'content', 'lang', 'ru.js'))) {
        App.error(`В папке ${picked} нет content/lang/ru.js — выберите папку репозитория pw_classic_launcher`);
        return;
      }

      try {
        localStorage.setItem(ROOT_STORAGE_KEY, dir);
      } catch {}

      this.reload();
    });
  }

  // Системный диалог выбора папки (NW: input с атрибутом nwdirectory отдаёт полный путь).
  pickDirectory(onPick) {
    // Диалог отменили — change не придёт, старый input убираем при следующем открытии.
    document.querySelectorAll('.tadm-dir-picker').forEach((el) => el.remove());

    const input = DOM({ tag: 'input', type: 'file', style: 'tadm-dir-picker' });
    input.setAttribute('nwdirectory', '');
    if (this.rootDir) input.setAttribute('nwworkingdir', this.rootDir);
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const dir = input.files?.[0]?.path || input.value;
      input.remove();
      if (dir) onPick(dir);
    });

    document.body.append(input);
    input.click();
  }

  readText(...parts) {
    return this.fs.readFileSync(this.filePath(...parts), 'utf8');
  }

  writeText(text, ...parts) {
    this.fs.writeFileSync(this.filePath(...parts), text, 'utf8');
  }

  // ---------- данные ----------

  async load() {
    this.resolveRoot();
    this.refreshRootButton();

    try {
      const bust = `?t=${Date.now()}`;
      const readJson = async (file) => {
        if (this.rootDir) return JSON.parse(this.readText('content', 'talent_data', file));
        return HTTP.request(`content/talent_data/${file}${bust}`).catch(() => ({}));
      };

      const [common, hero, heroes, contentCommon, contentHero] = await Promise.all([
        App.api.requestPaged('build', KINDS.common.list),
        App.api.requestPaged('build', KINDS.hero.list),
        App.api.requestPaged('build', KINDS.heroes.list).catch(() => null),
        readJson(KINDS.common.file),
        readJson(KINDS.hero.file),
      ]);

      this.rows.common = common;
      this.rows.hero = hero;
      this.rows.heroes = heroes || [];
      this.heroesError = heroes ? '' : 'Бэкенд ещё без heroAdminAll — нужен деплой';
      this.content.common = contentCommon || {};
      this.content.hero = contentHero || {};

      for (const lang of LANGS) {
        this.words[lang] = this.rootDir ? readLangWords(this.readText('content', 'lang', `${lang}.js`)) : { ...(Lang.list?.[lang]?.word || {}) };
      }

      for (const kind of Object.keys(KINDS)) {
        this.byId[kind].clear();
        this.items[kind] = [];
        for (const row of this.rows[kind]) {
          row.id = Number(row.id);
          this.applyFileFields(kind, row);
          this.byId[kind].set(row.id, row);
        }
      }
    } catch (error) {
      this.listEl.replaceChildren(DOM({ style: 'tadm-empty' }, `Не удалось загрузить: ${error?.message || error}`));
      return;
    }

    this.loaded = true;
    this.fillStatKeys();
    this.switchKind(this.kind, true);
  }

  reload() {
    this.loaded = false;
    this.selectedId = null;
    this.draft = null;
    this.orig = null;
    this.listEl.replaceChildren(DOM({ style: 'tadm-empty' }, 'Загрузка…'));
    this.editorEl.replaceChildren();
    this.load();
  }

  // Статы / txtNum / params берём из talent_data (их читает лаунчер), а не из старых полей БД.
  applyFileFields(kind, row) {
    if (kind === 'heroes') return;

    const entry = this.content[kind][row.id];
    row.fileMissing = !entry;
    if (!entry) return;

    if (kind === 'hero') {
      row.params = entry.params ?? '';
    } else {
      row.stats = statsStringFromEntry(entry);
      row.descriptionStat = entry.txtNum ?? '';
    }
  }

  word(lang, key) {
    return this.words[lang]?.[key] ?? '';
  }

  text(key) {
    return this.word(Lang.target, key) || this.word('ru', key);
  }

  nameKey(kind, id) {
    return kind === 'heroes' ? `hero_${id}_name` : `${KINDS[kind].langPrefix}${id}_name`;
  }

  descriptionKey(kind, id) {
    return `${KINDS[kind].langPrefix}${id}_description`;
  }

  // Имя без стоимости/КД (для списка и поиска)
  name(kind, id, lang = null) {
    const raw = lang ? this.word(lang, this.nameKey(kind, id)) : this.text(this.nameKey(kind, id));
    if (kind === 'heroes') return raw;
    const { title, tail } = splitTalentName(raw);
    return title.trim() || tail.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  costsOf(raw) {
    const tail = splitTalentName(raw).tail;
    return { tail, ...parseCosts(tail) };
  }

  costs(kind, id) {
    return kind === 'heroes' ? this.costsOf('') : this.costsOf(this.text(this.nameKey(kind, id)));
  }

  costsText(costs) {
    const parts = [];
    if (costs.mana.length) parts.push(`энергия ${costs.mana.join(' / ')}`);
    if (costs.life.length) parts.push(`здоровье ${costs.life.join(' / ')}`);
    if (costs.detail.length) parts.push(`детали ${costs.detail.join(' / ')}`);
    if (costs.cd.length) parts.push(`кд ${costs.cd.join(' / ')} с`);
    return parts.join(', ');
  }

  // Разметка из нашего же lang (те же теги, что в билде); <white> снимаем — на тёмном фоне он лишний.
  markup(html, style) {
    const element = DOM({ tag: 'span', style });
    element.innerHTML = String(html || '').replace(/<\/?white>/g, '');
    return element;
  }

  heroName(id) {
    return this.text(`hero_${id}_name`) || `hero ${id}`;
  }

  // hero1/hero2 — обычно один и тот же герой за обе фракции, имя показываем один раз.
  heroNames(row) {
    const names = [row.hero1, row.hero2]
      .map(Number)
      .filter((id) => id > 0)
      .map((id) => this.heroName(id));
    return [...new Set(names)];
  }

  statLabel(key) {
    const text = Lang.text(key);
    const plain = text === key ? '' : String(text).replace(/<[^>]*>/g, '').trim();
    if (key.startsWith('speedtal')) {
      return `Скорость${plain.replace(/^%/, '')}`;
    }
    return plain.length > 2 ? plain : key;
  }

  fillStatKeys() {
    const keys = new Set(STAT_KEYS);

    for (const kind of ['common', 'heroes']) {
      for (const row of this.rows[kind]) {
        for (const item of String(row.stats || '').split(';')) {
          const key = item.split(',')[2];
          if (key) keys.add(key);
        }
      }
    }

    this.statKeys = [...keys];
  }

  rarityName(rarity) {
    const item = RARITY[rarity] || RARITY[0];
    if (!item.key) return item.name;
    const text = Lang.text(item.key);
    return text === item.key ? item.name : text;
  }

  // ---------- каркас ----------

  build() {
    this.root = DOM({ style: 'tadm', tabIndex: -1 });

    this.tabs = {};
    const tabs = DOM({ style: 'tadm-tabs' });
    for (const kind of Object.keys(KINDS)) {
      const tab = DOM(
        { tag: 'button', style: 'tadm-tab', domaudio: domAudioPresets.defaultButton, event: ['click', () => this.switchKind(kind)] },
        KINDS[kind].title,
        DOM({ tag: 'span', style: 'tadm-tab-count' }, ''),
      );
      this.tabs[kind] = tab;
      tabs.append(tab);
    }

    this.searchInput = DOM({ tag: 'input', style: 'tadm-search', placeholder: 'Поиск: название, id, стат…' });
    this.searchInput.addEventListener('input', () => {
      this.filters.text = this.searchInput.value.trim().toLowerCase();
      this.applyFilters();
    });

    this.levelSelect = this.select(
      [['', 'Все уровни'], ...LEVELS.map((l) => [String(l), `Уровень ${l}`]), ['mmtest', 'Только mmtest']],
      (value) => {
        this.filters.level = value;
        this.applyFilters();
      },
    );

    this.raritySelect = this.select(
      [['', 'Любая редкость'], ...[4, 3, 2, 1, 0].map((r) => [String(r), this.rarityName(r)])],
      (value) => {
        this.filters.rarity = value;
        this.applyFilters();
      },
    );

    this.activeSelect = this.select(
      [['', 'Активные и пассивные'], ['1', 'Только активные'], ['0', 'Только пассивные']],
      (value) => {
        this.filters.active = value;
        this.applyFilters();
      },
    );

    this.heroSelect = this.select([['', 'Все герои']], (value) => {
      this.filters.hero = value;
      this.applyFilters();
    });

    this.sortSelect = this.select([], (value) => {
      this.sort = value;
      this.applySort();
    });

    this.rootButton = DOM({
      tag: 'button',
      style: ['tadm-button', 'tadm-root'],
      domaudio: domAudioPresets.defaultButton,
      event: ['click', () => this.changeRoot()],
    });

    const close = DOM(
      {
        tag: 'button',
        style: ['tadm-button', 'tadm-close'],
        domaudio: domAudioPresets.closeButton,
        event: ['click', () => this.close()],
      },
      '✕',
    );

    this.countEl = DOM({ style: 'tadm-count' });

    const header = DOM(
      { style: 'tadm-header' },
      DOM({ style: 'tadm-header-row' }, DOM({ style: 'tadm-title' }, 'Таланты и герои'), tabs, this.searchInput, close),
      DOM({ style: 'tadm-header-row' }, this.levelSelect, this.raritySelect, this.activeSelect, this.heroSelect, this.sortSelect, this.countEl, this.rootButton),
    );

    this.listEl = DOM({ style: 'tadm-list', tabIndex: 0 }, DOM({ style: 'tadm-empty' }, 'Загрузка…'));
    this.editorEl = DOM({ style: 'tadm-editor' }, DOM({ style: 'tadm-empty' }, 'Выберите слева'));

    this.root.append(header, DOM({ style: 'tadm-body' }, this.listEl, this.editorEl));

    this.root.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        this.save();
        return;
      }

      const tag = e.target?.tagName;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        this.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  select(options, onChange) {
    const element = DOM({ tag: 'select', style: 'tadm-select' });
    this.setOptions(element, options);
    element.addEventListener('change', () => onChange(element.value));
    return element;
  }

  setOptions(element, options) {
    element.replaceChildren(...options.map(([value, text]) => DOM({ tag: 'option', value }, text)));
  }

  // ---------- список ----------

  switchKind(kind, force = false) {
    if (!force && kind === this.kind) return;
    if (!force && !this.confirmDiscard()) return;

    this.kind = kind;
    this.selectedId = null;
    this.draft = null;
    this.orig = null;

    for (const k of Object.keys(KINDS)) {
      this.tabs[k].classList.toggle('tadm-tab-active', k === kind);
      this.tabs[k].lastChild.textContent = this.loaded ? String(this.rows[k].length) : '';
    }

    const talents = kind !== 'heroes';
    this.levelSelect.style.display = talents ? '' : 'none';
    this.activeSelect.style.display = talents ? '' : 'none';
    this.raritySelect.style.display = kind === 'common' ? '' : 'none';
    this.heroSelect.style.display = kind === 'hero' ? '' : 'none';

    const sorts = talents
      ? [['id', 'По id'], ['name', 'По названию'], ['cd', 'По перезарядке'], ['cost', 'По стоимости'], ['level', 'По уровню']]
      : [['id', 'По id'], ['name', 'По имени']];
    this.setOptions(this.sortSelect, sorts);
    if (!sorts.some(([value]) => value === this.sort)) this.sort = 'id';
    this.sortSelect.value = this.sort;

    if (kind === 'hero') {
      // Один герой может быть под двумя id (по фракциям) — в фильтре одна строка на имя.
      const heroes = new Map();
      for (const row of this.rows.hero) {
        for (const id of [row.hero1, row.hero2].map(Number)) {
          if (id <= 0) continue;
          const name = this.heroName(id);
          if (!heroes.has(name)) heroes.set(name, new Set());
          heroes.get(name).add(id);
        }
      }
      const sorted = [...heroes].sort((a, b) => a[0].localeCompare(b[0]));
      this.setOptions(this.heroSelect, [['', 'Все герои'], ...sorted.map(([name, ids]) => [[...ids].join(','), name])]);
      this.heroSelect.value = this.filters.hero;
      if (this.heroSelect.value !== this.filters.hero) this.filters.hero = '';
    }

    if (!this.loaded) return;

    if (kind === 'heroes' && this.heroesError) {
      this.listEl.replaceChildren(DOM({ style: 'tadm-empty' }, this.heroesError));
      this.countEl.textContent = '';
      this.renderEditor();
      return;
    }

    if (!this.items[kind].length) {
      this.items[kind] = this.rows[kind].map((row) => ({ row, element: this.renderRow(kind, row) }));
    }

    this.applySort();
    this.applyFilters();
    this.renderEditor();
  }

  renderRow(kind, row) {
    const element = DOM({
      style: 'tadm-row',
      domaudio: domAudioPresets.defaultButton,
      event: [
        'click',
        () => {
          this.listEl.focus({ preventScroll: true });
          this.selectRow(row.id);
        },
      ],
    });
    element.dataset.id = row.id;
    this.fillRow(kind, row, element);
    return element;
  }

  fillRow(kind, row, element) {
    const name = this.name(kind, row.id) || '— без названия —';
    const meta = [];
    const search = [];
    const badges = DOM({ style: 'tadm-badges' });

    if (kind === 'heroes') {
      meta.push(Number(row.osnParam) === 1 ? 'Сила' : 'Разум', `автоатака ×${row.aaKoef}`, `модиф. ${row.modif}`);
      // Без колонки hero.mirror (бэкенд до деплоя) переключателя нет.
      if ('mirror' in row) {
        badges.append(this.mirrorSwitch(row, element));
        if (Number(row.mirror) === 1) search.push('зеркалка mirror');
      }
      badges.append(DOM({ style: ['tadm-badge', 'tadm-badge-level'], title: 'Обликов' }, `${row.skins || 0} обл.`));
    } else {
      if (kind === 'hero') {
        meta.push(this.heroNames(row).join(', ') || 'без героя');
      } else {
        const stats = TalentAdmin.parseStatValues(row.stats);
        if (stats.length) meta.push(stats.map(([k, v]) => `${v} ${this.statLabel(k)}`).join(', '));
      }

      const costs = this.costs(kind, row.id);
      const level = Number(row.level) || 1;
      // Необязательные отметки — слева, уровень и редкость — у правого края, чтобы стояли колонкой.
      if (row.fileMissing) badges.append(DOM({ style: ['tadm-badge', 'tadm-badge-sync'], title: 'Нет записи в content/talent_data' }, 'нет в talent_data'));
      if (costs.tail) {
        const costsEl = this.markup(costs.tail, 'tadm-costs');
        costsEl.title = this.costsText(costs);
        badges.append(costsEl);
      }
      if (Number(row.active) === 1) badges.append(DOM({ style: ['tadm-badge', 'tadm-badge-active'], title: 'Активный' }, 'акт'));
      badges.append(DOM({ style: ['tadm-badge', MMTEST_LEVELS.includes(level) ? 'tadm-badge-mmtest' : 'tadm-badge-level'] }, MMTEST_LEVELS.includes(level) ? `mm ${level}` : `ур ${level}`));
      if (kind === 'common') badges.append(DOM({ style: ['tadm-badge', `tadm-rarity-${Number(row.rarity) || 0}`], title: this.rarityName(Number(row.rarity) || 0) }, '●'));
      search.push(this.costsText(costs));
    }

    const icon = DOM({ tag: 'img', style: 'tadm-icon', src: KINDS[kind].icon(row.id), loading: 'lazy' });
    icon.onerror = () => icon.classList.add('tadm-icon-missing');

    element.replaceChildren(
      icon,
      DOM(
        { style: 'tadm-row-main' },
        DOM({ style: 'tadm-row-title' }, DOM({ tag: 'span', style: 'tadm-id' }, `#${row.id}`), name),
        DOM({ style: 'tadm-row-meta' }, meta.filter(Boolean).join(' · ')),
      ),
      badges,
    );

    element.dataset.search = [row.id, name, this.name(kind, row.id, 'en'), ...meta, ...search, row.stats || '', row.params || '', row.conflict || ''].join(' ').toLowerCase();
    element.classList.toggle('tadm-row-selected', row.id === this.selectedId);
  }

  // Зеркалка: героя может взять по одному игроку в каждой команде тамбура.
  // Сохраняется в БД сразу по клику, мимо черновика редактора.
  mirrorSwitch(row, element) {
    const on = Number(row.mirror) === 1;
    const button = DOM(
      {
        tag: 'button',
        style: ['tadm-mirror', ...(on ? ['tadm-mirror-on'] : [])],
        domaudio: domAudioPresets.defaultButton,
        title: on
          ? 'Зеркалка разрешена: героя может взять по одному игроку в каждой команде. Нажмите, чтобы запретить.'
          : 'Зеркалка запрещена: герой один на всё лобби. Нажмите, чтобы разрешить.',
      },
      DOM({ tag: 'span', style: 'tadm-mirror-knob' }),
      'зеркалка',
    );
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(on));
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        const result = await App.api.request('build', KINDS.heroes.edit, { id: row.id, object: { mirror: on ? '0' : '1' } });
        row.mirror = result && 'mirror' in result ? Number(result.mirror) : on ? 0 : 1;
        this.fillRow('heroes', row, element);
        App.notify(`${this.heroName(row.id)}: зеркалка ${Number(row.mirror) === 1 ? 'разрешена' : 'запрещена'}`);
      } catch (error) {
        button.disabled = false;
        App.error(`Зеркалка: ${error?.message || error}`);
      }
    });
    return button;
  }

  static parseStatValues(stats) {
    return String(stats || '')
      .split(';')
      .filter(Boolean)
      .map((item) => item.split(','))
      .map((split) => [split[2], split[0]]);
  }

  matches(kind, row, element) {
    const f = this.filters;

    if (f.text && !element.dataset.search.includes(f.text)) return false;
    if (kind === 'heroes') return true;

    const level = Number(row.level) || 1;
    if (f.level === 'mmtest' && !MMTEST_LEVELS.includes(level)) return false;
    if (f.level && f.level !== 'mmtest' && level !== Number(f.level)) return false;
    if (kind === 'common' && f.rarity !== '' && (Number(row.rarity) || 0) !== Number(f.rarity)) return false;
    if (f.active !== '' && Number(row.active) !== Number(f.active)) return false;
    if (kind === 'hero' && f.hero) {
      const ids = f.hero.split(',').map(Number);
      if (!ids.includes(Number(row.hero1)) && !ids.includes(Number(row.hero2))) return false;
    }

    return true;
  }

  // Без значения (нет КД / стоимости) — в конец списка.
  sortValue(kind, row) {
    const first = (list) => (list.length ? Math.max(...list.map(Number)) : null);

    switch (this.sort) {
      case 'name':
        return this.name(kind, row.id) || null;
      case 'cd':
        return first(this.costs(kind, row.id).cd);
      case 'cost': {
        const costs = this.costs(kind, row.id);
        return first([...costs.mana, ...costs.life, ...costs.detail]);
      }
      case 'level':
        return Number(row.level) || 1;
      default:
        return row.id;
    }
  }

  applySort() {
    if (!this.loaded) return;

    const kind = this.kind;
    const keyed = this.items[kind].map((item) => ({ item, value: this.sortValue(kind, item.row) }));
    const descending = this.sort === 'cd' || this.sort === 'cost';

    keyed.sort((a, b) => {
      if (a.value === b.value) return a.item.row.id - b.item.row.id;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (typeof a.value === 'string') return a.value.localeCompare(b.value);
      return descending ? b.value - a.value : a.value - b.value;
    });

    this.items[kind] = keyed.map(({ item }) => item);
    this.listEl.replaceChildren(...this.items[kind].map((item) => item.element));
  }

  applyFilters() {
    if (!this.loaded) return;

    let shown = 0;

    for (const { row, element } of this.items[this.kind]) {
      const visible = this.matches(this.kind, row, element);
      element.style.display = visible ? '' : 'none';
      if (visible) shown++;
    }

    this.countEl.textContent = `Показано ${shown} из ${this.rows[this.kind].length}`;
  }

  moveSelection(step) {
    const visible = this.items[this.kind].filter(({ element }) => element.style.display !== 'none');
    if (!visible.length) return;

    let index = visible.findIndex(({ row }) => row.id === this.selectedId);
    index = index < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, index + step));

    this.selectRow(visible[index].row.id);
    visible[index].element.scrollIntoView({ block: 'nearest' });
  }

  selectRow(id) {
    if (id === this.selectedId) return;
    if (!this.confirmDiscard()) return;

    this.selectedId = id;
    const row = this.byId[this.kind].get(id);
    this.orig = row ? this.snapshot(this.kind, row) : null;
    this.draft = this.orig ? clone(this.orig) : null;

    for (const { row: r, element } of this.items[this.kind]) {
      element.classList.toggle('tadm-row-selected', r.id === id);
    }

    this.renderEditor();
  }

  // ---------- состояние редактора ----------

  textKeys(kind, row) {
    if (kind === 'heroes') {
      const keys = [`hero_${row.id}_name`];
      for (let skin = 2; skin <= Number(row.skins || 0); skin++) keys.push(`hero_${row.id}_skin_${skin}_name`);
      return keys;
    }
    return [this.nameKey(kind, row.id), this.descriptionKey(kind, row.id)];
  }

  snapshot(kind, row) {
    const pick = (keys) => Object.fromEntries(keys.map((key) => [key, row[key] == null ? '' : String(row[key])]));
    const text = {};
    for (const lang of LANGS) {
      text[lang] = Object.fromEntries(this.textKeys(kind, row).map((key) => [key, this.word(lang, key)]));
    }
    return { db: pick(KINDS[kind].dbKeys), file: pick(KINDS[kind].fileKeys), text };
  }

  changes() {
    const result = { db: {}, file: {}, text: { ru: {}, en: {} }, labels: [] };
    if (!this.draft || !this.orig) return result;

    for (const part of ['db', 'file']) {
      for (const key in this.draft[part]) {
        if (this.draft[part][key] !== this.orig[part][key]) {
          result[part][key] = this.draft[part][key];
          result.labels.push(LABELS[key] || key);
        }
      }
    }

    for (const lang of LANGS) {
      for (const key in this.draft.text[lang]) {
        if (this.draft.text[lang][key] !== this.orig.text[lang][key]) {
          result.text[lang][key] = this.draft.text[lang][key];
          result.labels.push(`${lang}: ${this.textLabel(key)}`);
        }
      }
    }

    return result;
  }

  textLabel(key) {
    if (key.endsWith('_description')) return 'описание';
    const skin = key.match(/_skin_(\d+)_name$/);
    if (skin) return `облик ${skin[1]}`;
    return 'название';
  }

  confirmDiscard() {
    if (!this.changes().labels.length) return true;
    return window.confirm('Есть несохранённые изменения. Отбросить их?');
  }

  set(part, key, value) {
    this.draft[part][key] = value;
    this.refreshDirty();
  }

  setText(lang, key, value) {
    this.draft.text[lang][key] = value;
    this.refreshDirty();
  }

  refreshDirty() {
    if (!this.saveButton) return;
    const { labels } = this.changes();
    this.saveButton.disabled = !labels.length;
    this.resetButton.disabled = !labels.length;
    this.changesEl.textContent = labels.length ? `Изменено: ${labels.join(', ')}` : 'Без изменений';
  }

  // ---------- редактор ----------

  renderEditor() {
    const kind = this.kind;
    const row = this.byId[kind].get(this.selectedId);

    if (!row || !this.draft) {
      this.editorEl.replaceChildren(DOM({ style: 'tadm-empty' }, 'Выберите слева (↑/↓ — листать, Ctrl+S — сохранить, Esc — выйти)'));
      return;
    }

    const sections = kind === 'heroes' ? this.heroSections(row) : this.talentSections(kind, row);

    this.saveButton = DOM({ tag: 'button', style: ['tadm-button', 'tadm-save'], domaudio: domAudioPresets.defaultButton, event: ['click', () => this.save()] }, 'Сохранить');
    this.resetButton = DOM(
      {
        tag: 'button',
        style: 'tadm-button',
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          () => {
            this.draft = clone(this.orig);
            this.renderEditor();
          },
        ],
      },
      'Сбросить',
    );
    this.changesEl = DOM({ style: 'tadm-changes' });

    const scroll = DOM({ style: 'tadm-ed-scroll' }, ...sections);
    this.editorEl.replaceChildren(scroll, DOM({ style: 'tadm-ed-footer' }, this.changesEl, this.resetButton, this.saveButton));
    this.refreshDirty();
  }

  head(kind, row, name, sub, tail = '') {
    return DOM(
      { style: 'tadm-ed-head' },
      DOM({ tag: 'img', style: 'tadm-ed-icon', src: KINDS[kind].icon(row.id) }),
      DOM(
        { style: 'tadm-ed-titles' },
        DOM({ style: 'tadm-ed-name' }, name || '— без названия —', tail ? this.markup(tail, 'tadm-ed-costs') : ''),
        DOM({ style: 'tadm-ed-sub' }, sub),
      ),
    );
  }

  section(title, ...children) {
    return DOM({ style: 'tadm-section' }, DOM({ style: 'tadm-section-title' }, ...[].concat(title)), ...children);
  }

  fileNote() {
    return DOM({ tag: 'span', style: 'tadm-muted' }, this.rootDir ? ' → файлы лаунчера' : ' → файлы лаунчера (папка не задана)');
  }

  talentSections(kind, row) {
    const nameKey = this.nameKey(kind, row.id);
    const descriptionKey = this.descriptionKey(kind, row.id);
    const ruName = splitTalentName(this.draft.text.ru[nameKey]);

    const sub = [`#${row.id}`, kind === 'common' && row.externalId ? `externalId ${row.externalId}` : '', kind === 'hero' ? this.heroNames(row).join(', ') || 'без героя' : '']
      .filter(Boolean)
      .join(' · ');

    const sections = [
      this.head(kind, row, ruName.title.trim(), sub, ruName.tail),
      this.section(['Тексты', this.fileNote()], this.talentTextsControl(nameKey, descriptionKey)),
      this.section(['Стоимость и перезарядка', this.fileNote()], this.costControl(nameKey)),
    ];

    const main = this.section('Основное');
    main.append(this.field('Уровень', this.levelControl()));
    if (kind === 'common') main.append(this.field('Редкость', this.rarityControl()));
    main.append(this.field('Тип', this.activeControl()));
    sections.push(main, this.section('Конфликтует с', this.conflictControl()));

    if (kind === 'common') {
      sections.push(
        this.section(
          ['Статы', this.fileNote()],
          this.statsControl('file', ['Значение', 'Заточка']),
          this.field(
            'Число в описании',
            this.textControl('file', 'descriptionStat', 'значение,заточка,стат (txtNum)'),
            'Подставляется в описание вместо числа; формат как у стата: значение,заточка,стат.',
          ),
        ),
      );
    } else {
      sections.push(
        this.section(
          ['Параметры описания', this.fileNote()],
          this.textControl('file', 'params', 'цель,стат,база,тип,от;…', true),
          DOM({ style: 'tadm-hint' }, 'Каждая группа через «;» заполняет очередной %s в описании: цель,коэф…,тип,от какого стата (напр. all,11,147,num,sr_max).'),
        ),
      );
    }

    if (row.fileMissing) {
      sections.push(DOM({ style: ['tadm-hint', 'tadm-warn'] }, 'Записи этого таланта нет в content/talent_data — при сохранении она будет добавлена.'));
    }

    return sections;
  }

  heroSections(row) {
    const nameKey = `hero_${row.id}_name`;
    const sections = [this.head('heroes', row, this.draft.text.ru[nameKey], `#${row.id} · обликов: ${row.skins || 0}`)];

    const table = DOM({ style: 'tadm-lang-table' }, DOM({}, ''), DOM({ style: 'tadm-text-lang' }, 'RU'), DOM({ style: 'tadm-text-lang' }, 'EN'));
    for (const key of this.textKeys('heroes', row)) {
      table.append(DOM({ style: 'tadm-label' }, key === nameKey ? 'Имя' : `Облик ${this.textLabel(key).replace('облик ', '')}`));
      for (const lang of LANGS) {
        const input = DOM({ tag: 'input', style: 'tadm-input', value: this.draft.text[lang][key] });
        input.classList.toggle('tadm-missing-input', !input.value);
        input.addEventListener('input', () => {
          input.classList.toggle('tadm-missing-input', !input.value);
          this.setText(lang, key, input.value);
        });
        table.append(input);
      }
    }
    sections.push(this.section(['Имя и облики', this.fileNote()], table));

    if (row.nameRu && row.nameRu !== this.orig.text.ru[nameKey]) {
      sections.push(DOM({ style: ['tadm-hint', 'tadm-warn'] }, `В БД (для сообщений сервера) имя «${row.nameRu}» — при сохранении русского имени обновится и оно.`));
    }

    const main = this.section('Основное');
    const param = Number(this.draft.db.osnParam);
    const paramOptions = [
      [1, 'Сила (физ. урон)'],
      [2, 'Разум (маг. урон)'],
    ];
    if (![1, 2].includes(param)) paramOptions.push([param, `другое: ${param}`]);
    main.append(this.field('Основной стат атаки', this.segmented(paramOptions, param, (v) => this.set('db', 'osnParam', String(v)))));
    main.append(this.field('Коэф. автоатаки', this.textControl('db', 'aaKoef', 'например 1.2'), 'Урон автоатаки = основной стат × коэффициент (±10%).'));
    main.append(this.field('Модификатор силы', this.textControl('db', 'modif', 'например 1'), 'Множитель прироста статов от мощи героя.'));
    sections.push(main);

    sections.push(this.section('Статы', this.statsControl('db', ['База', 'Рост'])));
    return sections;
  }

  field(label, control, hint = '') {
    return DOM({ style: 'tadm-field' }, DOM({ style: 'tadm-label' }, label), DOM({ style: 'tadm-control' }, control, hint ? DOM({ style: 'tadm-hint' }, hint) : ''));
  }

  // Названия и описания ru/en: имя правится отдельно от хвоста со стоимостью/КД, описание — разметкой с предпросмотром.
  talentTextsControl(nameKey, descriptionKey) {
    const grid = DOM({ style: 'tadm-texts' });

    for (const lang of LANGS) {
      const card = DOM({ style: 'tadm-text-card' }, DOM({ style: 'tadm-text-lang' }, lang.toUpperCase()));

      const nameInput = DOM({ tag: 'input', style: 'tadm-input', placeholder: 'Название' });
      nameInput.value = splitTalentName(this.draft.text[lang][nameKey]).title;
      nameInput.classList.toggle('tadm-missing-input', !nameInput.value.trim());
      nameInput.addEventListener('input', () => {
        const parts = splitTalentName(this.draft.text[lang][nameKey]);
        nameInput.classList.toggle('tadm-missing-input', !nameInput.value.trim());
        this.setText(lang, nameKey, composeTalentName({ ...parts, title: nameInput.value }));
      });

      const description = DOM({ tag: 'textarea', style: ['tadm-input', 'tadm-mono'], placeholder: lang === 'ru' ? 'Описание (пусто — строится из статов)' : 'Description' });
      description.rows = 4;
      description.value = this.draft.text[lang][descriptionKey];
      const preview = DOM({ style: 'tadm-text-body' });
      const renderPreview = () => {
        preview.innerHTML = description.value;
        description.classList.toggle('tadm-missing-input', lang === 'en' && !description.value.trim() && Boolean(this.draft.text.ru[descriptionKey].trim()));
      };
      description.addEventListener('input', () => {
        renderPreview();
        this.setText(lang, descriptionKey, description.value);
      });
      renderPreview();

      card.append(nameInput, description, preview);
      grid.append(card);
    }

    return grid;
  }

  // Стоимость и КД — разметка в названии. Простые случаи — полями сразу для ru и en, сложные — разметкой.
  costControl(nameKey) {
    const wrap = DOM({ style: 'tadm-cost' });
    const tails = Object.fromEntries(LANGS.map((lang) => [lang, splitTalentName(this.draft.text[lang][nameKey]).tail]));
    const simple = Object.fromEntries(LANGS.map((lang) => [lang, parseSimpleTail(tails[lang])]));
    const same = simple.ru && simple.en && simple.ru.type === simple.en.type && simple.ru.cost === simple.en.cost && simple.ru.cd === simple.en.cd;

    const setTail = (lang, tail) => {
      const parts = splitTalentName(this.draft.text[lang][nameKey]);
      this.setText(lang, nameKey, composeTalentName({ ...parts, tail }));
    };

    if (same) {
      const state = { ...simple.ru };
      const update = () => {
        for (const lang of LANGS) setTail(lang, buildSimpleTail({ ...state, white: simple[lang].white }));
        preview.replaceChildren(this.markup(buildSimpleTail(state), 'tadm-costs'));
      };

      const costInput = DOM({ tag: 'input', style: ['tadm-input', 'tadm-num'], value: state.cost, placeholder: '—' });
      costInput.addEventListener('input', () => {
        state.cost = costInput.value.trim();
        if (state.cost && !state.type) state.type = 'mana';
        update();
      });

      const cdInput = DOM({ tag: 'input', style: ['tadm-input', 'tadm-num'], value: state.cd, placeholder: '—' });
      cdInput.addEventListener('input', () => {
        state.cd = cdInput.value.trim();
        update();
      });

      const type = this.segmented(
        [
          ['mana', 'Энергия'],
          ['lifecost', 'Здоровье'],
          ['', 'Нет'],
        ],
        state.type,
        (v) => {
          state.type = v;
          if (!v) costInput.value = state.cost = '';
          update();
        },
      );

      const preview = DOM({ style: 'tadm-inline' }, this.markup(tails.ru, 'tadm-costs'));
      wrap.append(
        this.field('Стоимость', DOM({ style: 'tadm-inline' }, type, costInput)),
        this.field('Перезарядка, сек', DOM({ style: 'tadm-inline' }, cdInput, preview)),
      );
    } else {
      wrap.append(DOM({ style: 'tadm-hint' }, 'Сложная запись (несколько значений, детали, варианты) — правьте разметку: <mana>50</mana>, <lifecost>45</lifecost>, <CD>3</CD>, 20<detail></detail>.'));
      for (const lang of LANGS) {
        const input = DOM({ tag: 'input', style: ['tadm-input', 'tadm-mono'], value: tails[lang], placeholder: 'нет' });
        const preview = this.markup(tails[lang], 'tadm-costs');
        input.addEventListener('input', () => {
          preview.innerHTML = input.value.replace(/<\/?white>/g, '');
          setTail(lang, input.value);
        });
        wrap.append(this.field(lang.toUpperCase(), DOM({ style: 'tadm-inline' }, input, preview)));
      }
    }

    wrap.append(DOM({ style: 'tadm-hint' }, 'Это текст подсказки в лаунчере. Настоящие стоимость и перезарядка в бою задаются в данных игры (Prime-World, .xdb) — их это не меняет.'));
    return wrap;
  }

  segmented(options, value, onPick) {
    const wrap = DOM({ style: 'tadm-seg' });
    for (const [optionValue, text, extra] of options) {
      const button = DOM(
        {
          tag: 'button',
          style: ['tadm-seg-item', ...(extra ? [extra] : [])],
          domaudio: domAudioPresets.defaultButton,
          event: [
            'click',
            () => {
              wrap.querySelectorAll('.tadm-seg-item').forEach((b) => b.classList.remove('tadm-seg-active'));
              button.classList.add('tadm-seg-active');
              onPick(optionValue);
            },
          ],
        },
        text,
      );
      if (String(optionValue) === String(value)) button.classList.add('tadm-seg-active');
      wrap.append(button);
    }
    return wrap;
  }

  levelControl() {
    const current = Number(this.draft.db.level) || 0;
    const options = LEVELS.map((l) => [l, String(l)]);
    let mm = null;
    const wrap = DOM(
      { style: 'tadm-inline' },
      this.segmented(options, current, (v) => {
        if (mm) mm.value = '';
        this.set('db', 'level', String(v));
      }),
    );

    mm = this.select([['', 'mmtest…'], ...MMTEST_LEVELS.map((l) => [String(l), `${l} (mmtest, ур ${l / 11})`])], (v) => {
      if (!v) return;
      wrap.querySelectorAll('.tadm-seg-item').forEach((b) => b.classList.remove('tadm-seg-active'));
      this.set('db', 'level', v);
    });
    if (MMTEST_LEVELS.includes(current)) mm.value = String(current);
    mm.title = 'Уровни 11…66 видны только в mmtest-клиенте';
    wrap.append(mm);

    if (!current) wrap.append(DOM({ style: 'tadm-hint' }, 'не задан — считается 1'));
    return wrap;
  }

  rarityControl() {
    return this.segmented(
      [4, 3, 2, 1, 0].map((r) => [r, this.rarityName(r), `tadm-rarity-${r}`]),
      Number(this.draft.db.rarity) || 0,
      (v) => this.set('db', 'rarity', String(v)),
    );
  }

  activeControl() {
    return this.segmented(
      [
        [0, 'Пассивный'],
        [1, 'Активный'],
      ],
      Number(this.draft.db.active) ? 1 : 0,
      (v) => this.set('db', 'active', String(v)),
    );
  }

  conflictIds() {
    return String(this.draft.db.conflict || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  conflictControl() {
    const kind = this.kind;
    const wrap = DOM({ style: 'tadm-conflicts' });
    const chips = DOM({ style: 'tadm-chips' });

    const renderChips = () => {
      const ids = this.conflictIds();
      chips.replaceChildren(
        ...(ids.length
          ? ids.map((id) => {
              const known = this.byId[kind].has(Number(id));
              const remove = DOM({ tag: 'span', style: 'tadm-chip-x', title: 'Убрать' }, '✕');
              remove.addEventListener('click', (e) => {
                e.stopPropagation();
                this.set('db', 'conflict', this.conflictIds().filter((x) => x !== id).join(','));
                renderChips();
              });
              const chip = DOM(
                { style: ['tadm-chip', ...(known ? [] : ['tadm-chip-bad'])], title: known ? 'Открыть' : 'Такого таланта нет' },
                DOM({ tag: 'img', src: KINDS[kind].icon(id) }),
                `#${id} ${this.name(kind, id) || ''}`,
                remove,
              );
              if (known) chip.addEventListener('click', () => this.selectRow(Number(id)));
              return chip;
            })
          : [DOM({ style: 'tadm-muted' }, 'нет')]),
      );
    };

    const listId = `tadm-conflict-list-${kind}`;
    const datalist = DOM({ tag: 'datalist', id: listId });
    datalist.append(...this.rows[kind].map((r) => DOM({ tag: 'option', value: `${r.id} ${this.name(kind, r.id)}` })));

    const input = DOM({ tag: 'input', style: 'tadm-input', placeholder: 'id или название' });
    input.setAttribute('list', listId);

    const add = () => {
      const value = input.value.trim();
      let id = (value.match(/^\d+/) || [])[0];
      if (!id && value) {
        const found = this.rows[kind].find((r) => this.name(kind, r.id).toLowerCase() === value.toLowerCase());
        id = found ? String(found.id) : null;
      }
      if (!id) {
        App.error('Укажите id таланта');
        return;
      }
      if (Number(id) === this.selectedId) {
        App.error('Талант не может конфликтовать сам с собой');
        return;
      }
      const ids = this.conflictIds();
      if (!ids.includes(id)) this.set('db', 'conflict', [...ids, id].join(','));
      input.value = '';
      renderChips();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });

    renderChips();
    wrap.append(
      chips,
      DOM(
        { style: 'tadm-inline' },
        input,
        datalist,
        DOM({ tag: 'button', style: 'tadm-button', domaudio: domAudioPresets.defaultButton, event: ['click', add] }, 'Добавить'),
      ),
      DOM({ style: 'tadm-hint' }, kind === 'hero' ? 'Только с классовыми талантами того же героя.' : 'Только с обычными талантами.'),
    );
    return wrap;
  }

  // Статы «значение,второе,стат;…»: у талантов второе — заточка, у героев — рост.
  statsControl(part, [valueLabel, secondLabel]) {
    const wrap = DOM({ style: 'tadm-stats' });
    const items = String(this.draft[part].stats || '')
      .split(';')
      .filter((s) => s.trim() !== '')
      .map((s) => s.split(','));

    const raw = DOM({ style: ['tadm-hint', 'tadm-mono'] }, this.draft[part].stats || '(пусто)');
    const write = () => {
      this.set(
        part,
        'stats',
        items
          .filter((item) => item[2])
          .map((item) => `${String(item[0] ?? '').trim()},${String(item[1] ?? '').trim()},${item[2]}`)
          .join(';'),
      );
      raw.textContent = this.draft[part].stats || '(пусто)';
    };

    const rowsEl = DOM({ style: 'tadm-stat-rows' });
    const statOptions = (current) => {
      const options = this.statKeys.map((k) => [k, `${this.statLabel(k)} (${k})`]);
      return current && !this.statKeys.includes(current) ? [[current, current], ...options] : options;
    };

    const renderRows = () => {
      rowsEl.replaceChildren(
        DOM({ style: ['tadm-stat-row', 'tadm-stat-head'] }, DOM({}, 'Стат'), DOM({}, valueLabel), DOM({}, secondLabel), DOM({}, '')),
        ...items.map((item, index) => {
          const key = this.select(statOptions(item[2]), (v) => {
            item[2] = v;
            write();
          });
          key.value = item[2] || '';

          const num = (i) => {
            const input = DOM({ tag: 'input', style: 'tadm-input', value: item[i] ?? '' });
            const check = () => input.classList.toggle('tadm-invalid', !Number.isFinite(Number(input.value)) || input.value.trim() === '');
            input.addEventListener('input', () => {
              item[i] = input.value;
              check();
              write();
            });
            check();
            return input;
          };

          const remove = DOM(
            {
              tag: 'button',
              style: ['tadm-button', 'tadm-icon-button'],
              title: 'Убрать стат',
              domaudio: domAudioPresets.defaultButton,
              event: [
                'click',
                () => {
                  items.splice(index, 1);
                  write();
                  renderRows();
                },
              ],
            },
            '✕',
          );

          return DOM({ style: 'tadm-stat-row' }, key, num(0), num(1), remove);
        }),
      );
    };

    const add = DOM(
      {
        tag: 'button',
        style: 'tadm-button',
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          () => {
            items.push(['0', '0', this.statKeys[0]]);
            write();
            renderRows();
          },
        ],
      },
      '+ стат',
    );

    renderRows();
    wrap.append(rowsEl, DOM({ style: 'tadm-inline' }, add, raw));
    return wrap;
  }

  textControl(part, key, placeholder, multiline = false) {
    const input = DOM({ tag: multiline ? 'textarea' : 'input', style: ['tadm-input', 'tadm-mono'], placeholder });
    input.value = this.draft[part][key] ?? '';
    if (multiline) input.rows = 3;
    input.addEventListener('input', () => this.set(part, key, input.value));
    return input;
  }

  // ---------- сохранение ----------

  async save() {
    const changes = this.changes();
    if (!changes.labels.length || !this.saveButton || this.saving) return;

    const kind = this.kind;
    const id = this.selectedId;
    const row = this.byId[kind].get(id);
    const touchesFiles = Object.keys(changes.file).length || LANGS.some((lang) => Object.keys(changes.text[lang]).length);

    if (touchesFiles && !this.rootDir) {
      App.error(`Тексты и talent_data пишутся в файлы лаунчера: ${this.rootError}`);
      return;
    }

    // Русское имя героя дублируется в БД (person_ru) — для сообщений сервера.
    const heroNameKey = `hero_${id}_name`;
    if (kind === 'heroes' && heroNameKey in changes.text.ru && changes.text.ru[heroNameKey].trim()) {
      changes.db.nameRu = changes.text.ru[heroNameKey].trim();
    }

    this.saving = true;
    this.saveButton.disabled = true;
    this.saveButton.textContent = 'Сохранение…';

    const done = [];

    try {
      if (Object.keys(changes.db).length) {
        const result = await App.api.request('build', KINDS[kind].edit, { id, object: changes.db });
        Object.assign(row, result && typeof result === 'object' ? result : changes.db);
        done.push('БД');
      }

      if (Object.keys(changes.file).length) {
        this.saveTalentData(kind, row, changes.file);
        done.push(`talent_data/${KINDS[kind].file}`);
      }

      const langs = LANGS.filter((lang) => Object.keys(changes.text[lang]).length);
      if (langs.length) {
        this.saveLang(kind, row, changes.text, langs);
        done.push(...langs.map((lang) => `lang/${lang}.js`));
      }

      this.orig = this.snapshot(kind, row);
      this.draft = clone(this.orig);

      const item = this.items[kind].find((i) => i.row.id === id);
      if (item) this.fillRow(kind, row, item.element);

      App.notify(`#${id} сохранено: ${done.join(', ')}${done.some((d) => d !== 'БД') ? ' — не забудьте закоммитить лаунчер' : ''}`);
      this.renderEditor();
    } catch (error) {
      App.error(`${done.length ? `Сохранено: ${done.join(', ')}. ` : ''}Ошибка: ${error?.message || error}`);
      if (this.saveButton) {
        this.saveButton.textContent = 'Сохранить';
        this.refreshDirty();
      }
    } finally {
      this.saving = false;
    }
  }

  saveTalentData(kind, row, fileChanges) {
    const file = KINDS[kind].file;
    const text = this.readText('content', 'talent_data', file);
    const data = JSON.parse(text);
    const fields = { ...row, ...fileChanges };
    const entry = talentDataEntry(kind, fields);

    data[row.id] = entry;
    this.writeText(formatTalentDataJson(data, text.includes('\r\n') ? '\r\n' : '\n'), 'content', 'talent_data', file);

    Object.assign(row, fileChanges);
    row.fileMissing = false;
    this.content[kind] = data;

    // Текущая сессия лаунчера сразу видит новые значения в билдах.
    if (kind === 'hero') TalentData.hero[row.id] = clone(entry);
    else TalentData.common[row.id] = clone(entry);
  }

  saveLang(kind, row, textChanges, langs) {
    for (const lang of langs) {
      let text = this.readText('content', 'lang', `${lang}.js`);

      for (const [key, value] of Object.entries(textChanges[lang])) {
        text = setLangValue(text, key, value, this.langAnchors(kind, row, key));
        this.words[lang][key] = value;
        if (Lang.list?.[lang]?.word) Lang.list[lang].word[key] = value;
      }

      this.writeText(text, 'content', 'lang', `${lang}.js`);
    }

    Lang.clearCache?.();

    // Версия lang в importmap — иначе клиенты возьмут старый файл из кэша.
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-admin-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      let html = this.readText('index.html');
      for (const lang of langs) html = bumpImportVersion(html, `/content/lang/${lang}.js`, stamp);
      this.writeText(html, 'index.html');
    } catch {}
  }

  // Куда вставлять отсутствующий ключ: рядом с соседними ключами того же таланта/героя.
  langAnchors(kind, row, key) {
    const anchors = [];

    if (kind === 'heroes') {
      const skin = key.match(/_skin_(\d+)_name$/);
      if (skin) {
        for (let s = Number(skin[1]) - 1; s >= 2; s--) anchors.push(`hero_${row.id}_skin_${s}_name`);
        anchors.push(`hero_${row.id}_name`);
      }
      for (let id = row.id - 1; id > 0 && anchors.length < 40; id--) anchors.push(`hero_${id}_name`);
      return anchors;
    }

    const prefix = KINDS[kind].langPrefix;
    if (key.endsWith('_description')) anchors.push(`${prefix}${row.id}_name`);
    for (let id = row.id - 1; id > 0 && anchors.length < 60; id--) anchors.push(`${prefix}${id}_description`, `${prefix}${id}_name`);
    return anchors;
  }
}
