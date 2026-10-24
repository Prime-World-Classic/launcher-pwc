// Настройки окна билда (Settings.settings) и их панель у кнопки-шестерёнки перед «?».

import { DOM } from '../dom.js';
import { Lang } from '../lang.js';
import { Settings } from '../settings.js';
import { domAudioPresets } from '../domAudioPresets.js';

const HUE_DEFAULT = 199;
const BORDER_DEFAULT = 0.42;
const BORDER_MIN = 0.08;
const BORDER_MAX = 1.5;

const onOff = [
  { value: false, label: 'buildSettingsOff' },
  { value: true, label: 'buildSettingsOn' },
];

// Переключатели панели: ключ настройки, подпись, варианты (значение — подпись)
const OPTIONS = [
  { key: 'buildSetLmbMode', label: 'buildSettingsLmbMode', default: 1, values: [1, 2, 3].map((value) => ({ value, label: `buildSettingsLmbMode${value}` })) },
  { key: 'buildRowHoverHighlight', label: 'buildSettingsRowHighlight', default: true, values: onOff },
  { key: 'buildTalentViewLayout', label: 'buildSettingsLayout', default: 0, values: [{ value: 0, label: 'buildSettingsLayoutColumn' }, { value: 1, label: 'buildSettingsLayoutRow' }] },
  { key: 'buildSetSortMode', label: 'buildSettingsSetSortMode', default: 0, values: [{ value: 0, label: 'buildSettingsSetSortModeDefault' }, { value: 1, label: 'buildSettingsSetSortModePopular' }] },
  { key: 'buildSetOnlyMatchingStats', label: 'buildSettingsSetMatchOnly', default: false, values: onOff },
  {
    key: 'buildStatFilterHighlightMode',
    label: 'buildSettingsStatFilterHighlight',
    default: 1,
    values: [
      { value: 0, label: 'buildSettingsStatFilterHighlightModeOff' },
      { value: 1, label: 'buildSettingsStatFilterHighlightModeHasStat' },
      { value: 2, label: 'buildSettingsStatFilterHighlightModeAffectsTotal' },
    ],
  },
  { key: 'buildSetHoverOnTalent', label: 'buildSettingsSetHoverOnTalent', default: true, values: onOff },
];

// кнопка одна на все окна билда: при смене героя или билда остаётся на месте, без мигания
let settingsButton = null;

export class BuildSettings {
  constructor(ed) {
    this.ed = ed;
    this.normalize();
    this.applyHighlightVariables();
    settingsButton ??= DOM({ tag: 'button', type: 'button', style: 'build-list-settings', domaudio: domAudioPresets.defaultButton });
    settingsButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    };
    settingsButton.dataset.tooltip = Lang.text('buildSettingsTitle');
    settingsButton.setAttribute('aria-label', Lang.text('buildSettingsTitle'));
    settingsButton.setAttribute('aria-expanded', 'false');
    this.button = settingsButton;
    this.panel = null;
  }

  static get button() {
    return settingsButton;
  }

  get(key) {
    return Settings.settings?.[key] ?? OPTIONS.find((option) => option.key === key)?.default;
  }

  // значения вне вариантов — по умолчанию
  normalize() {
    const s = Settings.settings;
    if (!s) return;
    for (const option of OPTIONS) {
      if (!option.values.some((item) => item.value === s[option.key])) {
        const n = Number(s[option.key]);
        s[option.key] = option.values.some((item) => item.value === n) ? n : option.default;
      }
    }
    s.buildHighlightHue = ((Number.isFinite(Number(s.buildHighlightHue)) ? Number(s.buildHighlightHue) : HUE_DEFAULT) % 360 + 360) % 360;
    const border = Number(s.buildHighlightBorderMm);
    s.buildHighlightBorderMm = Math.min(BORDER_MAX, Math.max(BORDER_MIN, Number.isFinite(border) ? border : BORDER_DEFAULT));
  }

  save() {
    try {
      Settings.WriteSettings()?.catch?.(() => {});
    } catch {}
  }

  set(key, value) {
    if (!Settings.settings) return;
    Settings.settings[key] = value;
    this.save();
    if (key === 'buildRowHoverHighlight' && !value) this.ed.highlight.clearRow();
    if (key === 'buildTalentViewLayout') this.ed.library.applyLayout();
    if (key === 'buildSetSortMode') this.ed.library.renderSets();
  }

  // цвет и толщина рамки подсветки — CSS-переменные документа
  applyHighlightVariables() {
    const root = document.documentElement.style;
    root.setProperty('--build-hl-h', String(this.get('buildHighlightHue') ?? HUE_DEFAULT));
    root.setProperty('--build-hl-border-mm', `${this.get('buildHighlightBorderMm') ?? BORDER_DEFAULT}mm`);
  }

  toggle(force) {
    const panel = this.panel ?? this.createPanel();
    // панель стоит справа от окна билда — в самом окне (#wbuild)
    const host = this.button.closest('#wbuild') || this.button.parentElement;
    if (host && panel.parentNode !== host) host.append(panel);
    const open = typeof force === 'boolean' ? force : panel.style.display === 'none';
    panel.style.display = open ? 'flex' : 'none';
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.syncSliders?.();
  }

  close() {
    if (this.panel) this.toggle(false);
  }

  createPanel() {
    const panel = DOM({ style: 'build-settings-panel' }, DOM({ style: 'build-settings-title' }, Lang.text('buildSettingsTitle')));
    panel.style.display = 'none';
    for (const option of OPTIONS) {
      const segments = DOM({ style: ['build-settings-mode-dots', 'build-settings-segments'] });
      const sync = () => {
        segments.childNodes.forEach((button, i) => button.classList.toggle('build-settings-mode-dot-active', option.values[i].value === this.get(option.key)));
      };
      for (const item of option.values) {
        segments.append(
          DOM({ tag: 'button', type: 'button', style: 'build-settings-mode-dot', event: ['click', () => (this.set(option.key, item.value), sync())] }, Lang.text(item.label)),
        );
      }
      sync();
      panel.append(DOM({ style: 'build-settings-row' }, DOM({ style: 'build-settings-row-label' }, Lang.text(option.label)), segments));
    }
    panel.append(this.createHighlightSliders());
    this.panel = panel;
    return panel;
  }

  // Цвет (оттенок) и толщина рамки подсветки. Пока ползунок зажат — подсвечены все таланты.
  createHighlightSliders() {
    const thumb = () => DOM({ style: 'build-settings-hl-thumb' });
    const hueThumb = thumb();
    const borderThumb = thumb();
    const hueTrack = DOM({ style: 'build-settings-hl-hue-track' }, hueThumb);
    const borderTrack = DOM({ style: 'build-settings-hl-mm-track' }, borderThumb);
    this.syncSliders = () => {
      hueThumb.style.left = `${(this.get('buildHighlightHue') / 360) * 100}%`;
      borderThumb.style.left = `${((this.get('buildHighlightBorderMm') - BORDER_MIN) / (BORDER_MAX - BORDER_MIN)) * 100}%`;
    };
    const slider = (track, apply) => {
      let dragging = false;
      const at = (x) => {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return;
        apply(Math.min(1, Math.max(0, (x - rect.left) / rect.width)));
        this.syncSliders();
        this.applyHighlightVariables();
      };
      const end = () => {
        if (!dragging) return;
        dragging = false;
        this.ed.highlight.demo(false);
        this.save();
      };
      track.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        track.setPointerCapture(e.pointerId);
        at(e.clientX);
        this.ed.highlight.demo(true);
      });
      track.addEventListener('pointermove', (e) => dragging && at(e.clientX));
      track.addEventListener('pointerup', end);
      track.addEventListener('pointercancel', end);
      track.addEventListener('lostpointercapture', end);
    };
    slider(hueTrack, (t) => (Settings.settings.buildHighlightHue = t * 360));
    slider(borderTrack, (t) => (Settings.settings.buildHighlightBorderMm = BORDER_MIN + t * (BORDER_MAX - BORDER_MIN)));
    const reset = DOM(
      {
        tag: 'button', type: 'button', style: 'build-settings-hl-reset', title: Lang.text('buildSettingsHighlightReset'), domaudio: domAudioPresets.defaultButton,
        event: ['click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          Object.assign(Settings.settings, { buildHighlightHue: HUE_DEFAULT, buildHighlightBorderMm: BORDER_DEFAULT });
          this.syncSliders();
          this.applyHighlightVariables();
          this.save();
        }],
      },
      '↺',
    );
    this.syncSliders();
    const label = (key) => DOM({ style: 'build-settings-hl-line-label' }, Lang.text(key));
    return DOM(
      { style: ['build-settings-hl-block', 'build-settings-row'] },
      DOM({ style: 'build-settings-hl-sliders' }, label('buildSettingsHighlightHue'), hueTrack, label('buildSettingsHighlightBorder'), borderTrack),
      reset,
    );
  }

  destroy() {
    this.panel?.remove();
    this.panel = null;
    this.button.setAttribute('aria-expanded', 'false');
  }
}
