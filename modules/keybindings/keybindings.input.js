const CODE_MAP = {
  /* Letters */
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E',
  KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J',
  KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N', KeyO: 'O',
  KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T',
  KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y',
  KeyZ: 'Z',

  /* Digits */
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3',
  Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7',
  Digit8: '8', Digit9: '9',

  /* Arrows */
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',

  /* Navigation */
  Space: 'SPACE',
  Enter: 'ENTER',
  Escape: 'ESC',
  Tab: 'TAB',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  Insert: 'INSERT',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PG_UP',
  PageDown: 'PG_DOWN',
  Backquote: '`',

  /* Function */
  F1:'F1',F2:'F2',F3:'F3',F4:'F4',F5:'F5',F6:'F6',
  F7:'F7',F8:'F8',F9:'F9',F10:'F10',F11:'F11',F12:'F12',

  /* Numpad */
  Numpad0:'NUM_0',Numpad1:'NUM_1',Numpad2:'NUM_2',
  Numpad3:'NUM_3',Numpad4:'NUM_4',Numpad5:'NUM_5',
  Numpad6:'NUM_6',Numpad7:'NUM_7',Numpad8:'NUM_8',
  Numpad9:'NUM_9',
  NumpadAdd:'NUM_ADD',
  NumpadSubtract:'NUM_SUB',
  NumpadMultiply:'NUM_MUL',
  NumpadDivide:'NUM_DIV',
  NumpadDecimal:'NUM_DOT',
  NumpadEnter:'NUM_ENTER'
};

export function normalizeKey(e) {
  const keys = [];

  if (e.ctrlKey) keys.push('CTRL');
  if (e.altKey) keys.push('ALT');
  if (e.shiftKey) keys.push('SHIFT');
  if (e.metaKey) keys.push('WIN');

  let main = CODE_MAP[e.code];

  if (!main || ['CTRL', 'ALT', 'SHIFT', 'WIN'].includes(main)) {
    return keys.length ? keys : '';
  }

  keys.push(main);

  return keys.length > 2 ? keys.slice(-2) : keys;
}



// ---------------------------------------------------------------- клавиши игры (input_new.cfg)
// Имена клавиш, которые знает игра (NivalInput/HwInputKeys.inl) + CTRL/ALT/SHIFT, которые она сама
// раскрывает в L/R. Неизвестное имя игра не пропускает, а оставляет пустую комбинацию — такая
// команда «зажата» после первого же нажатия любой клавиши (камера уезжает, слот срабатывает сам).
export const GAME_KEY_NAMES = new Set([
  'CTRL', 'ALT', 'SHIFT',
  'ESC', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'BACKSPACE', 'TAB',
  'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', 'ENTER', 'LCTRL',
  'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", '`', 'LSHIFT', '\\',
  'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'RSHIFT', 'NUM_MULTIPLY', 'LALT', 'SPACE', 'CAPITAL',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'NUM', 'SCROLL',
  'NUM_7', 'NUM_8', 'NUM_9', 'NUM_MINUS', 'NUM_4', 'NUM_5', 'NUM_6', 'NUM_PLUS',
  'NUM_1', 'NUM_2', 'NUM_3', 'NUM_0', 'NUM_PERIOD', 'OEM_102', 'F11', 'F12', 'F13', 'F14', 'F15',
  'KANA', 'ABNT_C1', 'CONVERT', 'NOCONVERT', 'YEN', 'ABNT_C2', 'NUM_EQUALS', 'PREV_TRACK', 'AT', 'COLON',
  'UNDERLINE', 'KANJI', 'STOP', 'AX', 'UNLABELED', 'NEXT_TRACK', 'NUM_ENTER', 'RCTRL', 'MUTE', 'CALCULATOR',
  'PLAY', 'MEDIA_STOP', 'VOL_DOWN', 'VOL_UP', 'WEB_HOME', 'NUM_COMMA', 'NUM_DIVIDE', 'SYSRQ', 'RALT', 'PAUSE',
  'HOME', 'UP', 'PG_UP', 'LEFT', 'RIGHT', 'END', 'DOWN', 'PG_DOWN', 'INSERT', 'DELETE', 'LWIN', 'RWIN',
  'APP_MENU', 'POWER', 'SLEEP', 'WAKE', 'WEB_SEARCH', 'WEB_FAVOR', 'WEB_REFRESH', 'WEB_STOP', 'WEB_FORWARD',
  'WEB_BACK', 'MYCOMPUTER', 'MAIL', 'MEDIA_SELECT', 'MAC_SECTION_SIGN',
  'MOUSE_AXIS_X', 'MOUSE_AXIS_Y', 'MOUSE_AXIS_Z',
  'MOUSE_BUTTON0', 'MOUSE_BUTTON1', 'MOUSE_BUTTON2', 'MOUSE_BUTTON3', 'MOUSE_BUTTON4',
  'MOUSE_BUTTON5', 'MOUSE_BUTTON6', 'MOUSE_BUTTON7',
]);

// Имена, которые раньше писал лаунчер (CODE_MAP выше — он для клавиш войса), а игра не знает.
export const GAME_KEY_ALIASES = {
  NUM_ADD: 'NUM_PLUS',
  NUM_SUB: 'NUM_MINUS',
  NUM_MUL: 'NUM_MULTIPLY',
  NUM_DIV: 'NUM_DIVIDE',
  NUM_DOT: 'NUM_PERIOD',
  WIN: 'LWIN',
};

const GAME_MODIFIERS = ['CTRL', 'ALT', 'SHIFT'];

const GAME_CODE_MAP = {
  ...CODE_MAP,
  NumpadAdd: 'NUM_PLUS',
  NumpadSubtract: 'NUM_MINUS',
  NumpadMultiply: 'NUM_MULTIPLY',
  NumpadDivide: 'NUM_DIVIDE',
  NumpadDecimal: 'NUM_PERIOD',
  NumpadEqual: 'NUM_EQUALS',
  NumpadComma: 'NUM_COMMA',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Backslash: '\\',
  IntlBackslash: 'OEM_102',
  Comma: ',',
  Period: '.',
  Slash: '/',
  CapsLock: 'CAPITAL',
  ScrollLock: 'SCROLL',
  NumLock: 'NUM',
  Pause: 'PAUSE',
  PrintScreen: 'SYSRQ',
  ContextMenu: 'APP_MENU',
  // Quote (') не берём: в input_new.cfg клавиша пишется в одинарных кавычках
};

// Кнопки мыши (MouseEvent.button) → имена игры. Левая и правая заняты управлением героем.
const GAME_MOUSE_MAP = { 1: 'MOUSE_BUTTON2', 3: 'MOUSE_BUTTON3', 4: 'MOUSE_BUTTON4' };

function gameModifiers(e) {
  const keys = [];
  if (e.ctrlKey) keys.push('CTRL');
  if (e.altKey) keys.push('ALT');
  if (e.shiftKey) keys.push('SHIFT');
  return keys;
}

// Нажатие → клавиши игры: [] — клавиша игре неизвестна; одни модификаторы — ['SHIFT'] и т. п.
export function normalizeGameKey(e) {
  const keys = gameModifiers(e);
  const main = GAME_CODE_MAP[e.code];
  if (main) keys.push(main);
  return keys.length > 2 ? keys.slice(-2) : keys;
}

export function isGameKeyValid(name) {
  return GAME_KEY_NAMES.has(name);
}

export function isBareModifier(keys) {
  return Array.isArray(keys) && keys.length > 0 && keys.every((k) => GAME_MODIFIERS.includes(k));
}

/**
 * Захват клавиши игры полем ввода: Esc — выйти, Backspace — снять клавишу, клавиша или
 * комбинация — назначить; средняя и боковые кнопки мыши — тоже. Модификатор сам по себе
 * назначается при отпускании: иначе, набирая SHIFT + 3, поле успело бы занять SHIFT
 * (и снять его с другой команды).
 */
export function attachGameKeyCapture(input, { onKeys, onClear }) {
  let pending = null;

  input.addEventListener(
    'keydown',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        pending = null;
        input.blur();
        return;
      }
      if (e.code === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        pending = null;
        onClear();
        return;
      }
      const keys = normalizeGameKey(e);
      if (!keys.length) return;
      if (isBareModifier(keys)) {
        pending = keys;
        return;
      }
      pending = null;
      onKeys(keys);
    },
    true,
  );

  input.addEventListener(
    'keyup',
    (e) => {
      if (!pending) return;
      e.preventDefault();
      e.stopPropagation();
      const keys = pending;
      pending = null;
      onKeys(keys);
    },
    true,
  );

  input.addEventListener('blur', () => {
    pending = null;
  });

  input.addEventListener(
    'mousedown',
    (e) => {
      const main = GAME_MOUSE_MAP[e.button];
      if (!main || document.activeElement !== input) return;
      e.preventDefault();
      e.stopPropagation();
      pending = null;
      onKeys([...gameModifiers(e), main].slice(-2));
    },
    true,
  );
  // боковые кнопки мыши иначе листают историю страницы
  input.addEventListener('mouseup', (e) => {
    if (GAME_MOUSE_MAP[e.button]) e.preventDefault();
  });
  input.addEventListener('auxclick', (e) => e.preventDefault());
}
