import { App } from '../app.js';
import { Lang } from '../lang.js';
import { DOM } from '../dom.js';
import { createEmptyFileModel, normalizeFileModel, repairFileModel } from './keybindings.schema.js';
import { KeybindStore } from './keybindings.store.js';
import { parseKeybindCfg } from './keybindings.parser.js';
import { serializeCfg } from './keybindings.serializer.js';
import { NativeAPI } from '../nativeApi.js';
import { BindParseError } from './keybindings.validator.js';

async function createDefaultConfigFile(targetPath) {
  if (!NativeAPI.status) return false;

  const targetDir = NativeAPI.path.dirname(targetPath);

  try {
    console.log('Creating default config file at', targetPath);

    await NativeAPI.fileSystem.promises.mkdir(targetDir, {
      recursive: true,
    });

    const r = await fetch('/content/keybindsFallback.cfg', {
      cache: 'no-store',
    });

    if (!r.ok) {
      console.error('Failed to fetch fallback config');
      return false;
    }

    const data = await r.text();

    await NativeAPI.fileSystem.promises.writeFile(targetPath, data, {
      encoding: 'utf8',
      flag: 'wx',
    });

    console.log('Default config file created at', targetPath);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') {
      return true;
    }

    console.error('Failed to create default config file:', e);
    return false;
  }
}

export async function findConfigFile() {
  const documentsPath = NativeAPI.getDocumentsDir();
  if (documentsPath) {
    console.log('Searching for native config file...');
    const configPath = NativeAPI.path.join(documentsPath, 'My Games', 'Prime World Classic', 'input_new.cfg');
	const backupPath = NativeAPI.path.join(documentsPath, 'My Games', 'Prime World Classic', 'input_new_backup.cfg');

    try {
      await NativeAPI.fileSystem.promises.access(configPath);
      console.log('Found native config file at', configPath);
      try {
        await NativeAPI.fileSystem.promises.access(backupPath);
        console.log('Backup already exists at', backupPath);
      } catch (backupErr) {
        if (backupErr.code === 'ENOENT') {
          console.log('Creating backup at', backupPath);
          await NativeAPI.fileSystem.promises.copyFile(configPath, backupPath);
          console.log('Backup created successfully');
        }
      }	  
      return { type: 'native', path: configPath };
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log('Native config file not found at', configPath);
        const created = await createDefaultConfigFile(configPath);
        if (created) {
          return { type: 'native', path: configPath };
        }
      }
      console.error('Failed to access native config file:', e);
    }
  }
  console.log('Searching for browser config file...');
  try {
    const r = await fetch('/content/keybindsFallback.cfg', { cache: 'no-store' });
    if (r.ok) {
      return { type: 'browser', path: '/content/keybindsFallback.cfg' };
    }
  } catch (e) {
    console.error('Failed to fetch browser config file:', e);
  }

  return null;
}

function modelFromText(text) {
  const model = normalizeFileModel(createEmptyFileModel(), parseKeybindCfg(text));
  const fixes = repairFileModel(model);
  return { model, fixes };
}

/**
 * Чинит input_new.cfg игрока (repairFileModel): пустые и неизвестные игре клавиши, из-за
 * которых команда «зажата» (камера уезжает сама), старые имена лаунчера, нет строк слотов.
 * Пишет файл, только если было что чинить.
 */
export async function repairNativeCfg(cfgOverride = null) {
  if (!NativeAPI.status) return { changed: false };

  const cfg = cfgOverride || (await findConfigFile());
  if (!cfg || cfg.type !== 'native' || !cfg.path) return { changed: false };

  let data = '';
  try {
    data = await NativeAPI.fileSystem.promises.readFile(cfg.path, 'utf8');
  } catch {
    return { changed: false };
  }

  const { model, fixes } = modelFromText(data);
  if (!fixes.length) return { changed: false };

  await NativeAPI.fileSystem.promises.writeFile(cfg.path, serializeCfg(model), 'utf8');
  console.log('input_new.cfg repaired:', fixes);
  return { changed: true, configPath: cfg.path, fixes };
}

// прежнее имя (view.js)
export const ensureActionBarSlotsInNativeCfg = repairNativeCfg;

export async function loadKeybindsNative(cfg) {
  const data = await NativeAPI.fileSystem.promises.readFile(cfg.path, 'utf8');
  const { model, fixes } = modelFromText(data);
  if (fixes.length) {
    await NativeAPI.fileSystem.promises.writeFile(cfg.path, serializeCfg(model), 'utf8');
    console.log('input_new.cfg repaired:', fixes);
  }

  KeybindStore.init(model, cfg.type, cfg.path);
}

export async function loadKeybindsBrowser(cfg) {
  const data = await fetch(cfg.path).then((r) => r.text());
  KeybindStore.init(modelFromText(data).model, cfg.type, cfg.path);
}

export async function loadKeybinds() {
  const cfg = await findConfigFile();
  if (!cfg) return false;

  try {
    if (cfg.type === 'native') {
      await loadKeybindsNative(cfg);
    } else {
      await loadKeybindsBrowser(cfg);
    }
  } catch (err) {
    if (cfg.type === 'native' && err instanceof BindParseError) {
      console.error(err);
      console.warn('Invalid keybinds, restoring default...');

      // delete config
      await NativeAPI.fileSystem.promises.unlink(cfg.path);

      const restored = await createDefaultConfigFile(cfg.path);
      if (!restored) {
        return false;
      }

      try {
        await loadKeybindsNative(cfg);
        App.notify(Lang.text('restoredDefaultKeybindings'));
        return true;
      } catch (e) {
        App.error(Lang.text('errorKeybindingsLoad'));
        return false;
      }
    }
    App.error(Lang.text('errorKeybindingsLoad'));
    return false;
  }

  console.log('Keybinds loaded from', cfg.type, cfg.path);
  return true;
}

export async function saveKeybinds() {
  try {
    const data = serializeCfg(KeybindStore.fileModel);
    console.log('Saving keybinds to', KeybindStore.source, KeybindStore.configPath);
    console.log(data);
    if (KeybindStore.source === 'native') {
      await NativeAPI.fileSystem.promises.writeFile(KeybindStore.configPath, data, 'utf8');
    } else {
      const blob = new Blob([data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = DOM({
        tag: 'a',
        href: url,
        download: 'input_new.cfg',
        event: [
          'click',
          () => {
            a.remove();
            URL.revokeObjectURL(url);
          },
        ],
      });
      document.body.appendChild(a);
      a.click();
    }

    App.notify(Lang.text('savedKeybindings'));
    return true;
  } catch (err) {
    console.error('Failed to save keybinds:', err);
    App.error(Lang.text('errorKeybindings'));
    return false;
  }
}
