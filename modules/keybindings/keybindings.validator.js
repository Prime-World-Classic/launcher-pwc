import { UI_BINDS, SHARED_KEY_PAIRS, findBind, comboOf, displayKeys } from './keybindings.schema.js';

export class BindParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'BindParseError';
    this.line = line;
  }
}

export class BindSameKeysError extends Error {
  constructor(combo, conflicts) {
    super(`Key combo ${combo} is assigned to multiple commands: ${conflicts.map((c) => c.command).join(', ')}`);
    this.name = 'BindSameKeysError';
    this.combo = combo;
    this.conflicts = conflicts;
  }
}

// Validate parse
export function validate(bind, line) {
  switch (bind.type) {
    case 'bind':
      validateBind(bind, line);
      break;
    case 'bind_command':
      validateBindCommand(bind, line);
      break;
    default:
      throw new BindParseError(`Unknown bind type: ${bind.type}`, line);
  }
}

function validateBind(bind, line) {
  if (!bind.command || typeof bind.command !== 'string') {
    throw new BindParseError('Missing or invalid command', line);
  }

  if (typeof bind.negated !== 'boolean') {
    throw new BindParseError('Invalid negated flag', line);
  }

  if (bind.value !== null) {
    if (typeof bind.value !== 'string' || !/^[-+]?\d+(\.\d+)?$/.test(bind.value)) {
      throw new BindParseError('Invalid numeric value', line);
    }
  }

  if (bind.keys !== null) {
    if (!Array.isArray(bind.keys)) {
      throw new BindParseError('Keys must be array or null', line);
    }
    for (const k of bind.keys) {
      if (typeof k !== 'string') {
        throw new BindParseError(`Invalid key "${k}"`, line);
      }
    }
  }

  if (bind.value !== null && (!bind.keys || bind.keys.length === 0)) {
    throw new BindParseError('Bind with value requires keys', line);
  }
}

function validateBindCommand(bind, line) {
  if (bind.value !== null) {
    throw new BindParseError('bind_command must not have value', line);
  }

  if (!bind.command || typeof bind.command !== 'string') {
    throw new BindParseError('bind_command requires command', line);
  }

  if (!Array.isArray(bind.keys) || bind.keys.length === 0) {
    throw new BindParseError('bind_command requires keys', line);
  }
}

// ---------------------------------------------------------------- конфликты клавиш

/**
 * Конфликт — одна клавиша (комбинация) у двух команд окна, которые работают одновременно
 * (одна scope из UI_BINDS): в игре нажатие сработает за обе. Заглушки «не назначено» не считаются.
 * Возвращает [{ combo, scope, entries: [UI_BINDS…] }].
 */
export function findConflicts(fileModel) {
  const groups = new Map();
  for (const ui of UI_BINDS) {
    const keys = displayKeys(findBind(fileModel, ui.command, ui.value));
    if (!keys.length) continue;
    const id = `${ui.scope}|${comboOf(keys)}`;
    if (!groups.has(id)) groups.set(id, { combo: comboOf(keys), scope: ui.scope, entries: [] });
    groups.get(id).entries.push(ui);
  }
  return [...groups.values()].filter((g) => g.entries.some((a) => g.entries.some((b) => a !== b && !keysMayShare(a, b))));
}

export function keysMayShare(a, b) {
  return SHARED_KEY_PAIRS.some(([x, y]) => (a.command === x && b.command === y) || (a.command === y && b.command === x));
}
