import { validate, BindParseError } from './keybindings.validator.js';

/**
 * Parse Prime World keybind cfg into file model
 * @param {string} cfgText
 * @returns {{ sections: Array<{name: string|null, binds: any[]}> }}
 */
export function parseKeybindCfg(cfgText) {
  const lines = cfgText.split(/\r?\n/);

  /** @type {{ sections: any[] }} */
  const model = { sections: [] };

  let currentSection = { name: null, binds: [] };
  model.sections.push(currentSection);

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === 'unbindall') continue;

    // bindsection
    if (line.startsWith('bindsection')) {
      const parts = line.split(/\s+/);
      const name = parts.length > 1 ? parts[1] : null;

      currentSection = { name, binds: [] };
      model.sections.push(currentSection);
      continue;
    }

    //  bind or bind_command
    if (line.startsWith('bind ') || line.startsWith('bind_command ')) {
      // одна испорченная строка не должна сбрасывать весь файл к клавишам по умолчанию
      try {
        const bind = parseBindLine(line);
        if (bind) currentSection.binds.push(bind);
      } catch (e) {
        if (!(e instanceof BindParseError)) throw e;
        console.warn('input_new.cfg: skipped line:', line, e.message);
      }
    }
  }

  return model;
}

/**
 * Parse single bind line
 * @param {string} line
 */
export function parseBindLine(line) {
  let type = null;
  let bind = null;

  if (line.startsWith('bind ')) {
    type = 'bind';
  } else if (line.startsWith('bind_command ')) {
    type = 'bind_command';
  } else {
    throw new BindParseError(`Unknown bind type: ${line}`);
  }

  switch (type) {
    case 'bind':
      bind = parseBind(line);
      break;
    case 'bind_command':
      bind = parseBindCommand(line);
      break;
  }

  validate(bind, line);

  return bind;
}

function parseBind(line) {
  let command = null;
  let value = null;
  let negated = false;
  let keys = null;

  const allTokens = tokenize(line);
  const tokens = [...allTokens];

  tokens.shift(); // remove bind

  // command
  command = tokens.shift();
  if (command === '+' || command === '-') {
    command += tokens.shift();
  }

  // negated
  if (command.startsWith('!')) {
    negated = true;
    command = command.slice(1);
  }

  // value
  if (
    (tokens[0] === '+' || tokens[0] === '-') &&
    /^\d+(\.\d+)?$/.test(tokens[1])
  ) {
    value = tokens.shift() + tokens.shift();
  }
  else if (/^\d+(\.\d+)?$/.test(tokens[0])) {
    value = tokens.shift();
  }

  // keys 
  keys = getKeysFromTokens(tokens);

  const bind = {
    type: 'bind',
    command,
    value,
    negated,
    keys,
  };

  return bind;
}

function parseBindCommand(line) {
  let command = null;
  let value = null;
  let negated = false;
  let keys = null;

  const allTokens = tokenize(line);
  const tokens = [...allTokens];

  tokens.shift(); // remove bind_command
  
  // keys
  keys = getKeysFromTokens(tokens);
  
  // command
  const cmdToken = tokens.find(
    t => t.startsWith('"') && t.endsWith('"')
  );

  if (cmdToken) {
    command = cmdToken.slice(1, -1);
  }

  const bind = {
    type: 'bind_command',
    command,
    value,
    negated,
    keys,
  };

  return bind;
}

function getKeysFromTokens(tokens) {
  return tokens
    .filter(t => t !== '+')
    .filter(t => t.startsWith("'") && t.endsWith("'"))
    .map(t => t.slice(1, -1));
}

/**
 * Tokenize a given string into an array of tokens.
 * Tokens are defined as any of the following:
 * - A single '+' character
 * - A sequence of characters enclosed in single quotes
 * - Any sequence of non-whitespace characters
 * @param {string} str - The string to tokenize
 * @returns {Array<string>} - An array of tokens
 */
export function tokenize(str) {
  const regex = /'[^']*'|"[^"]*"|\+|-|[^\s+-]+/g;
  return str.match(regex) || [];
}

