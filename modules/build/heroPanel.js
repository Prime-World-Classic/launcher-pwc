// Левая колонка окна билда: аватар героя (облик, рамка, ранг), имя, рейтинг, панель статов
// (фильтр библиотеки по стату, галочки приоритета, подсветка талантов стата), листание героев
// (стрелки, A/D), выбор облика и тренировка. Переключатель родной/вражеской земли — у фильтров.

import { App } from '../app.js';
import { DOM } from '../dom.js';
import { Lang } from '../lang.js';
import { View } from '../view.js';
import { Window } from '../window.js';
import { MM } from '../mm.js';
import { Rank } from '../rank.js';
import { Splash } from '../splash.js';
import { NativeAPI } from '../nativeApi.js';
import { HeroFrame } from '../heroFrame.js';
import { PreloadImages } from '../preloadImages.js';
import { domAudioPresets } from '../domAudioPresets.js';
import { TALENT_COOLDOWN_PCT_MAX } from './stats.js';

// строки панели статов: ключ — подпись; passive — считается формулой, без фильтра
const ROWS = [
  ['hp', 'health'], ['mp', 'energy'], ['speed', 'speed'], ['regenhp', 'statRegenHealth'], ['regenmp', 'statRegenEnergy'],
  ['krajahp', 'statStealHealth'], ['krajamp', 'statStealEnergy'], ['talentCdPct', 'statTalentCooldownPct'],
  ['sila', 'strength'], ['razum', 'intelligence'], ['provorstvo', 'agility'], ['hitrost', 'dexterity'], ['stoikost', 'stamina'], ['volia', 'will'],
  ['damage', 'damage'], ['critProb', 'criticalHit'], ['attackSpeed', 'attacksPerSecond'], ['punching', 'penetration'],
  ['protectionBody', 'defencePsys'], ['protectionSpirit', 'defenceMagic'],
];
const PASSIVE = new Set(['damage', 'critProb', 'attackSpeed', 'punching', 'protectionBody', 'protectionSpirit']);
// галочка приоритета: место в build.profile (на сервере 9 значений, 0–2 не используются)
const PROFILE_INDEX = { sila: 3, razum: 4, provorstvo: 5, hitrost: 6, stoikost: 7, volia: 8 };

export const setTooltip = (element, text) => {
  const tooltip = String(text ?? '').trim();
  if (tooltip) element.dataset.tooltip = tooltip;
  else delete element.dataset.tooltip;
  element.removeAttribute('title');
};

// Имя героя в плашке: не влезает — бежит строкой при наведении
export function setHeroName(element, text) {
  let label = element.querySelector('.build-hero-name-text');
  if (!label) {
    label = DOM({ tag: 'span', style: 'build-hero-name-text' });
    element.replaceChildren(label);
    element.tabIndex = 0;
    const measure = () => {
      const style = getComputedStyle(element);
      const overflow = Math.max(0, label.scrollWidth - (element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
      element.style.setProperty('--nickname-scroll-distance', `${overflow}px`);
      element.style.setProperty('--build-hero-name-scroll-duration', `${Math.max(6, overflow / 30 + 3)}s`);
      element.classList.toggle('build-hero-name--overflowing', overflow > 1);
    };
    element.addEventListener('mouseenter', measure);
    element.addEventListener('focus', measure);
  }
  label.textContent = String(text ?? '');
  element.title = label.textContent;
  element.classList.remove('build-hero-name--overflowing');
}

const skinUrl = (heroId, skin) => `content/hero/${heroId}/${skin}.webp`;

// облик без своей картинки (новый, картинку ещё не положили) — картинка облика 1
PreloadImages.fallbacks.heroSkin = (element) => skinUrl(element.dataset.hero, 1);

export function avatarBackground(element, heroId, skinId) {
  const skin = Number(skinId) > 0 ? Number(skinId) : 1;
  const apply = (shown) =>
    // contain: рамка, нарисованная в картинке облика, не обрезается
    Object.assign(element.style, {
      backgroundImage: `url(${skinUrl(heroId, shown)}), url(content/hero/background.png)`,
      backgroundSize: 'contain, 100%',
      backgroundPosition: 'center, center',
      backgroundRepeat: 'no-repeat, no-repeat',
    });
  element.dataset.skin = skin;
  apply(skin);
  if (skin === 1) return;
  const image = new Image();
  image.onerror = () => Number(element.dataset.skin) === skin && apply(1);
  image.src = skinUrl(heroId, skin);
}

// Герои списка внизу замка по порядку
export function castleHeroIds() {
  const ids = [];
  for (const node of View.castleBottom?.querySelectorAll?.('.castle-hero-item') || []) {
    const id = Number(node.dataset.heroId) || Number(/^id(\d+)$/.exec(node.id || '')?.[1]);
    if (id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const splashOpen = () => Splash.body && getComputedStyle(Splash.body).display !== 'none';

// Соседний герой списка замка; cancelOnSplash — открылось окно поверх (подтверждение) — вернуть
export async function switchHero(currentHeroId, direction = 1, wait = true, cancelOnSplash = false) {
  if (splashOpen()) return;
  const ids = castleHeroIds();
  if (!ids.length) return;
  const highlighted = Number(View.castleOpenedBuildHeroId);
  const current = highlighted > 0 ? highlighted : Number(currentHeroId);
  const next = ids[((Math.max(0, ids.indexOf(current)) + (direction < 0 ? -1 : 1)) % ids.length + ids.length) % ids.length];
  if (!(next > 0) || next === current) return;
  const focus = (id) => {
    View.setCastleOpenedBuildHero?.(id);
    View.scrollCastleBottomToHero?.(id);
  };
  focus(next);
  if (Window.windows?.main?.id !== 'wbuild') return View.show('build', next);
  const shown = Window.show('main', 'build', next, 0, true);
  if (wait) await shown;
  else shown.catch(() => {});
  if (cancelOnSplash && splashOpen()) {
    focus(current);
    const back = Window.show('main', 'build', current, 0, true);
    if (wait) await back;
    else back.catch(() => {});
    return;
  }
  View.scrollCastleBottomToHero?.(next);
}

export class HeroPanel {
  constructor(ed) {
    this.ed = ed;
    this.view = DOM({ style: 'build-hero' });
    this.rows = {};
  }

  build(data) {
    const ed = this.ed;
    const hero = data.hero;
    this.profile = Array.isArray(data.profile) ? data.profile : [0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.mainAttack = hero.param;
    this.attackModifier = hero.koef;
    for (const [key, index] of Object.entries(PROFILE_INDEX)) ed.engine.profile[key] = parseInt(this.profile[index], 10) || 0;

    const stats = DOM({ style: 'build-hero-stats-view' });
    for (const [key, label] of ROWS) stats.append(this.createRow(key, label));
    this.countValue = DOM({ tag: 'span', style: 'build-hero-stats-highlight-count-value' }, '0');
    this.countView = DOM({ style: 'build-hero-stats-highlight-count', data: { tooltip: Lang.text('buildStatsHighlightedTalentsCountTitle') } },
      DOM({ style: 'build-hero-stats-highlight-count-badge' }, this.countValue));

    this.name = DOM({ style: 'name' });
    const listed = MM.hero?.find?.((h) => Number(h.id) === Number(hero.id));
    if (listed) setHeroName(this.name, Lang.heroName(listed.id, listed.skin || 1));
    this.avatar = this.createAvatar(hero);
    const nav = (dir) => DOM({
      style: ['build-hero-nav-btn', dir < 0 ? 'build-hero-nav-btn-left' : 'build-hero-nav-btn-right'],
      domaudio: domAudioPresets.defaultButton,
      event: ['click', () => switchHero(ed.heroId, dir)],
    });
    const left = nav(-1);
    const right = nav(1);
    left.style.backgroundImage = 'url("content/img/goLeft.png")';
    right.style.backgroundImage = 'url("content/img/goRight.png")';
    this.view.append(
      DOM({ style: 'build-hero-avatar-and-name' }, DOM({ style: 'build-avatar-wrap' }, this.avatar), this.name),
      DOM({ style: 'build-hero-rating' }, `${Lang.text('buildHeroRating')}: ${hero.rating}`),
      stats,
      DOM({ style: 'build-hero-nav-controls' }, left, right),
      DOM({ style: 'build-hero-avatar-actions' }, this.createSkinButton(), this.createTrainingButton()),
    );
    // переключатель земли — перед фильтрами редкости
    ed.library.rarityView.prepend(this.createLandToggle());
  }

  createRow(key, label) {
    const ed = this.ed;
    const value = DOM({ tag: 'div' }, '0');
    const item = DOM({ domaudio: domAudioPresets.defaultButton, style: 'build-hero-stats-item', data: { active: 0 } }, DOM({ tag: 'div' }, Lang.text(label)), value);
    this.rows[key] = value;
    if (PASSIVE.has(key)) item.classList.add('passive');
    else {
      // клик — фильтр библиотеки по стату строки
      item.addEventListener('click', () => {
        const on = item.dataset.active != 1;
        item.dataset.active = on ? 1 : 0;
        item.style.background = on ? '#5899' : 'rgba(0,0,0,0)';
        ed.library.toggleStatRow(key, on);
      });
    }
    if (key === 'talentCdPct') {
      item.classList.add('build-cooldown-stat');
      setTooltip(item, Lang.text('buildCooldownTooltip'));
      this.cooldownItem = item;
      const place = () => {
        const rect = item.getBoundingClientRect();
        item.style.setProperty('--build-stats-tip-left', `${Math.round(rect.left)}px`);
        item.style.setProperty('--build-stats-tip-top', `${Math.round(rect.bottom + 6)}px`);
      };
      item.addEventListener('mouseenter', place);
      item.addEventListener('focus', place);
    }
    const line = DOM({ style: 'build-hero-stats-line' });
    if (key in PROFILE_INDEX) line.append(this.createCheckbox(key));
    line.append(item);
    if (!PASSIVE.has(key)) {
      line.addEventListener('mouseenter', () => ed.highlight.enterStatRow(key));
      line.addEventListener('mouseleave', () => ed.highlight.leaveStatRow());
    }
    return line;
  }

  // Галочка приоритета стата: «к наибольшему стату», порядок установки сетов, подсказки игры
  createCheckbox(key) {
    const ed = this.ed;
    const index = PROFILE_INDEX[key];
    const box = DOM({ tag: 'img', domaudio: domAudioPresets.smallButton, style: 'build-hero-stats-daw', title: Lang.text('makeStatPriorityTitle') });
    const show = () => (box.src = ed.engine.profile[key] ? 'content/icons/checkbox.webp' : 'content/icons/circle.webp');
    show();
    box.addEventListener('click', async () => {
      const on = !ed.engine.profile[key];
      if (!ed.preview) await App.api.request('build', 'setProfile', { id: ed.buildId, index, value: on });
      if (!ed.alive) return;
      ed.engine.profile[key] = on ? 1 : 0;
      show();
      ed.renderStats();
      ed.afterChange();
    });
    return box;
  }

  // Родная / вражеская земля для статов «на родной/вражеской земле»
  createLandToggle() {
    const ed = this.ed;
    const button = DOM({ domaudio: domAudioPresets.defaultButton, style: ['build-hero-stats-setting-land-type', 'button-outline', 'build-hero-stats-setting-land-type-rz'] });
    const wrap = DOM({ style: 'build-hero-stats-settings' }, button);
    setTooltip(wrap, Lang.text('titleLandTipeRZ'));
    button.addEventListener('click', () => {
      const flags = ed.engine.flags;
      flags.rz = !flags.rz;
      flags.vz = !flags.vz;
      button.classList.toggle('build-hero-stats-setting-land-type-rz', flags.rz);
      button.classList.toggle('build-hero-stats-setting-land-type-vz', !flags.rz);
      setTooltip(wrap, Lang.text(flags.rz ? 'titleLandTipeRZ' : 'titleLandTipeVZ'));
      ed.renderStats();
      ed.afterChange();
    });
    const place = () => {
      const rect = wrap.getBoundingClientRect();
      wrap.style.setProperty('--build-land-tip-left', `${Math.round(rect.left + rect.width / 2)}px`);
      wrap.style.setProperty('--build-land-tip-top', `${Math.round(rect.top - 12)}px`);
    };
    wrap.addEventListener('mouseenter', place);
    wrap.addEventListener('focus', place);
    return wrap;
  }

  createAvatar(hero) {
    const ed = this.ed;
    const avatar = DOM({ style: 'avatar' });
    avatarBackground(avatar, hero.id, hero.skin?.target || 1);
    const rankIcon = DOM({ style: 'rank-icon' });
    Object.assign(rankIcon.style, {
      backgroundImage: `url("content/ranks/${Rank.icon(hero.rating)}.webp"), url("content/ranks/rateIconBack.png")`,
      backgroundSize: '70%, 100%', backgroundPosition: 'center, center', backgroundRepeat: 'no-repeat, no-repeat',
    });
    // рамка по победам на герое (wins/frameType из build.heroAll) — под плашкой ранга
    avatar.append(HeroFrame.createNode(HeroFrame.fromHeroList(MM.hero, hero.id)), DOM({ style: 'rank' }, rankIcon));

    // подсказка у аватара — в документе, рядом с ним
    document.querySelectorAll('.build-avatar-tip').forEach((el) => el.remove());
    const tip = DOM({ style: 'build-avatar-tip' }, DOM({ style: 'tip-title' }, Lang.text('tipTitle')), DOM({ style: 'tip-body' }, Lang.text('tipBody')));
    document.body.append(tip);
    this.tip = tip;
    const place = () => {
      const r = avatar.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      let left = r.right + 12;
      if (left + t.width > window.innerWidth - 10) left = r.left - 12 - t.width;
      tip.style.left = `${Math.round(Math.max(10, Math.min(left, window.innerWidth - t.width - 10)))}px`;
      tip.style.top = `${Math.round(Math.max(10, Math.min(r.top + r.height / 2 - t.height / 2, window.innerHeight - t.height - 10)))}px`;
    };
    avatar.addEventListener('mouseenter', () => {
      tip.classList.add('is-open');
      requestAnimationFrame(place);
    });
    avatar.addEventListener('mouseleave', () => tip.classList.remove('is-open'));
    const reposition = () => tip.classList.contains('is-open') && place();
    ed.listen(window, 'scroll', reposition);
    ed.listen(window, 'resize', reposition, false);
    avatar.addEventListener('click', () => {
      Window.show('main', 'top', hero.id, 0);
      tip.classList.remove('is-open');
    });
    // админ: ПКМ — данные героя в БД
    if (App.isAdmin()) avatar.addEventListener('contextmenu', () => this.editHero(hero.id));
    return avatar;
  }

  async editHero(heroId) {
    const body = document.createDocumentFragment();
    const data = await App.api.request('build', 'heroData', { id: heroId });
    for (const key in data) {
      body.append(App.input((value) => App.api.request('build', 'heroEdit', { id: heroId, object: { [key]: value } }), { value: data[key] }));
    }
    body.append(DOM({ domaudio: domAudioPresets.bigButton, style: 'splash-content-button', event: ['click', () => Splash.hide()] }, Lang.text('titleClose')));
    Splash.show(body);
  }

  createSkinButton() {
    const ed = this.ed;
    const button = DOM({ tag: 'button', domaudio: domAudioPresets.defaultButton, style: ['btn-skins', 'btn-hover', 'color-3'] }, Lang.text('buildHeroAppearances'));
    setTooltip(button, Lang.text('titleSkinsForTheHero'));
    button.addEventListener('click', () => {
      const list = DOM({ style: 'skin-change' });
      const preload = new PreloadImages(list);
      for (const skin of ed.data.hero.skin.list) {
        const item = DOM({ domaudio: domAudioPresets.smallButton, data: { url: skinUrl(ed.heroId, skin), skin, hero: ed.heroId, fallback: 'heroSkin' } });
        item.addEventListener('click', async () => {
          await ed.changeSkin(ed.heroId, skin);
          Splash.hide();
        });
        preload.add(item);
      }
      Splash.show(list, false);
    });
    return button;
  }

  createTrainingButton() {
    const ed = this.ed;
    const button = DOM({ tag: 'button', domaudio: domAudioPresets.defaultButton, style: ['btn-skins', 'btn-hover', 'color-3'] }, Lang.text('training'));
    setTooltip(button, Lang.text('titletraining'));
    button.addEventListener('click', async () => {
      try {
        if (MM.isBlockedByUpdate()) return;
        if (!NativeAPI.status) return App.error(Lang.text('windowsLauncherRequired'));
        await MM.gameStartCheck();
        await App.api.request(App.CURRENT_MM, 'heroParty', { id: MM.partyId, hero: ed.heroId });
        await App.api.request(App.CURRENT_MM, 'start', {
          version: App.PW_VERSION, mode: 99, mac: NativeAPI.getMACAdress(), cache: await NativeAPI.getCacheIndex(), v: 2,
        });
      } catch (error) {
        App.error(error);
      }
    });
    return button;
  }

  // числа панели — из расчёта статов
  update() {
    const engine = this.ed.engine;
    const rows = engine.display();
    for (const [key, text] of Object.entries(rows)) if (this.rows[key]) this.rows[key].innerText = text;
    const cd = Math.max(0, Math.round(engine.total('speedtal')));
    const raw = Math.max(0, Math.round(engine.total('speedtal', { uncapped: true })));
    // сверх лимита — в скобках фактическая сумма: «-30% (-42%)»
    this.rows.talentCdPct.innerText = `${cd === 0 ? '0%' : `-${cd}%`}${raw > cd ? ` (-${raw}%)` : ''}`;
    const max = String(TALENT_COOLDOWN_PCT_MAX);
    const limit = raw > cd ? Lang.text('statTalentCooldownPctTipOver').replace('{max}', max).replace('{raw}', String(raw)) : Lang.text('statTalentCooldownPctTipMax').replace('{max}', max);
    setTooltip(this.cooldownItem, `${limit}\n\n${Lang.text('buildCooldownTooltip')}`);
    const derived = engine.derived(this.mainAttack, this.attackModifier);
    this.rows.damage.innerHTML = `${derived.damage[0]}-${derived.damage[1]}${derived.physical ? '<fiz> </fiz>' : '<mag> </mag>'}`;
    for (const key of ['punching', 'protectionBody', 'protectionSpirit', 'critProb', 'attackSpeed']) this.rows[key].innerText = derived[key];
  }


  destroy() {
    this.tip?.remove();
  }
}

// A/D — соседний герой; зажатая клавиша листает героев (через 0,8 с, каждые 50 мс).
// Ставится один раз: удержание переживает смену окна билда. shown() — окно билда на экране.
const nav = { held: '', hold: 0, repeat: 0, busy: false, sync: 0, installed: false };

export function stopHeroNav(afterRepeat = false) {
  const repeated = !!nav.repeat;
  clearTimeout(nav.hold);
  clearInterval(nav.repeat);
  Object.assign(nav, { hold: 0, repeat: 0, held: '' });
  if (afterRepeat && repeated) settleHeroNav();
}

let shownEditor = () => null;

// после листания без ожидания окна могли прийти не по порядку — утвердить выбранного героя
async function settleHeroNav() {
  const token = ++nav.sync;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(120);
  for (let attempt = 0; attempt < 3 && token === nav.sync && Window.windows?.main?.id === 'wbuild'; attempt++) {
    const wanted = Number(View.castleOpenedBuildHeroId);
    if (!(wanted > 0)) return;
    await Window.show('main', 'build', wanted, 0, true)?.catch?.(() => {});
    if (token !== nav.sync) return;
    await sleep(shownEditor()?.heroId === wanted ? 140 : 120);
    if (shownEditor()?.heroId === wanted) return;
  }
}

export function installHeroNavKeys(shown) {
  shownEditor = shown;
  if (nav.installed) return;
  nav.installed = true;
  const codeOf = (e) => (['KeyA', 'KeyD'].includes(e.code) ? e.code : { a: 'KeyA', d: 'KeyD' }[String(e.key || '').toLowerCase()] || '');
  const usable = (e) => {
    if (!shownEditor() || shownEditor().preview) return false;
    if (Window.windows?.main?.id !== 'wbuild' || splashOpen() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const el = document.activeElement;
    return !(el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName));
  };
  const step = async (dir, wait = true) => {
    if (wait && nav.busy) return;
    if (splashOpen() || Window.windows?.main?.id !== 'wbuild') return stopHeroNav();
    if (wait) nav.busy = true;
    try {
      await switchHero(shownEditor()?.heroId, dir, wait, true);
    } finally {
      if (wait) nav.busy = false;
    }
  };
  window.addEventListener('keydown', async (e) => {
    const code = codeOf(e);
    if (!code || e.repeat) return;
    if (!usable(e)) return stopHeroNav();
    e.preventDefault();
    if (nav.held === code) return;
    stopHeroNav();
    nav.held = code;
    const dir = code === 'KeyA' ? -1 : 1;
    await step(dir);
    if (splashOpen()) return stopHeroNav();
    nav.hold = setTimeout(() => {
      if (nav.held !== code) return;
      nav.repeat = setInterval(() => (nav.held === code && !splashOpen() ? step(dir, false) : stopHeroNav()), 50);
    }, 800);
  }, true);
  window.addEventListener('keyup', (e) => codeOf(e) && codeOf(e) === nav.held && stopHeroNav(true), true);
  window.addEventListener('blur', () => stopHeroNav(true), true);
}
