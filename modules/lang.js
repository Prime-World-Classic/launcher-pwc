import { App } from './app.js';
import { Chat } from './chat.js';
import { NativeAPI } from './nativeApi.js';
import { Settings } from './settings.js';
import { MM } from './mm.js';

export class Lang {
  static target = 'ru';
  static default = 'ru';
  static list = {};
  static cache = new Map();

  static async init() {
    try {
      console.log('Loading languages...');

      // Абсолютные пути
      const { ru } = await import('/content/lang/ru.js');
      const { en } = await import('/content/lang/en.js');
      //const { be } = await import('/content/lang/be.js');

      Lang.list = { ru, en /*, be*/ };
      console.log('Languages loaded successfully:', Object.keys(Lang.list));
    } catch (error) {
      console.error('Error loading language files:', error);
      throw new Error('Failed to load language files: ' + error.message);
    }

    // Загрузка языка из настроек
    if (typeof Settings !== 'undefined' && Settings.settings && Settings.settings.language) {
      if (Settings.settings.language in Lang.list) {
        Lang.target = Settings.settings.language;
        console.log('Language from settings:', Lang.target);
        Lang.clearCache(); // Очистка кеша при смене языка
        Lang.applyCssTexts();
        return;
      }
    }

    // Автоопределение языка по локали
    let locale = NativeAPI.getLocale();
    if (!locale && 'language' in navigator) {
      locale = navigator.language;
    }

    for (let key in Lang.list) {
      // Предполагаем, что .locale это массив
      if (Lang.list[key].locale.includes(locale)) {
        Lang.target = key;
        console.log('Language detected from locale:', locale, '->', Lang.target);
        break;
      }
    }

    console.log('Final language:', Lang.target);
    Lang.clearCache(); // Очистка кеша после инициализации
    Lang.applyCssTexts();
  }

  static clearCache() {
    Lang.cache.clear();
  }

  static text(word) {
    // Проверяем кеш
    const cacheKey = `${Lang.target}:${word}`;
    if (Lang.cache.has(cacheKey)) {
      return Lang.cache.get(cacheKey);
    }

    // Получаем перевод
    const targetWords = Lang.list[Lang.target]?.word;
    const defaultWords = Lang.list[Lang.default]?.word;

    let translation;
    if (targetWords && targetWords.hasOwnProperty(word)) {
      translation = targetWords[word];
    } else if (defaultWords && defaultWords.hasOwnProperty(word)) {
      translation = defaultWords[word];
    } else {
      console.warn('Translation not found:', word);
      translation = word;
    }

    // Сохраняем в кеш
    Lang.cache.set(cacheKey, translation);
    return translation;
  }

  static getTranslationMap(wordKeys) {
    const targetWords = Lang.list[Lang.target]?.word || {};
    const defaultWords = Lang.list[Lang.default]?.word || {};
    const translationMap = new Map();

    for (const key of wordKeys) {
      translationMap.set(key, Lang.text(key));
    }

    return translationMap;
  }

  static toggle() {
    const languages = Object.keys(Lang.list);
    const currentIndex = languages.indexOf(Lang.target);
    const nextIndex = (currentIndex + 1) % languages.length;
    Lang.target = languages[nextIndex];
    Lang.clearCache();
    return Lang.target;
  }

  static getNextLanguage() {
    const languages = Object.keys(Lang.list);
    const currentIndex = languages.indexOf(Lang.target);
    const nextIndex = (currentIndex + 1) % languages.length;
    return languages[nextIndex];
  }

  static heroName(heroId, skinIndex = 1) {
    if (skinIndex > 1) {
      const skinKey = `hero_${heroId}_skin_${skinIndex}_name`;
      const skinName = this.text(skinKey);

      if (skinName !== skinKey) {
        return skinName;
      }
    }

    // Возвращаем основное имя героя (скин 1)
    return this.text(`hero_${heroId}_name`);
  }

  // Тексты, которые CSS берёт из переменных (content: var(...))
  static applyCssTexts() {
    document.documentElement.style.setProperty('--mm-queue-label', JSON.stringify(`${Lang.text('mmQueueLabel')} `));
  }

  static async reinitViews() {
    Lang.applyCssTexts();
    App.resetLocalizedQuickTabs();
    Chat.initView();
    MM.initView();
    await App.ShowCurrentViewAsync();
  }
}
