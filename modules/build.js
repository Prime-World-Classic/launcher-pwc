// Окно билда героя — фасад для остального лаунчера. Устройство окна — в modules/build/:
//   editor.js   — состояние окна и все правки (поле, панель активных, сеты, боевой режим);
//   stats.js    — расчёт статов героя; talents.js, sets.js — данные талантов и сетов;
//   sync.js     — отправка правок на сервер; store.js — кэш build.data/peek/inventory;
//   library.js, heroPanel.js, actions.js, settings.js, highlight.js, tooltip.js, input.js — интерфейс.

import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { App } from './app.js';
import { View } from './view.js';
import { Window } from './window.js';
import { MM } from './mm.js';
import { Game } from './game.js';
import { HelpSplash } from './helpSpalsh.js';
import { domAudioPresets } from './domAudioPresets.js';
import { BuildEditor } from './build/editor.js';
import { BuildSettings } from './build/settings.js';
import { avatarBackground, castleHeroIds, setHeroName, stopHeroNav, switchHero } from './build/heroPanel.js';

export class Build {
  static get shown() {
    return BuildEditor.shown;
  }

  static get heroId() {
    return BuildEditor.shown?.heroId;
  }

  // ответ build.data показанного билда (вкладка «Герой»: облики, рейтинг)
  static get dataRequest() {
    return BuildEditor.shown?.data;
  }

  static get listView() {
    return BuildEditor.shown?.actions.listView;
  }

  static get heroView() {
    return BuildEditor.shown?.heroPanel.view;
  }

  static get descriptionView() {
    return BuildEditor.shown?.descriptionView;
  }

  static get onHeroSkinChanged() {
    return BuildEditor.onHeroSkinChanged;
  }

  static set onHeroSkinChanged(callback) {
    BuildEditor.onHeroSkinChanged = callback;
  }

  // Окно билда героя: разметка или null, если открытие устарело (уже открывают другое)
  static async render(heroId, targetId = 0, isWindow = false, { previewData = null } = {}) {
    const ed = new BuildEditor({ heroId, targetId, isWindow, preview: previewData });
    let opened = false;
    try {
      opened = await ed.open();
    } finally {
      if (!opened) ed.destroy();
    }
    if (!opened) return null;
    ed.show();
    ed.input.attach();
    return Build.compose(ed, isWindow);
  }

  static compose(ed, isWindow) {
    const library = ed.library;
    const tooltip = (title, body, extra = []) =>
      DOM({ style: ['build-library-tooltip', ...extra], role: 'tooltip' }, DOM({ style: 'account-rating-tooltip-title' }, title), DOM({ style: 'account-rating-tooltip-body' }, body));
    const libraryTitle = DOM({ style: 'build-library-title' }, DOM({ tag: 'span' }, Lang.text('library')), tooltip(Lang.text('buildLibraryTooltipTitle'), Lang.text('buildLibraryTooltipBody')));
    library.setsSection.querySelector('.build-inventory-legend').append(tooltip(Lang.text('sets'), Lang.text('buildSetsTooltipBody'), ['build-sets-tooltip']));
    ed.actions.view.prepend(ed.heroPanel.countView);
    const help = DOM({
      id: 'wbuild_help', domaudio: domAudioPresets.defaultButton, style: 'help-button', data: { tooltip: Lang.text('help') }, ariaLabel: Lang.text('help'),
      event: ['click', () => HelpSplash(Lang.text('build_help_content'))],
    });
    const body = DOM(
      { style: 'build-horizontal' },
      // настройки — слева от «?» сразу вместе с окном
      ed.settings.button,
      help,
      DOM({ style: 'build-left' }, ed.heroPanel.view),
      DOM(
        { style: 'build-center' },
        ed.actions.view,
        DOM({ style: 'build-field-with-tabs' }, ed.actions.listView, DOM({ style: 'build-field-container' }, ed.levelView, ed.fieldView)),
        DOM(
          { style: 'build-active-bar-container' },
          ed.activeBarKeybindingsView,
          ed.activeBarView,
          DOM({ style: 'build-smartcast-tooltip', role: 'tooltip' }),
          DOM({ style: 'build-active-bar-hint' }, Lang.text('smartcastDescription')),
        ),
      ),
      DOM({ style: 'build-right' }, libraryTitle, library.rarityView, library.searchView, library.view, library.altHint),
    );
    if (!isWindow) {
      body.append(DOM(
        { domaudio: domAudioPresets.closeButton, style: ['build-list-close', 'close-button'], title: Lang.text('titleClose'), event: ['click', () => View.show('builds')] },
        DOM({ tag: 'img', src: 'content/icons/close-cropped.svg', alt: Lang.text('titleClose'), style: 'close-image-style' }),
      ));
    }
    return body;
  }

  // Окно закрыли
  static cleanup() {
    stopHeroNav();
    BuildEditor.shown?.destroy();
    BuildSettings.button?.remove();
  }

  static CleanInvalidDescriptions() {
    for (const view of document.querySelectorAll('.build-description')) if (view !== BuildEditor.shown?.descriptionView) view.remove();
  }

  static toggleBuildSettingsPanel(force) {
    BuildEditor.shown?.settings.toggle(force);
  }

  static changeSkinForHero(heroId, skinId) {
    return BuildEditor.changeSkin(heroId, skinId);
  }

  static applyBuildHeroAvatarSkin(heroId, skinId) {
    const avatar = BuildEditor.shown?.heroPanel.avatar;
    if (avatar) avatarBackground(avatar, heroId, skinId);
  }

  static setHeroName(element, text) {
    setHeroName(element, text);
  }

  static getHeroIdsFromCastleBottomList() {
    return castleHeroIds();
  }

  static switchHeroFromCastleBottomList(direction = 1, wait = true, cancelOnSplash = false) {
    return switchHero(BuildEditor.shown?.heroId, direction, wait, cancelOnSplash);
  }

  // Билд другого игрока (окно игрока, лобби)
  static async view(user, hero, nickname = '', animate = true, { lobby = false } = {}) {
    const preview = lobby && MM.preview;
    const request = preview ? Array.from({ length: 36 }, (_, index) => index + 1) : await App.api.request('build', 'get', { user, hero });
    if (lobby) {
      if (!MM.isInTambur) return;
      return Window.show('allyBuild', 'allyBuild', { request, user, hero, nickname, preview });
    }
    return Window.show('playerBuild', 'playerBuild', { request, user, hero, nickname, preview: false });
  }

  // Маленькая картинка билда (36 id: > 0 — талант, < 0 — классовый). animate — таланты
  // «падают» на место: сначала классовые, потом обычные; callback — когда все упали.
  static viewModel(data, callback, animate = true) {
    const body = DOM({ style: 'build-body' });
    const classTalents = [];
    const talents = [];
    let row = null;
    data.forEach((id, index) => {
      if (index % 6 === 0) body.append((row = DOM({ style: 'build-body-row' })));
      const talent = DOM();
      if (id != 0) {
        talent.style.backgroundImage = id > 0 ? `url(content/talents/${id}.webp)` : `url(content/htalents/${Math.abs(id)}.webp)`;
        if (animate) {
          Object.assign(talent.style, { opacity: 0, zIndex: 9999 });
          (id > 0 ? talents : classTalents).push(talent);
        }
      }
      row.append(talent);
    });
    if (!animate) return body;
    const drop = (elements, step, done) => {
      if (!elements.length) return done();
      let delay = 0;
      Game.shuffle(elements).forEach((element, i, list) => {
        delay += step;
        const animation = element.animate({ opacity: [0, 1], transform: ['scale(3)', 'scale(1)'] }, { delay, duration: 350, fill: 'both', easing: 'ease-out' });
        if (i === list.length - 1) animation.onfinish = done;
      });
    };
    drop(classTalents, 150, () => setTimeout(() => drop(talents, 50, () => callback?.()), 100));
    return body;
  }
}
