import { DOM } from '../dom.js';
import { Lang } from '../lang.js';
import { domAudioPresets } from '../domAudioPresets.js';
import { Settings } from '../settings.js';
import { NativeAPI } from '../nativeApi.js';
import { Voice } from '../voice.js';
import { KeybindStore } from './keybindings.store.js';
import { loadKeybinds, saveKeybinds, loadKeybindsBrowser } from './keybindings.io.js';
import { normalizeKey, attachGameKeyCapture } from './keybindings.input.js';

const unsubscribers = [];

function formatKeys(keys) {
  return keys && keys.length ? keys.join(' + ') : '';
}

function createKeyInput({ command, value = null }) {
  const input = DOM({
    tag: 'input',
    style: 'castle-keybinding-input',
    readonly: true,
  });

  function refresh() {
    input.value = formatKeys(KeybindStore.displayKeys(command, value));
    const conflict = KeybindStore.isConflicted(command, value);
    input.classList.toggle('is-conflict', conflict);
    input.title = conflict ? Lang.text('keybindConflict') : '';
  }

  attachGameKeyCapture(input, {
    onKeys: (keys) => KeybindStore.setBind(command, keys, value),
    onClear: () => KeybindStore.clearBind(command, value),
  });

  unsubscribers.push(KeybindStore.subscribe(refresh));
  refresh();

  return input;
}

function createSettingsKeyInput({ settingKey }) {
  const input = DOM({
    tag: 'input',
    style: 'castle-keybinding-input',
    readonly: true,
  });

  function refresh() {
    const keys = Settings.settings?.[settingKey];
    input.value = formatKeys(Array.isArray(keys) ? keys : []);
  }

  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape' || e.key === 'Enter') {
      input.blur();
      return;
    }
    if (e.key === 'Backspace') {
      Settings.settings[settingKey] = [''];
      refresh();
      return;
    }
    const keys = normalizeKey(e);
    if (!Array.isArray(keys)) {
      Settings.settings[settingKey] = [];
      refresh();
      return;
    }
    const modifiers = new Set(['CTRL', 'ALT', 'SHIFT', 'WIN']);
    if (keys.length === 1 && modifiers.has(keys[0])) {
      refresh();
      return;
    }
    Settings.settings[settingKey] = keys;
    refresh();
  }, true);

  refresh();
  return input;
}

function createRow(label, inputEl) {
  return DOM({ style: 'keybinding-row' }, DOM({}, label), inputEl);
}

function createGroup(title, rows) {
  return DOM(
    { style: 'keybinding-group' },
    DOM({ tag: 'h3', style: 'keybinding-group-title' }, title),
    DOM({ style: 'keybinding-group-rows' }, ...rows),
  );
}

function buildTalents(ui) {
  const rows = [];

  for (let i = 1; i <= 12; i++) {
    const cmd = `cmd_action_bar_slot${i}`;
    rows.push(createRow(Lang.text('slot').replace('{num}', i), createKeyInput({ command: cmd })));
  }

  rows.push(createRow(Lang.text('selfCast'), createKeyInput({ command: 'self_cast_on' })));

  rows.push(createRow(Lang.text('portal'), createKeyInput({ command: 'cmd_portal' })));

  rows.push(createRow(Lang.text('actionBarLock'), createKeyInput({ command: 'actionbar_lock_off' })));

  return createGroup(Lang.text('talents'), rows);
}

function buildVoiceHotkeys() {
  const rows = [];
  rows.push(createRow(Lang.text('voiceEnableToggle'), createSettingsKeyInput({ settingKey: 'voiceToggleHotkey' })));
  rows.push(createRow(Lang.text('voiceDropCalls'), createSettingsKeyInput({ settingKey: 'voiceDropHotkey' })));
  rows.push(createRow(Lang.text('voiceOverlayUnlock'), createKeyInput({ command: 'voice_overlay_unlock_on' })));
  return createGroup(Lang.text('voiceHotkeys'), rows);
}

function buildAdditionalTalents() {
  const rows = [];

  for (let i = 13; i <= 24; i++) {
    const cmd = `cmd_action_bar_slot${i}`;
    rows.push(createRow(Lang.text('slot').replace('{num}', i), createKeyInput({ command: cmd })));
  }

  return createGroup(Lang.text('additionalTalents'), rows);
}

function buildSmartChat() {
  const rows = [];

  rows.push(createRow(Lang.text('smartChatMenu'), createKeyInput({ command: 'cmd_smart_chat' })));

  for (let i = 1; i <= 7; i++) {
    const cmd = `cmd_smart_chat_${i}`;
    rows.push(createRow(Lang.text(`smartChat${i}`), createKeyInput({ command: cmd })));
  }

  return createGroup(Lang.text('smartChat'), rows);
}

function buildFighting() {
  const map = [
    [Lang.text('move'), 'cmd_move'],
    [Lang.text('attack'), 'cmd_attack'],
    [Lang.text('hold'), 'cmd_hold'],
    [Lang.text('healthBars'), 'cs_toggle_healthbars'],
  ];

  const rows = map.map(([label, cmd]) => createRow(label, createKeyInput({ command: cmd })));

  return createGroup(Lang.text('fighting'), rows);
}

function buildWindowManagement() {
  const map = [
    [Lang.text('showStatistics'), 'show_statistics'],
    [Lang.text('character'), 'show_charstat'],
    [Lang.text('inventory'), 'show_inventory'],
    [Lang.text('talents'), 'show_talents'],
  ];

  const rows = map.map(([label, cmd]) => createRow(label, createKeyInput({ command: cmd })));

  return createGroup(Lang.text('windowManagement'), rows);
}

function buildCamera() {
  const rows = [];

  rows.push(createRow(Lang.text('cameraMode'), createKeyInput({ command: 'camera_switch_attach_mode_down' })));

  const numeric = [
    [Lang.text('forwardPlus'), 'camera_forward', '+1.0'],
    [Lang.text('forwardMinus'), 'camera_forward', '-1.0'],
    [Lang.text('strafePlus'), 'camera_strafe', '+1.0'],
    [Lang.text('strafeMinus'), 'camera_strafe', '-1.0'],
    [Lang.text('turnPlus'), 'camera_rotate', '+1.0'],
    [Lang.text('turnMinus'), 'camera_rotate', '-1.0'],
  ];

  for (const [label, cmd, value] of numeric) {
    rows.push(createRow(label, createKeyInput({ command: cmd, value })));
  }

  return createGroup(Lang.text('camera'), rows);
}

export async function keybindings() {
  const ok = await loadKeybinds();
  if (!ok) return DOM({}, Lang.text('settingsReadError'));
  NativeAPI.unregisterVoiceHotkeys?.();
  let initialVoiceToggleHotkey = JSON.stringify(Array.isArray(Settings.settings?.voiceToggleHotkey) ? Settings.settings.voiceToggleHotkey : []);
  let initialVoiceDropHotkey = JSON.stringify(Array.isArray(Settings.settings?.voiceDropHotkey) ? Settings.settings.voiceDropHotkey : []);

  const content = DOM(
    { style: 'keybindings-wrapper' },
    buildVoiceHotkeys(),
    buildTalents(),
    buildAdditionalTalents(),
    buildSmartChat(),
    buildFighting(),
    buildWindowManagement(),
    buildCamera(),
  );

  const saveBtn = DOM(
    {
      domaudio: domAudioPresets.bigButton,
      style: ['castle-menu-item-button', 'castle-menu-item-button--small'],
      event: [
        'click',
        async () => {
          // клавиши игры сохраняются, даже если запись настроек лаунчера не удалась
          try {
            await Settings.WriteSettings();
          } catch (e) {
            console.error('Failed to save launcher settings:', e);
          }
          NativeAPI.refreshVoiceHotkeys?.();
          const currentVoiceToggleHotkey = JSON.stringify(Array.isArray(Settings.settings?.voiceToggleHotkey) ? Settings.settings.voiceToggleHotkey : []);
          const currentVoiceDropHotkey = JSON.stringify(Array.isArray(Settings.settings?.voiceDropHotkey) ? Settings.settings.voiceDropHotkey : []);
          const voiceHotkeysChanged =
            currentVoiceToggleHotkey !== initialVoiceToggleHotkey || currentVoiceDropHotkey !== initialVoiceDropHotkey;
          if (voiceHotkeysChanged) {
            Voice.updateInfoPanel?.();
            initialVoiceToggleHotkey = currentVoiceToggleHotkey;
            initialVoiceDropHotkey = currentVoiceDropHotkey;
          }
          await saveKeybinds();
        },
      ],
    },
    Lang.text('save'),
  );

  const resetBtn = DOM(
    {
      domaudio: domAudioPresets.bigButton,
      style: ['castle-menu-item-button', 'castle-menu-item-button--small'],
      event: [
        'click',
        async () => {
          const temp = KeybindStore.configPath;
          await loadKeybindsBrowser({
            type: KeybindStore.source ?? 'browser',
            path: "/content/keybindsFallback.cfg",
          });
          // reset the config path
          KeybindStore.configPath = temp;
        },
      ],
    },
    Lang.text('reset'),
  );

  const discardBtn = DOM(
    {
      domaudio: domAudioPresets.closeButton,
      style: ['castle-menu-item-button', 'castle-menu-item-button--small', 'castle-menu-item-button--red'],
      event: [
        'click',
        () => {
          root.requestClose?.();
        },
      ],
    },
    Lang.text('discardChanges'),
  );

  const controls = DOM({ style: 'keybindings-controls' }, saveBtn, resetBtn, discardBtn);

  const root = DOM({ id: 'wcastle-keybindings' }, content, controls);

  root.cleanup = () => {
    NativeAPI.refreshVoiceHotkeys?.();
    unsubscribers.forEach((fn) => fn());
    unsubscribers.length = 0;
  };

  return root;
}
