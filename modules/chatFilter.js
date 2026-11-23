// Мат-фильтр чата замка: тот же фильтр, что у ников в pw-api (nicknameFilter.js — его копия),
// но по словам сообщения. Плохое слово закрывается звёздочками той же длины; исходный текст
// не меняется (копирование, правка, ответ — по нему), закрывается только показ.
//
// Вкл/выкл — игровая настройка «Использовать мат-фильтр» (user.cfg: setvar use_badwords_filter,
// по умолчанию 1): одна галочка в «Настройках боя», в «Настройках замка» и в самой игре.
// Значение берётся из user.cfg при старте чата, после копии настроек с сервера, после выхода из игры
// и при любой записи/чтении user.cfg лончером (UserCfg в battleSettings.js). При смене уже показанные
// сообщения меняются на месте (apply), без перезахода.
//
// Что ищется:
//   * каждое слово — всеми обходами фильтра ников (цифры, похожая латиница, транслит, раскладка, повтор букв);
//   * подряд идущие короткие слова (до 2 знаков) склеиваются: «п и з д а», «х.у.й», «б-л-я»;
//   * фразы из 2–4 слов: «третий рейх», «white power».
// «член» в чате не закрывается: «член клана», «член команды» — обычные слова.
import { NativeAPI } from './nativeApi.js';
import { NicknameFilter, CYR, LAT, PHRASES, SAFE_CYR, SAFE_LAT } from './nicknameFilter.js';

const CHAT_CYR = CYR.filter((pattern) => pattern.word !== 'член');

// Слово — буквы и цифры подряд; разрыв между склеиваемыми короткими словами — до 3 знаков без перевода строки.
const WORD_RE = /[\p{L}\p{N}]+/gu;
// До 2 знаков: со словами из 3 букв склейка даёт обычные фразы («с оси» → «соси»).
const SHORT = 2;
const MAX_GAP = 3;
const MAX_GLUE = 8;
const MAX_PHRASE = 4;

const DIGITS_1488 = /(?<!\d)(\d*1488|8814)(?!\d)/;

export class ChatFilter {
  static VARIABLE = 'use_badwords_filter';

  // как def у строки «Использовать мат-фильтр» в «Настройках боя»: включён, пока игрок не выключил
  static enabled = true;

  static listeners = new Set();

  static cache = new Map();

  static CACHE_MAX = 5000;

  // Текст узлов, закрытых фильтром: узел → исходный текст (для apply при смене настройки).
  static raw = new WeakMap();

  // ---------------------------------------------------------------- настройка

  static onChange(listener) {
    ChatFilter.listeners.add(listener);
    return () => ChatFilter.listeners.delete(listener);
  }

  static setEnabled(on) {
    const value = Boolean(on);
    if (value === ChatFilter.enabled) return;
    ChatFilter.enabled = value;
    for (const listener of ChatFilter.listeners) {
      try {
        listener(value);
      } catch (e) {
        console.error('chatFilter listener', e);
      }
    }
  }

  // Значение из строк user.cfg (как их читает UserCfg); нет строки — по умолчанию включён.
  static fromCfgText(text) {
    const m = new RegExp(`^\\s*setvar\\s+${ChatFilter.VARIABLE}\\s*=\\s*(.*?)\\s*$`, 'm').exec(String(text || ''));
    if (!m) return true;
    const v = parseFloat(m[1]);
    return !Number.isFinite(v) || v !== 0;
  }

  // Перечитать user.cfg из папки игры. Нет лончера NW или файла — значение по умолчанию.
  static async refresh() {
    if (!NativeAPI.status) return ChatFilter.enabled;
    try {
      const folder = NativeAPI.getGameUserDir();
      if (!folder) return ChatFilter.enabled;
      let text = '';
      try {
        text = await NativeAPI.fileSystem.promises.readFile(NativeAPI.path.join(folder, 'user.cfg'), 'utf8');
      } catch {
        text = '';
      }
      ChatFilter.setEnabled(ChatFilter.fromCfgText(text));
    } catch (e) {
      console.error('chatFilter refresh', e);
    }
    return ChatFilter.enabled;
  }

  // ---------------------------------------------------------------- поиск

  // Одно слово (как ник, но без «член» и без 14…88 через буквы).
  static badWord(word) {
    const cached = ChatFilter.cache.get(word);
    if (cached !== undefined) return cached;
    let bad = false;
    if (word.length > 1 && !/^\d{1,3}$/.test(word)) {
      const forms = NicknameFilter.forms(word);
      bad =
        DIGITS_1488.test(forms.raw) ||
        forms.cyr.some((form) => NicknameFilter.scan(form, CHAT_CYR, SAFE_CYR)) ||
        forms.lat.some((form) => NicknameFilter.scan(form, LAT, SAFE_LAT));
    }
    if (ChatFilter.cache.size >= ChatFilter.CACHE_MAX) ChatFilter.cache.clear();
    ChatFilter.cache.set(word, bad);
    return bad;
  }

  static badPhrase(words) {
    const joined = words.join('').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я]/g, '');
    return PHRASES.some((phrase) => phrase.re.test(joined));
  }

  // Диапазоны [start, end) плохих слов в тексте.
  static findRanges(text) {
    const source = String(text ?? '');
    const words = [...source.matchAll(WORD_RE)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
    const bad = words.map((w) => ChatFilter.badWord(w.text));

    // Подряд идущие короткие слова с коротким разрывом склеиваются; уже закрытое слово цепочку рвёт.
    const linked = (i) => {
      const gap = source.slice(words[i - 1].end, words[i].start);
      return gap.length <= MAX_GAP && !gap.includes('\n');
    };
    for (let i = 0; i < words.length; ) {
      if (bad[i] || words[i].text.length > SHORT) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < words.length && !bad[j + 1] && words[j + 1].text.length <= SHORT && linked(j + 1)) j++;
      for (let s = i; s < j; s++) {
        for (let e = s + 1; e <= Math.min(j, s + MAX_GLUE - 1); e++) {
          if (!ChatFilter.badWord(words.slice(s, e + 1).map((w) => w.text).join(''))) continue;
          // «это пи зда»: слева лишние слова не закрываем
          let from = s;
          while (from + 1 < e && ChatFilter.badWord(words.slice(from + 1, e + 1).map((w) => w.text).join(''))) from++;
          // «п и з д а»: корень «пизд» найден, хвост из одиночных букв — тоже часть слова
          while (e + 1 <= j && words[e + 1].text.length === 1) e++;
          for (let k = from; k <= e; k++) bad[k] = true;
          s = e;
          break;
        }
      }
      i = j + 1;
    }

    // Фразы: окна из 2–4 слов, лишние по краям не закрываем.
    for (let s = 0; s < words.length; s++) {
      for (let n = 2; n <= MAX_PHRASE && s + n <= words.length; n++) {
        const window = words.slice(s, s + n).map((w) => w.text);
        if (!ChatFilter.badPhrase(window)) continue;
        let from = s;
        let to = s + n - 1;
        while (to - from > 1 && ChatFilter.badPhrase(words.slice(from + 1, to + 1).map((w) => w.text))) from++;
        while (to - from > 1 && ChatFilter.badPhrase(words.slice(from, to).map((w) => w.text))) to--;
        for (let k = from; k <= to; k++) bad[k] = true;
        break;
      }
    }

    return words.filter((_, i) => bad[i]).map((w) => [w.start, w.end]);
  }

  // Текст для показа: плохие слова — звёздочками той же длины (по символам, не по UTF-16).
  static mask(text) {
    const source = String(text ?? '');
    const ranges = ChatFilter.findRanges(source);
    if (!ranges.length) return source;
    let out = '';
    let at = 0;
    for (const [start, end] of ranges) {
      out += source.slice(at, start) + '*'.repeat([...source.slice(start, end)].length);
      at = end;
    }
    return out + source.slice(at);
  }

  static display(text) {
    return ChatFilter.enabled ? ChatFilter.mask(text) : String(text ?? '');
  }

  // ---------------------------------------------------------------- DOM

  // Текст сообщения для ленты: span, который apply перерисует при смене настройки.
  static node(text, tag = 'span') {
    const element = document.createElement(tag);
    element.className = 'chat-filtered';
    ChatFilter.raw.set(element, String(text ?? ''));
    element.textContent = ChatFilter.display(text);
    return element;
  }

  // Заново показать все тексты под root по текущей настройке.
  static apply(root) {
    if (!root?.querySelectorAll) return;
    for (const element of root.querySelectorAll('.chat-filtered')) {
      if (!ChatFilter.raw.has(element)) continue;
      element.textContent = ChatFilter.display(ChatFilter.raw.get(element));
    }
  }
}
