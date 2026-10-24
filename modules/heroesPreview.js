// Вкладка «Герой» окна билда: страница content/heroes-preview.html во фрейме.
// Во встроенном режиме все живые данные (язык, облики игрока, выбранный облик, рейтинг,
// смена облика на сервере, переход на Ярмарку) берутся из window.parent.pwHeroesHost,
// который ставит View.attachBuildHeroesTab. Без хоста страница — только просмотр каталога.

const bars = [
  ['attak', 'heroesBarAttack', '#c44732'],
  ['defence', 'heroesBarDefence', '#2c9350'],
  ['talents', 'heroesBarTalents', '#1285b1'],
  ['complexity', 'heroesBarComplexity', '#d3b73e'],
];
const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const embedded = params.get('embedded') === '1';
const lockedHero = embedded && params.get('lockHero') === '1';
document.body.classList.toggle('heroes-embedded', embedded);

let host = null;
try {
  host = embedded ? window.parent.pwHeroesHost || null : null;
} catch {
  host = null;
}

let words = {};
const t = (key) => (host ? host.text(key) : words[key] ?? key);
const english = () => (host ? host.lang : params.get('lang')) === 'en';

let heroes = [];
// герой задаётся адресом, а во встроенном режиме ещё и хостом (смена героя без перезагрузки страницы)
let requestedHero = Number(params.get('hero') || 1);
let heroIndex = 0;
let skinIndex = 0;
let artworkRequest = 0;
let artworkAnimation = null;
let selecting = false;
const artworkCache = new Map();
// без хоста выбор облика только локальный (просмотр каталога)
const localSelection = new Map();

const ownedSkins = (hero) => (host ? host.ownedSkins(hero.id) : hero.skins.map((skin) => skin.index));
const selectedSkin = (hero) => (host ? host.selectedSkin(hero.id) : localSelection.get(hero.id) ?? 1);
const skinName = (hero, skin) => {
  if (host) return host.heroName(hero.id, skin.index);
  // те же ключи, что у Lang.heroName
  return (skin.index > 1 && words[`hero_${hero.id}_skin_${skin.index}_name`]) || words[`hero_${hero.id}_name`] || skin.name;
};

function showError(text) {
  byId('heroes-error').hidden = !text;
  byId('heroes-error').textContent = text || '';
}

function loadArtwork(source, priority = 'high') {
  if (artworkCache.has(source)) return artworkCache.get(source);
  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = priority;
  image.src = source;
  const ready = image
    .decode()
    .then(() => image)
    .catch((error) => {
      artworkCache.delete(source);
      throw error;
    });
  artworkCache.set(source, ready);
  if (artworkCache.size > 8) artworkCache.delete(artworkCache.keys().next().value);
  return ready;
}

async function renderArtwork(hero, skin, direction = 0) {
  const request = ++artworkRequest;
  const figure = byId('hero-figure');
  const artwork = figure.closest('.hero-artwork');
  artworkAnimation?.cancel();
  artworkAnimation = null;
  artwork.setAttribute('aria-busy', 'true');
  try {
    const image = await loadArtwork(skin.figure);
    if (request !== artworkRequest) return;
    artwork.style.setProperty('--art-aspect', image.naturalWidth / image.naturalHeight);
    figure.src = image.src;
    figure.alt = skinName(hero, skin);
    if (direction && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      artworkAnimation = figure.animate(
        [
          { transform: `translateX(${Math.sign(direction) * 14}%)`, opacity: 0.45 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: 280, easing: 'ease-out' },
      );
    }
    for (const delta of [-1, 1]) {
      const neighbor = hero.skins[(skinIndex + delta + hero.skins.length) % hero.skins.length];
      if (neighbor !== skin) loadArtwork(neighbor.figure, 'low').catch(() => {});
    }
  } catch {
    if (request === artworkRequest) showError(t('heroesArtError'));
  } finally {
    if (request === artworkRequest) artwork.setAttribute('aria-busy', 'false');
  }
}

function renderSelectButton(hero, skin) {
  const button = byId('skin-select');
  const owned = ownedSkins(hero).includes(skin.index);
  const selected = owned && selectedSkin(hero) === skin.index;
  // чужой облик можно только купить на Ярмарке; без хоста покупки нет
  const buy = !owned && !!host;
  button.disabled = selecting || selected || (!owned && !host);
  button.textContent = buy ? t('heroesSkinBuy') : selected ? t('heroesSkinSelected') : t('heroesSkinSelect');
  button.classList.toggle('hero-select-button--buy', buy);
}

function render(direction = 0) {
  const hero = heroes[heroIndex];
  const skin = hero.skins[skinIndex];
  const name = skinName(hero, skin);
  const role = t(`heroesRole_${hero.role}`);
  byId('hero-name').textContent = name;
  byId('hero-name').title = name;
  byId('hero-portrait').src = skin.portrait;
  byId('hero-portrait').alt = name;
  byId('hero-role').textContent = role;
  byId('hero-role-tooltip-title').textContent = role;
  byId('hero-role-tooltip-body').textContent = t(`heroesRoleInfo_${hero.role}`);
  for (const icon of document.querySelectorAll('.hero-class-icon')) {
    icon.src = `content/img/heroes-ui/${hero.role.toLowerCase()}.png`;
    icon.alt = role;
  }
  const description = english() ? hero.descriptionEn : hero.description;
  byId('hero-description').replaceChildren(
    ...description
      .split(/\r?\n+/)
      .filter((text) => text.trim())
      .map((text) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        return paragraph;
      }),
  );
  const caption = document.createElement('span');
  caption.textContent = name;
  byId('skin-name').replaceChildren(caption);
  byId('skin-name').title = name;
  showError('');
  renderArtwork(hero, skin, direction);
  byId('skin-count').textContent = `${skinIndex + 1} / ${hero.skins.length}`;
  renderSelectButton(hero, skin);
  byId('skin-prev').disabled = byId('skin-next').disabled = hero.skins.length < 2;
  const rating = host?.rating(hero.id);
  byId('hero-rank').src = host ? host.rankIcon(rating) : 'content/ranks/1.webp';
  byId('hero-record').src = byId('hero-rank').src;
  byId('hero-rank').closest('.hero-badge').title = rating ? `${t('heroesRating')}: ${rating}` : '';
  byId('hero-bars').replaceChildren(
    ...bars.map(([key, label, color]) => {
      const row = document.createElement('div');
      row.className = 'hero-bar';
      const title = document.createElement('span');
      title.textContent = t(label);
      const cells = document.createElement('div');
      cells.className = 'hero-bar-cells';
      const count = Math.min(10, Math.max(0, Number(hero.bars[key]?.count) || 0));
      cells.setAttribute('aria-label', `${t(label)}: ${count} / 10`);
      cells.style.setProperty('--bar-color', color);
      for (let i = 0; i < 10; i++) {
        const cell = document.createElement('span');
        cell.className = `hero-bar-cell${i < count ? ' filled' : ''}`;
        cells.append(cell);
      }
      row.append(title, cells);
      return row;
    }),
  );
  document
    .querySelectorAll('.hero-choice')
    .forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.hero) === hero.id)));
  document.dispatchEvent(new CustomEvent('heroes-preview-change'));
}

function chooseHero(index) {
  if (lockedHero) return;
  const direction = index - heroIndex;
  heroIndex = (index + heroes.length) % heroes.length;
  skinIndex = Math.max(0, heroes[heroIndex].skins.findIndex((skin) => skin.index === selectedSkin(heroes[heroIndex])));
  render(direction);
}

async function onSelectClick() {
  const hero = heroes[heroIndex];
  const skin = hero.skins[skinIndex];
  if (!ownedSkins(hero).includes(skin.index)) {
    host?.openFair(hero.id, skin.index);
    return;
  }
  if (!host) {
    localSelection.set(hero.id, skin.index);
    render();
    return;
  }
  selecting = true;
  renderSelectButton(hero, skin);
  try {
    await host.selectSkin(hero.id, skin.index);
  } catch (error) {
    showError(typeof error === 'string' ? error : error?.message || t('heroesSkinError'));
  } finally {
    selecting = false;
    if (heroes[heroIndex] === hero) renderSelectButton(hero, hero.skins[skinIndex]);
  }
}

function applyStaticTexts() {
  document.documentElement.lang = english() ? 'en' : 'ru';
  document.title = t('titleheroes');
  for (const element of document.querySelectorAll('[data-text]')) element.textContent = t(element.dataset.text);
  for (const element of document.querySelectorAll('[data-label]')) {
    element.title = t(element.dataset.label);
    element.setAttribute('aria-label', element.title);
  }
  byId('hero-search').placeholder = t('castleHeroFilterPlaceholder');
}

async function init() {
  if (!host) {
    const lang = english() ? 'en' : 'ru';
    words = (await import(`/content/lang/${lang}.js`))[lang].word;
  }
  applyStaticTexts();
  const response = await fetch('content/heroes-preview.json?v=20261024-taurus-bars-1');
  if (!response.ok) throw new Error(t('heroesLoadError'));
  heroes = await response.json();
  if (!heroes.length || heroes.some((hero) => !hero.skins.length)) throw new Error(t('heroesLoadError'));
  heroIndex = Math.max(0, heroes.findIndex((hero) => hero.id === requestedHero));
  const startSkin = (requestedHero === Number(params.get('hero')) && Number(params.get('skin'))) || selectedSkin(heroes[heroIndex]);
  skinIndex = Math.max(0, heroes[heroIndex].skins.findIndex((skin) => skin.index === startSkin));
  byId('hero-roster').replaceChildren(
    ...heroes.map((hero, index) => {
      const button = document.createElement('button');
      button.className = 'hero-choice';
      button.dataset.hero = hero.id;
      button.title = skinName(hero, hero.skins[0]);
      button.setAttribute('aria-label', button.title);
      const image = document.createElement('img');
      image.src = hero.skins[0].portrait;
      image.alt = '';
      button.append(image);
      button.addEventListener('click', () => chooseHero(index));
      return button;
    }),
  );
  for (const [id, delta] of [
    ['hero-prev', -1],
    ['hero-next', 1],
  ]) {
    byId(id).disabled = lockedHero;
    byId(id).addEventListener('click', () => chooseHero(heroIndex + delta));
  }
  byId('skin-select').addEventListener('click', onSelectClick);
  for (const [id, delta] of [
    ['skin-prev', -1],
    ['skin-next', 1],
  ])
    byId(id).addEventListener('click', () => {
      skinIndex = (skinIndex + delta + heroes[heroIndex].skins.length) % heroes[heroIndex].skins.length;
      render(delta);
    });
  byId('hero-search').addEventListener('input', (event) => {
    const query = event.target.value.toLocaleLowerCase();
    for (const button of document.querySelectorAll('.hero-choice')) {
      button.hidden = !button.title.toLocaleLowerCase().includes(query);
    }
  });
  // хост сообщает, что облик сменился снаружи (Ярмарка, старое окно выбора облика)
  document.addEventListener('heroes-host-change', () => renderSelectButton(heroes[heroIndex], heroes[heroIndex].skins[skinIndex]));
  render();
}

// окно билда сменило героя и забрало эту страницу себе (View.attachBuildHeroesTab)
document.addEventListener('heroes-host-hero', (event) => {
  try {
    host = window.parent.pwHeroesHost || host;
  } catch {}
  requestedHero = Number(event.detail?.hero) || requestedHero;
  const index = heroes.findIndex((hero) => hero.id === requestedHero);
  if (index < 0) return;
  heroIndex = index;
  skinIndex = Math.max(0, heroes[index].skins.findIndex((skin) => skin.index === selectedSkin(heroes[index])));
  render();
});

init()
  .catch((error) => {
    showError(error.message);
    for (const button of document.querySelectorAll('button')) button.disabled = true;
  })
  // страница скрыта стилем до первой отрисовки (heroes-preview.css)
  .finally(() => document.body.classList.add('heroes-ready'));
