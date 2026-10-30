import { GAME_KEY_ALIASES, isGameKeyValid } from './keybindings.input.js';

export function createEmptyFileModel() {
  return {
    sections: [
      // GLOBAL
      {
        name: null,
        binds: [
          { type: 'bind', command: 'console_prevcommand', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_nextcommand', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_scrollup', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_scrolldown', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_charleft', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_charright', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_home', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_end', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_runcommand', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_runcommand', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_autocomplete', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_clear', value: null, negated: false, keys: null },
          { type: 'bind', command: 'console_eraselastchar', value: null, negated: false, keys: null },
          { type: 'bind_command', command: 'toggle_fps', value: null, negated: false, keys: null },
          { type: 'bind_command', command: 'screenshot .jpg', value: null, negated: false, keys: null },
          { type: 'bind_command', command: 'screenshot .png', value: null, negated: false, keys: null },
        ],
      },

      //  adventure_screen (main)
      {
        name: 'adventure_screen',
        binds: [
          { type: 'bind', command: 'cmd_move', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_attack', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_hold', value: null, negated: false, keys: null },

          // slots 1–24
          ...Array.from({ length: 24 }, (_, i) => ({
            type: 'bind',
            command: `cmd_action_bar_slot${i + 1}`,
            value: null,
            negated: false,
            keys: null,
          })),
          { type: 'bind', command: 'self_cast_on', value: null, negated: false, keys: null },
          { type: 'bind', command: 'self_cast_off', value: null, negated: true, keys: null },

          { type: 'bind', command: 'cmd_portal', value: null, negated: false, keys: null },

          { type: 'bind', command: 'cs_toggle_healthbars', value: null, negated: false, keys: null },

          { type: 'bind', command: 'exit_game', value: null, negated: false, keys: null },

          { type: 'bind', command: 'camera_switch_attach_mode_down', value: null, negated: false, keys: null },
          { type: 'bind', command: 'camera_switch_attach_mode_up', value: null, negated: true, keys: null },

          { type: 'bind', command: 'show_statistics', value: null, negated: false, keys: null },
          { type: 'bind', command: 'hide_statistics', value: null, negated: true, keys: null },

          { type: 'bind', command: 'show_charstat', value: null, negated: false, keys: null },
          { type: 'bind', command: 'show_inventory', value: null, negated: false, keys: null },
          { type: 'bind', command: 'show_talents', value: null, negated: false, keys: null },

          { type: 'bind', command: 'actionbar_lock_off', value: null, negated: false, keys: null },
          { type: 'bind', command: 'actionbar_lock_on', value: null, negated: true, keys: null },
        ],
      },

      //  GLOBAL
      {
        name: null,
        binds: [
          { type: 'bind', command: 'cmd_cancel', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cs_mouse_wheel_down', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cs_mouse_wheel_up', value: null, negated: true, keys: null },
          { type: 'bind', command: 'exit_bind', value: null, negated: false, keys: null },
        ],
      },

      //  adventure_screen (camera numeric)
      {
        name: 'adventure_screen',
        binds: [
          { type: 'bind', command: 'camera_zoom', value: '+1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_zoom', value: '-1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_forward', value: '+1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_forward', value: '-1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_strafe', value: '+1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_strafe', value: '-1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_pitch', value: '-1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_pitch', value: '+1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_rotate', value: '+1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_rotate', value: '-1.0', negated: false, keys: null },
          { type: 'bind', command: 'camera_zoom_mouse', value: '-0.003', negated: false, keys: null },
        ],
      },

      //  GLOBAL (mouse camera)
      {
        name: null,
        binds: [
          { type: 'bind', command: '+camera_roll', value: null, negated: false, keys: null },
          { type: 'bind', command: '-camera_roll', value: null, negated: false, keys: null },
          { type: 'bind', command: '+camera_upward', value: null, negated: false, keys: null },
          { type: 'bind', command: '-camera_upward', value: null, negated: false, keys: null },

          { type: 'bind', command: 'camera_rotate_mouse', value: '0.03', negated: false, keys: null },
          { type: 'bind', command: 'camera_pitch_mouse', value: '0.03', negated: false, keys: null },
          { type: 'bind', command: 'camera_strafe_mouse', value: '-0.03', negated: false, keys: null },
          { type: 'bind', command: 'camera_strafe_mouse', value: '0.03', negated: false, keys: null },
          { type: 'bind', command: 'camera_forward_mouse', value: '-0.03', negated: false, keys: null },
          { type: 'bind', command: 'camera_forward_mouse', value: '0.03', negated: false, keys: null },
        ],
      },

      //  minigame
      {
        name: 'minigame',
        binds: [
          { type: 'bind', command: 'minigame_escape', value: null, negated: false, keys: null },
          { type: 'bind', command: 'easel_mg_boost1', value: null, negated: false, keys: null },
          { type: 'bind', command: 'easel_mg_boost2', value: null, negated: false, keys: null },
          { type: 'bind', command: 'easel_mg_boost3', value: null, negated: false, keys: null },
          { type: 'bind', command: 'easel_mg_heroic_boost', value: null, negated: false, keys: null },
          { type: 'bind', command: 'show_charstat', value: null, negated: false, keys: null },
          { type: 'bind', command: 'show_talents', value: null, negated: false, keys: null },
          { type: 'bind', command: 'show_statistics', value: null, negated: false, keys: null },
          { type: 'bind', command: 'hide_statistics', value: null, negated: true, keys: null },
          { type: 'bind', command: 'easel_skip_movie', value: null, negated: false, keys: null },
        ],
      },

      //  GLOBAL (chat & misc)
      {
        name: null,
        binds: [
          { type: 'bind', command: 'dialog_escape', value: null, negated: false, keys: null },

          { type: 'bind', command: 'editline_wordleft', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_wordright', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_left', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_right', value: null, negated: false, keys: null },

          { type: 'bind', command: 'editline_paste', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_copy', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_cut', value: null, negated: false, keys: null },

          { type: 'bind', command: 'editline_up', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_down', value: null, negated: false, keys: null },

          { type: 'bind', command: 'editline_return', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_return', value: null, negated: false, keys: null },

          { type: 'bind', command: 'editline_delete', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_back', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_clear', value: null, negated: false, keys: null },
          { type: 'bind', command: 'editline_tab', value: null, negated: false, keys: null },

          { type: 'bind', command: 'draganddrop_cancel', value: null, negated: false, keys: null },
          { type: 'bind', command: 'dumpscreens', value: null, negated: false, keys: null },

          { type: 'bind', command: 'minimap_signal_key_down', value: null, negated: false, keys: null },
          { type: 'bind', command: 'minimap_signal_key_up', value: null, negated: true, keys: null },

          { type: 'bind', command: 'chat_open_close', value: null, negated: false, keys: null },
          { type: 'bind', command: 'chat_open_global', value: null, negated: false, keys: null },
          { type: 'bind', command: 'chat_open_team', value: null, negated: false, keys: null },

          { type: 'bind', command: 'window_full_screen', value: null, negated: false, keys: null },

          { type: 'bind', command: 'login_screen_tab', value: null, negated: false, keys: null },
          { type: 'bind', command: 'login_screen_enter', value: null, negated: false, keys: null },
          { type: 'bind', command: 'login_screen_enter', value: null, negated: false, keys: null },

          { type: 'bind', command: 'open_close_game_menu', value: null, negated: false, keys: null },
          { type: 'bind', command: 'skip_phrase_cinematic', value: null, negated: false, keys: null },

          { type: 'bind', command: 'cmd_smart_chat', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_cancel', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_1', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_2', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_3', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_4', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_5', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_6', value: null, negated: false, keys: null },
          { type: 'bind', command: 'cmd_smart_chat_7', value: null, negated: false, keys: null },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------- модель файла

const sectionKey = (name) => name ?? '__global__';

// '+1.0' и '+1', '0.03' и '+0.03' — одно и то же значение
export function sameValue(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Number(a) === Number(b);
}

export function sameBind(a, b) {
  return a.type === b.type && a.command === b.command && !!a.negated === !!b.negated && sameValue(a.value, b.value);
}

/**
 * Модель — строки самого input_new.cfg: порядок, повторы (ENTER и NUM_ENTER у одной команды)
 * и команды, которых лаунчер не знает, остаются как есть — файл общий с игрой, она пишет его
 * при выходе из боя и из своих настроек. Из шаблона добавляются только недостающие команды,
 * без клавиш (в файл такие не пишутся), чтобы их можно было назначить в окне.
 */
export function normalizeFileModel(schemaModel, parsedModel) {
  const model = {
    sections: (parsedModel?.sections || []).map((s) => ({
      name: s.name ?? null,
      binds: s.binds.map((b) => ({ ...b, keys: Array.isArray(b.keys) ? [...b.keys] : null })),
    })),
  };
  if (!model.sections.length) model.sections.push({ name: null, binds: [] });

  const has = (name, bind) =>
    model.sections.some((s) => sectionKey(s.name) === sectionKey(name) && s.binds.some((b) => sameBind(b, bind)));

  for (const section of schemaModel.sections) {
    for (const bind of section.binds) {
      if (has(section.name, bind)) continue;
      let target = null;
      for (const s of model.sections) if (sectionKey(s.name) === sectionKey(section.name)) target = s;
      if (!target) {
        target = { name: section.name ?? null, binds: [] };
        model.sections.push(target);
      }
      target.binds.push({ ...bind, keys: null });
    }
  }

  return model;
}

export function findBind(fileModel, command, value = null) {
  for (const section of fileModel?.sections || []) {
    for (const bind of section.binds) {
      if (bind.type === 'bind' && bind.command === command && sameValue(bind.value, value)) return bind;
    }
  }
  return null;
}

// ---------------------------------------------------------------- команды окон «Клавиши» и «Настройки боя»

const camera = (command, value, label) => ({ command, value, label, scope: 'battle' });
const battle = (command, label) => ({ command, value: null, label, scope: 'battle' });

/**
 * Всё, что игрок назначает сам. scope — где клавиши не должны совпадать: 'battle' — в бою
 * (adventure_screen и общие команды чата), 'wheel' — фразы колеса быстрых команд: они работают,
 * только пока колесо открыто, поэтому по умолчанию делят цифры со слотами.
 */
export const UI_BINDS = [
  ...Array.from({ length: 24 }, (_, i) => battle(`cmd_action_bar_slot${i + 1}`, `bsKeyActionBarSlot${i + 1}`)),
  battle('self_cast_on', 'bsKeySelfCast'),
  battle('cmd_portal', 'bsKeyPortal'),
  battle('actionbar_lock_off', 'bsKeyActionBarLockOff'),
  battle('voice_overlay_unlock_on', 'bsKeyVoiceOverlayUnlock'),
  battle('cmd_smart_chat', 'bsKeyOpenSmartChat'),
  ...Array.from({ length: 7 }, (_, i) => ({
    command: `cmd_smart_chat_${i + 1}`,
    value: null,
    label: `bsKeySmartChat${i + 1}`,
    scope: 'wheel',
  })),
  battle('cmd_move', 'bsKeyMove'),
  battle('cmd_attack', 'bsKeyAttack'),
  battle('cmd_hold', 'bsKeyHold'),
  battle('cs_toggle_healthbars', 'bsKeyToggleHealthbars'),
  battle('chat_open_close', 'bsKeyOpenChat'),
  battle('chat_open_global', 'bsKeyOpenGlobalChat'),
  battle('chat_open_team', 'bsKeyOpenTeamChat'),
  battle('show_statistics', 'bsKeyShowStatistics'),
  battle('show_charstat', 'bsKeyShowCharStats'),
  battle('show_inventory', 'bsKeyShowInventory'),
  battle('show_talents', 'bsKeyShowTalents'),
  battle('camera_switch_attach_mode_down', 'bsKeyHeroCenter'),
  camera('camera_forward', '+1.0', 'bsKeyCameraUp'),
  camera('camera_forward', '-1.0', 'bsKeyCameraDown'),
  camera('camera_strafe', '-1.0', 'bsKeyCameraLeft'),
  camera('camera_strafe', '+1.0', 'bsKeyCameraRight'),
  camera('camera_rotate', '-1.0', 'bsKeyCameraRotateLeft'),
  camera('camera_rotate', '+1.0', 'bsKeyCameraRotateRight'),
];

// Эти пары по умолчанию на одной клавише (SHIFT держит и панель, и оверлей войса) — не конфликт
export const SHARED_KEY_PAIRS = [['actionbar_lock_off', 'voice_overlay_unlock_on']];

export function uiBindOf(command, value = null) {
  return UI_BINDS.find((u) => u.command === command && sameValue(u.value, value)) || null;
}

/**
 * Связанные команды: одна клавиша на всех (нажатие и отпускание, одна команда в бою и в
 * мини-игре, Enter в консоли, чате и на экране входа). Меняются вместе.
 */
export const LINKED_GROUPS = {
  charstat: { members: [{ command: 'show_charstat', negated: false }], sections: ['adventure_screen', 'minigame'] },
  inventory: { members: [{ command: 'show_inventory', negated: false }], sections: ['adventure_screen', 'minigame'] },
  talents: { members: [{ command: 'show_talents', negated: false }], sections: ['adventure_screen', 'minigame'] },
  statistics: {
    members: [
      { command: 'show_statistics', negated: false },
      { command: 'hide_statistics', negated: true },
    ],
    sections: ['adventure_screen', 'minigame'],
  },
  actionbarLock: {
    members: [
      { command: 'actionbar_lock_off', negated: false },
      { command: 'actionbar_lock_on', negated: true },
    ],
    sections: ['adventure_screen'],
  },
  voiceOverlayUnlock: {
    members: [
      { command: 'voice_overlay_unlock_on', negated: false },
      { command: 'voice_overlay_unlock_off', negated: true },
    ],
    sections: ['adventure_screen'],
  },
  selfCast: {
    members: [
      { command: 'self_cast_on', negated: false },
      { command: 'self_cast_off', negated: true },
    ],
    sections: ['adventure_screen'],
  },
  enter: {
    members: [
      { command: 'console_runcommand', negated: false },
      { command: 'editline_return', negated: false },
      { command: 'login_screen_enter', negated: false },
    ],
    sections: ['__global__'],
  },
  consoleUpKey: {
    members: [
      { command: 'console_prevcommand', negated: false },
      { command: 'editline_up', negated: false },
    ],
    sections: ['__global__'],
  },
  consoleDownKey: {
    members: [
      { command: 'console_nextcommand', negated: false },
      { command: 'editline_down', negated: false },
    ],
    sections: ['__global__'],
  },
  consoleLeftKey: {
    members: [
      { command: 'console_charleft', negated: false },
      { command: 'editline_left', negated: false },
    ],
    sections: ['__global__'],
  },
  consoleRightKey: {
    members: [
      { command: 'console_charright', negated: false },
      { command: 'editline_right', negated: false },
    ],
    sections: ['__global__'],
  },
  tabKey: {
    members: [
      { command: 'console_autocomplete', negated: false },
      { command: 'editline_tab', negated: false },
      { command: 'login_screen_tab', negated: false },
    ],
    sections: ['__global__'],
  },
  escapeKey: {
    members: [
      { command: 'console_clear', negated: false },
      { command: 'cmd_cancel', negated: false },
      { command: 'exit_bind', negated: false },
      { command: 'dialog_escape', negated: false },
      { command: 'editline_clear', negated: false },
      { command: 'draganddrop_cancel', negated: false },
      { command: 'open_close_game_menu', negated: false },
      { command: 'cmd_smart_chat_cancel', negated: false },
    ],
    sections: ['__global__'],
  },
  backspaceKey: {
    members: [
      { command: 'console_eraselastchar', negated: false },
      { command: 'editline_back', negated: false },
    ],
    sections: ['__global__'],
  },
  minimapSignal: {
    members: [
      { command: 'minimap_signal_key_down', negated: false },
      { command: 'minimap_signal_key_up', negated: true },
    ],
    sections: ['__global__'],
  },
  cameraAttach: {
    members: [
      { command: 'camera_switch_attach_mode_down', negated: false },
      { command: 'camera_switch_attach_mode_up', negated: true },
    ],
    sections: ['adventure_screen'],
  },
  mouseWheelPair: {
    members: [
      { command: 'cs_mouse_wheel_down', negated: false },
      { command: 'cs_mouse_wheel_up', negated: true },
    ],
    sections: ['__global__'],
  },
};

// Все строки файла, связанные с bind, вместе с ним самим
export function findLinkedBinds(fileModel, bind, linkedGroups = LINKED_GROUPS) {
  const result = [bind];
  for (const group of Object.values(linkedGroups)) {
    if (!group.members.some((m) => m.command === bind.command && m.negated === !!bind.negated)) continue;
    for (const section of fileModel.sections) {
      if (!group.sections.includes(sectionKey(section.name))) continue;
      for (const other of section.binds) {
        if (other === bind || result.includes(other)) continue;
        if (!group.members.some((m) => m.command === other.command && m.negated === !!other.negated)) continue;
        if (other.value != null || bind.value != null) continue;
        result.push(other);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------- клавиши: проверка и заглушки

export function comboOf(keys) {
  return Array.isArray(keys) ? [...keys].sort().join('+') : '';
}

// Клавиши, которые игра поймёт: известные имена (старые имена лаунчера переводятся), без пустых
export function cleanKeys(keys) {
  if (!Array.isArray(keys)) return null;
  const out = [];
  for (const raw of keys) {
    const key = GAME_KEY_ALIASES[raw] || raw;
    if (!key || !isGameKeyValid(key)) return null;
    if (!out.includes(key)) out.push(key);
  }
  return out.length ? out : null;
}

/**
 * «Не назначено». Строку команды из окна в файле оставляем: игра сохраняет переназначение из
 * своих настроек, только если строка команды уже есть (rebind ищет её по имени), а оверлей войса
 * без строки она снова вешает на SHIFT. Пустая клавиша ('') не годится — команда будет «зажата».
 * Поэтому — F13…F15 (на клавиатурах их нет) с модификаторами, у каждой команды своя.
 */
const PLACEHOLDER_MAINS = ['F13', 'F14', 'F15'];
const PLACEHOLDER_MODS = [[], ['CTRL'], ['SHIFT'], ['ALT'], ['CTRL', 'SHIFT'], ['CTRL', 'ALT'], ['SHIFT', 'ALT'], ['CTRL', 'SHIFT', 'ALT']];
export const PLACEHOLDER_KEYS = PLACEHOLDER_MODS.flatMap((mods) => PLACEHOLDER_MAINS.map((k) => [...mods, k]));

export function isPlaceholder(keys) {
  if (!Array.isArray(keys) || !keys.length) return false;
  const main = keys[keys.length - 1];
  return PLACEHOLDER_MAINS.includes(main) && keys.slice(0, -1).every((k) => ['CTRL', 'ALT', 'SHIFT'].includes(k));
}

export function freePlaceholder(fileModel) {
  const used = new Set();
  for (const section of fileModel.sections) for (const b of section.binds) if (b.keys) used.add(comboOf(b.keys));
  return [...(PLACEHOLDER_KEYS.find((k) => !used.has(comboOf(k))) || PLACEHOLDER_KEYS[PLACEHOLDER_KEYS.length - 1])];
}

// Клавиши для окна: заглушка и пустота — «не назначено»
export function displayKeys(bind) {
  const keys = cleanKeys(bind?.keys);
  return keys && !isPlaceholder(keys) ? keys : [];
}

function setLinked(fileModel, bind, keys, linkedGroups) {
  for (const b of findLinkedBinds(fileModel, bind, linkedGroups)) b.keys = keys ? [...keys] : null;
}

/**
 * Чинит то, из-за чего игра ведёт себя неправильно: пустые ('') и неизвестные игре клавиши
 * (F16…F24, NUM_SUB, WIN…). Старые имена лаунчера переводятся в имена игры, у команд окна
 * сломанная клавиша меняется на заглушку, остальные такие строки убираются. Слоты 1–24 всегда
 * есть в файле. Возвращает список правок (пустой — менять нечего).
 */
export function repairFileModel(fileModel, linkedGroups = LINKED_GROUPS) {
  const fixes = [];
  for (const section of fileModel.sections) {
    for (const bind of section.binds) {
      if (bind.keys === null) continue;
      const clean = cleanKeys(bind.keys);
      if (clean && clean.join('+') === bind.keys.join('+')) continue;
      const before = comboOf(bind.keys);
      if (clean) {
        bind.keys = clean;
      } else if (bind.type === 'bind' && uiBindOf(bind.command, bind.value)) {
        setLinked(fileModel, bind, freePlaceholder(fileModel), linkedGroups);
      } else {
        // отпускание без нажатия (или наоборот) ломает пару — берём клавишу живой связанной строки
        const partner = findLinkedBinds(fileModel, bind, linkedGroups).find((b) => b !== bind && cleanKeys(b.keys));
        bind.keys = partner ? cleanKeys(partner.keys) : null;
      }
      fixes.push(`${bind.command}${bind.value != null ? ' ' + bind.value : ''}: '${before}' -> '${comboOf(bind.keys)}'`);
    }
  }
  for (let n = 1; n <= 24; n++) {
    const bind = findBind(fileModel, `cmd_action_bar_slot${n}`);
    if (!bind || bind.keys) continue;
    bind.keys = freePlaceholder(fileModel);
    fixes.push(`cmd_action_bar_slot${n}: added '${comboOf(bind.keys)}'`);
  }
  return fixes;
}
