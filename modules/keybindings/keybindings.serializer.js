import { cleanKeys } from './keybindings.schema.js';

/**
 * Serialize keybind file model into string.
 * Строки без клавиш, понятных игре, не пишутся: `bind … ''` игра читает как комбинацию без
 * клавиш, и команда «зажата» с первого нажатия (так камера сама уезжала вправо).
 * Повторы одной и той же строки в одной секции и пустые секции тоже не пишутся.
 * @param {{ sections: Array<{name: string|null, binds: any[]}> }} fileModel
 * @returns {string} Serialized keybind config
 */
export function serializeCfg(fileModel) {
  if (!fileModel) return '';
  let out = 'unbindall\n';
  const written = new Set();

  for (const section of fileModel.sections) {
    const lines = [];
    for (const bind of section.binds) {
      const keys = cleanKeys(bind.keys);
      if (!keys) continue;
      const line = bind.type === 'bind_command' ? serializeBindCommand(bind, keys) : serializeBind(bind, keys);
      const id = `${section.name ?? ''}|${line}`;
      if (written.has(id)) continue;
      written.add(id);
      lines.push(line);
    }
    if (!lines.length) continue;
    out += section.name ? `bindsection ${section.name}\n` : 'bindsection\n';
    out += lines.join('');
  }

  return out;
}

function serializeBind(bind, keys) {
  const neg = bind.negated ? '!' : '';
  const val = bind.value ? ` ${bind.value}` : '';
  return `bind ${neg}${bind.command}${val} ${serializeKeys(keys)}\n`;
}

function serializeBindCommand(bind, keys) {
  return `bind_command ${serializeKeys(keys)} "${bind.command}"\n`;
}

function serializeKeys(keys) {
  return keys.map((k) => `'${k}'`).join(' + ');
}
