import { App } from '../app.js';
import { Lang } from '../lang.js';
import {
  LINKED_GROUPS,
  UI_BINDS,
  cleanKeys,
  comboOf,
  displayKeys,
  findBind,
  findLinkedBinds,
  freePlaceholder,
  uiBindOf,
} from './keybindings.schema.js';
import { findConflicts, keysMayShare } from './keybindings.validator.js';

/**
 * KeybindStore — клавиши из input_new.cfg (модель — строки файла, см. normalizeFileModel).
 * Окна «Клавиши» и «Настройки боя» читают и меняют их здесь и подписываются на изменения.
 */
export const KeybindStore = {
  fileModel: { sections: [] },
  linkedGroups: LINKED_GROUPS,
  source: 'native',
  configPath: null,
  subscribers: [],
  conflictIds: new Set(),

  init(fileModel, source = 'native', configPath = null) {
    this.fileModel = fileModel;
    this.source = source;
    this.configPath = configPath;
    this.ensureVoiceOverlayBind();
    this.notify();
  },

  // Бинд оверлея войса появился позже остальных: в старых input_new.cfg его нет, а без
  // записи в модели клавишу нельзя переназначить. Добавляем пару с клавишей по
  // умолчанию (как в клиенте, VoiceOverlayController.cpp) — файл не трогаем до «Сохранить».
  ensureVoiceOverlayBind() {
    const on = this.getBind('voice_overlay_unlock_on');
    if (on?.keys) return;
    const off = this.getBind('voice_overlay_unlock_off');
    if (on && off) {
      on.keys = ['SHIFT'];
      off.keys = ['SHIFT'];
      return;
    }
    const section = this.fileModel?.sections?.find((s) => s.name === 'adventure_screen');
    if (!section) return;
    section.binds.push(
      { type: 'bind', command: 'voice_overlay_unlock_on', value: null, negated: false, keys: ['SHIFT'] },
      { type: 'bind', command: 'voice_overlay_unlock_off', value: null, negated: true, keys: ['SHIFT'] },
    );
  },

  findLinkedBinds(bind) {
    return findLinkedBinds(this.fileModel, bind, this.linkedGroups).filter((b) => b !== bind);
  },

  getBind(command, value = null) {
    return findBind(this.fileModel, command, value);
  },

  // Клавиши для показа в окне: «не назначено» (пусто или заглушка) — []
  displayKeys(command, value = null) {
    return displayKeys(this.getBind(command, value));
  },

  isConflicted(command, value = null) {
    return this.conflictIds.has(`${command}|${value == null ? '' : Number(value)}`);
  },

  applyKeys(bind, keys) {
    for (const b of findLinkedBinds(this.fileModel, bind, this.linkedGroups)) b.keys = keys ? [...keys] : null;
  },

  /**
   * Назначить клавишу. Пустое или непонятное игре значение — снять клавишу (clearBind).
   * Если эта клавиша уже у другой команды, которая работает одновременно (в бою), с неё
   * клавиша снимается — иначе в игре нажатие сработает за обе. Возвращает снятые (UI_BINDS).
   */
  setBind(command, keys, value = null) {
    const bind = this.getBind(command, value);
    if (!bind) return [];
    const clean = cleanKeys(keys);
    if (!clean) {
      this.clearBind(command, value);
      return [];
    }

    this.applyKeys(bind, clean);

    const cleared = [];
    const ui = uiBindOf(command, value);
    if (ui) {
      for (const other of UI_BINDS) {
        if (other === ui || other.scope !== ui.scope || keysMayShare(ui, other)) continue;
        const otherBind = this.getBind(other.command, other.value);
        if (!otherBind || otherBind === bind) continue;
        if (comboOf(displayKeys(otherBind)) !== comboOf(clean)) continue;
        this.applyKeys(otherBind, freePlaceholder(this.fileModel));
        cleared.push(other);
      }
    }
    if (cleared.length) {
      App.notify?.(
        Lang.text('keybindUnboundFrom')
          .replace('{key}', clean.join(' + '))
          .replace('{list}', cleared.map((u) => Lang.text(u.label)).join(', ')),
      );
    }

    this.notify();
    return cleared;
  },

  // Снять клавишу: у команд окна — заглушка (строка остаётся, см. PLACEHOLDER_KEYS), у прочих — без строки
  clearBind(command, value = null) {
    const bind = this.getBind(command, value);
    if (!bind) return false;
    this.applyKeys(bind, uiBindOf(command, value) ? freePlaceholder(this.fileModel) : null);
    this.notify();
    return true;
  },

  notify() {
    this.conflictIds = new Set();
    for (const conflict of findConflicts(this.fileModel)) {
      for (const e of conflict.entries) this.conflictIds.add(`${e.command}|${e.value == null ? '' : Number(e.value)}`);
    }
    this.subscribers.forEach((fn) => fn(this.fileModel));
  },

  subscribe(fn) {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn);
    };
  },
};
