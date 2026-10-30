// Вкладки билдов героя (ЛКМ — открыть, ПКМ — переименовать) и кнопки над полем: боевой режим,
// новый билд, копия, случайный, сброс, раскладка сетов по колонкам (ПКМ — зеркало).

import { App } from '../app.js';
import { DOM } from '../dom.js';
import { Lang } from '../lang.js';
import { Splash } from '../splash.js';
import { domAudioPresets } from '../domAudioPresets.js';
import { setTooltip } from './heroPanel.js';

const MAX_BUILDS = 6;

function closeButton() {
  const close = DOM({ tag: 'div', domaudio: domAudioPresets.closeButton, style: 'close-button', event: ['click', () => Splash.hide()] });
  close.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
  return close;
}

const modalTitle = () => DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('assembly')));

export class BuildActions {
  constructor(ed) {
    this.ed = ed;
    this.listView = DOM({ style: 'build-list' });
    this.view = DOM({ style: 'build-actions-view' });
  }

  build(builds) {
    this.builds = builds;
    this.buildTabs(builds);
    this.buildButtons(builds);
  }

  // --- Вкладки ------------------------------------------------------------------------------

  buildTabs(builds) {
    const ed = this.ed;
    const tabs = [];
    for (const build of builds) {
      const tab = DOM(
        {
          tag: 'button',
          domaudio: domAudioPresets.defaultButton,
          style: ['build-tab-item', 'btn-hover', build.target ? 'list-highlight' : 'list-not-highlight'],
          // последняя вкладка побеждает: устаревшее открытие окно не подменит
          event: ['click', () => ed.reopen(build.id)],
        },
        DOM({ style: 'build-tab-label' }, DOM({ tag: 'span' }, `${build.name}`)),
      );
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.nameModal('rename', Lang.text('renameBuild'), { id: build.id });
      });
      tabs.push(tab);
      this.listView.append(DOM({ tag: 'div', style: 'button-build--wrapper' }, tab));
    }
    // длинное название бежит строкой
    const measure = (tab) => {
      const label = tab.querySelector('.build-tab-label');
      const text = label?.firstElementChild;
      if (!text || !label.clientWidth) return;
      const overflow = Math.max(0, text.scrollWidth - label.clientWidth);
      tab.style.setProperty('--tab-scroll-distance', `${overflow}px`);
      tab.classList.toggle('build-tab--overflowing', overflow > 1);
      tab.title = text.textContent;
    };
    const observer = new ResizeObserver((entries) => entries.forEach((entry) => measure(entry.target)));
    tabs.forEach((tab) => observer.observe(tab));
    ed.cleanups.push(() => observer.disconnect());
    requestAnimationFrame(() => tabs.forEach(measure));
    this.listView.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.listView.scrollLeft += e.deltaY;
    });
  }

  // --- Кнопки -------------------------------------------------------------------------------

  button(className, tooltip, onClick, background = null, extra = []) {
    const button = DOM({ tag: 'button', domaudio: domAudioPresets.defaultButton, style: ['build-action-item', 'btn-hover', 'color-1', ...extra], event: ['click', onClick] });
    setTooltip(button, tooltip);
    const inner = DOM({ style: className });
    if (background) inner.style.backgroundImage = `url('content/img/${background}')`;
    button.append(inner);
    this.view.append(button);
    return { button, inner };
  }

  buildButtons(builds) {
    const ed = this.ed;
    const canCreate = builds.length < MAX_BUILDS;

    // боевой режим: прокачка билда по шагам; в кружке — уровень героя
    const combat = this.button(['btn-combat-mode', 'build-action-item-background'], '', () => ed.setCombat(!ed.combat), null, ['build-action-item-combat-mode']);
    this.combatCount = DOM({ tag: 'span', style: 'btn-combat-mode-count' });
    combat.inner.append(this.combatCount, DOM({ tag: 'span', style: 'btn-combat-mode-glass' }));
    this.combatButton = combat.button;

    if (canCreate) {
      this.button(['btn-create', 'build-action-item-background'], Lang.text('titleCreateANewBuildTab'), () =>
        this.nameModal('create', Lang.text('createBuild'), { heroId: ed.heroId }), 'create.png');
    }
    this.button('btn-duplicate', Lang.text('titleDuplicateTheCurrentBuild'), () => this.duplicateModal(), 'copy.png');
    this.button(['btn-random', 'build-action-item-background'], Lang.text('titleGenerateARandomBuild'), async () => {
      await App.api.request('build', 'random', { id: ed.buildId });
      ed.reopen(0);
    }, 'random.png');
    this.button(['btn-trash', 'build-action-item-background'], Lang.text('titleResetTalentsInThisBuild'), () => this.resetModal(), 'remove.png');

    // ЛКМ — таланты сетов по колонкам, ПКМ — зеркало
    const sort = this.button(['btn-combat-mode', 'build-action-item-background'], '', () => ed.sortSets(), null, ['build-action-item-multiline-tooltip']);
    sort.inner.append(DOM({ tag: 'span', style: 'btn-sort-sets-icon' }), DOM({ tag: 'span', style: 'btn-combat-mode-glass' }));
    sort.button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ed.mirror();
    });
    this.sortButton = sort.button;
    this.sync();
  }

  // состояние кнопок боевого режима и сортировки
  sync() {
    const ed = this.ed;
    if (!this.combatButton) return;
    const can = ed.canCombat();
    this.combatButton.classList.toggle('build-action-item-active', !!ed.combat);
    this.combatButton.classList.toggle('build-action-item-disabled', !can);
    setTooltip(this.combatButton, can ? Lang.text('combatModeName') : `${Lang.text('combatModeName')}\n${Lang.text('combatModeBuildNotComplete')}`);
    this.combatCount.classList.toggle('btn-combat-mode-count-raw', !ed.combat);
    this.combatCount.textContent = ed.combat ? String(ed.combat.level) : '';
    this.sortButton.classList.toggle('build-action-item-disabled', !!ed.combat);
    this.sortButton.disabled = !!ed.combat;
    setTooltip(this.sortButton, ed.combat ? Lang.text('sortSetsIntoColumnDisabledCombat') : `${Lang.text('titleSortSetsIntoColumn')}\n${Lang.text('sortSetsRmbMirrorBuild')}`);
  }

  // --- Окна ---------------------------------------------------------------------------------

  // Название билда: новый (create) или переименование (rename)
  nameModal(method, buttonText, data, after = null) {
    const name = DOM({ id: 'build-create-input', domaudio: domAudioPresets.defaultInput, tag: 'input', placeholder: Lang.text('buildNamePlaceholder') });
    const rename = method === 'rename';
    const button = DOM(
      {
        style: ['splash-content-button-modal', ...(rename ? ['splash-nickname-sized-button', 'build-rename-button'] : [])],
        domaudio: domAudioPresets.bigButton,
        event: ['click', async () => {
          if (!name.value) return Splash.hide();
          const result = await App.api.request('build', method, { ...data, name: name.value });
          if (after) await after(result);
          Splash.hide();
          this.ed.reopen(0);
        }],
      },
      buttonText,
    );
    const template = document.createDocumentFragment();
    template.append(DOM({ style: 'splash-modal-scope-build-action' }), modalTitle(), name, button, closeButton());
    Splash.show(template);
  }

  // Копия билда: поверх другого билда героя или в новый
  duplicateModal() {
    const ed = this.ed;
    const current = ed.buildId;
    const full = this.builds.length >= MAX_BUILDS;
    const fragment = document.createDocumentFragment();
    fragment.append(
      DOM({ style: 'splash-modal-scope-build-action' }),
      DOM({ style: 'splash-text', id: 'duplicateBuildModal' }, Lang.text(full ? 'buildLimitReached' : 'selectBuildToReplace').replace(/:\s*$/, '')),
    );
    for (const build of this.builds.filter((b) => b.id !== current)) {
      fragment.append(DOM({
        tag: 'button', domaudio: domAudioPresets.defaultButton, style: ['build-replace-btn', 'btn-hover'],
        event: ['click', async () => {
          await App.api.request('build', 'duplicate', { id: current, target: build.id });
          Splash.hide();
          ed.reopen(0);
        }],
      }, build.name));
    }
    if (!full) {
      fragment.append(DOM({
        tag: 'button', domaudio: domAudioPresets.defaultButton, style: ['build-replace-btn', 'btn-hover', 'color-1'],
        event: ['click', () => {
          Splash.hide();
          this.nameModal('create', Lang.text('createAndDuplicate'), { heroId: ed.heroId }, (created) =>
            App.api.request('build', 'duplicate', { id: current, target: created }));
        }],
      }, Lang.text('duplicateToNewBuild')));
    }
    fragment.append(modalTitle(), closeButton());
    Splash.show(fragment);
  }

  resetModal() {
    const ed = this.ed;
    const fragment = document.createDocumentFragment();
    fragment.append(
      DOM({ style: 'splash-modal-scope-build-action' }),
      DOM({ style: 'splash-text', id: 'resetBuildText' }, Lang.text('resetTalentsTitle')),
      modalTitle(),
      DOM({
        tag: 'button', domaudio: domAudioPresets.bigButton, style: ['build-replace-btn', 'build-replace-btn--red', 'build-replace-btn--compact', 'btn-hover'],
        event: ['click', async () => {
          await App.api.request('build', 'clear', { id: ed.buildId });
          Splash.hide();
          ed.reopen(0);
        }],
      }, Lang.text('reset')),
      closeButton(),
    );
    Splash.show(fragment);
  }
}
