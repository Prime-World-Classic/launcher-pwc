import { Lang } from './lang.js';
import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { Castle } from './castle.js';
import { Sound } from './sound.js';

export class Settings {
  static defaultSettings = {
    fullscreen: true,
    render: true,
    dayNight: true,
    buildingLights: true,
    /** Отражения в воде замка целиком (SSR-геометрия плюс небо со звёздами). */
    waterReflect: true,
    /** Только SSR (отражение реальной геометрии кадра); выкл — в воде остаётся
     *  процедурное небо и звёзды, как было до SSR. */
    waterSsr: true,
    /** Дождь и снег (CastleWeather): выкл — и слой осадков, и затемнение света под погодой. */
    weather: true,
    /** Панорамный режим замка (CastleCinematic): через 15 с бездействия интерфейс гаснет,
     *  камера облетает замок. Выкл — режим не включается никогда. */
    castlePanorama: true,
    /** Вид списка режимов у «В бой»: false — меню по наведению на круг режима,
     *  true — все режимы видны всегда, по бокам от слотов пати (CastleNAVBAR). */
    castleModesWings: false,
    /** Суточные (ежедневные) квесты принимаются сами при выдаче — таймер идёт сразу
     *  (уходит в quest.list как autoAccept). Выкл — как квесты дольше суток, кнопкой «Начать». */
    questAutoAccept: true,
    /** Рендер-бэкенд игры: 'd3d9' — старый пайплайн (по умолчанию, токена в
     *  протоколе нет), 'vulkan' — в протокол запуска уходит «render=vulkan»
     *  (gameRender.js, pwgame.js). Клиент без поддержки такой токен игнорирует. */
    gameRenderBackend: 'd3d9',
    globalVolume: 0.5,
    musicVolume: 0.5,
    musicMuted: false,
    heroVoicesMuted: false,
    soundsVolume: 0.2,
    voiceVolume: 1.0,
    language: 'ru',
    novoice: false,
    /** «Выключить войс»: никто не может позвонить, сам не звонит, микрофон не открывается. */
    voiceOff: false,
    voiceOverlay: true,
    voiceOverlayPos: null,
    voiceRadioMode: false,
    voiceToggleHotkey: ['CTRL', 'Z'],
    voiceDropHotkey: ['CTRL', 'K'],
    /** Клавиша рации (режим «Рация»). Совпадает с voiceToggleHotkey — рация на ней, как было до
     *  отдельной клавиши; иначе voiceToggleHotkey в рации — мьют, который блокирует рацию. */
    voicePttHotkey: ['CTRL', 'Z'],
    /** Задержка отпускания рации, мс (как в Discord: 0..2000, по умолчанию 20). */
    voicePttReleaseMs: 20,
    /** Микрофон войса: deviceId и имя устройства; '' — устройство записи Windows по умолчанию. */
    voiceMicDevice: '',
    voiceMicLabel: '',
    buildSetLmbMode: 1,
    buildSetSortMode: 0,
    buildRowHoverHighlight: true,
    buildTalentViewLayout: 0,
    buildSetOnlyMatchingStats: false,
    /** 0: выкл; 1: все подходящие по ключам; 2: только фактический вклад. */
    buildStatFilterHighlightMode: 1,
    /** Оттенок рамки подсветки талантов (HSL hue 0–360), ≈ голубой как rgba(80,190,255). */
    buildHighlightHue: 199,
    /** Толщина рамки подсветки (мм), макс. 1.5; по умолчанию как было 0.42cqh. */
    buildHighlightBorderMm: 0.42,
    /** Окно в оконном режиме на момент закрытия: { x, y, width, height, maximized }.
     *  x/y/width/height — обычные (не развёрнутые) границы; null — 1280×720 по центру. */
    windowBounds: null,
  };

  static settings = JSON.parse(JSON.stringify(this.defaultSettings));
  static pwcLauncherSettingsDir;
  static settingsFilePath;

  static async ensureSettingsFile() {
    const homeDir = NativeAPI.os.homedir();
    this.pwcLauncherSettingsDir = NativeAPI.path.join(homeDir, 'Prime World Classic');
    this.settingsFilePath = NativeAPI.path.join(this.pwcLauncherSettingsDir, 'launcher.cfg');

    try {
      await NativeAPI.fileSystem.promises.mkdir(this.pwcLauncherSettingsDir, {
        recursive: true,
      });
      await NativeAPI.fileSystem.promises.access(this.settingsFilePath);
      return true;
    } catch (e) {
      App.error(Lang.text('settingsFileAccessError') + e);
      await this.writeDefaultSettings();
      return false;
    }
  }

  static async writeDefaultSettings() {
    this.settings = JSON.parse(JSON.stringify(this.defaultSettings));
    await this.WriteSettings();
  }

  static async ReadSettings() {
    if (!NativeAPI.status) {
      App.error(Lang.text('settingsNativeApiNotInitialized'));
      this.settings = { ...this.defaultSettings };
      return;
    }

    try {
      if (await this.ensureSettingsFile()) {
        const data = await NativeAPI.fileSystem.promises.readFile(this.settingsFilePath, 'utf-8');
        this.settings = { ...this.defaultSettings, ...JSON.parse(data) };
        // Legacy-настройка из 2.15.x («Приоритет RadminVPN»): radmin-зеркало убрано
        // из pool-протокола, настройка не должна ничего влиять — значение из
        // старого launcher.cfg принудительно выключаем.
        this.settings.radminPriority = false;
      }
    } catch (e) {
      App.error(Lang.text('settingsReadError') + e);
      this.settings = { ...this.defaultSettings };
    }
  }

  static async WriteSettings() {
    if (!this.settingsFilePath || !NativeAPI.status) {
      App.error(Lang.text('settingsSaveError'));
      return;
    }

    try {
      await NativeAPI.fileSystem.promises.writeFile(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (e) {
      App.error(Lang.text('settingsSaveFailed') + e);
    }
  }
  
  static WriteSettingsSync() {
    if (!this.settingsFilePath || !NativeAPI.status) {
      return;
    }
    try {
      NativeAPI.fileSystem.writeFileSync(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch {}
  }
  
  // Инициализация глобальных горячих клавиш
  static initGlobalHotkeys() {
    console.log('Initializing global hotkeys...');

    document.addEventListener('keydown', (e) => {
      // F11 - переключение полноэкранного режима
      if (e.key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleFullscreen();
      }
    });

    console.log('Global hotkeys initialized - F11 for fullscreen toggle');
  }

  // Метод для переключения полноэкранного режима
  static toggleFullscreen() {
    if (!this.settings) {
      console.warn('Settings not initialized');
      return;
    }

    this.settings.fullscreen = !this.settings.fullscreen;
    console.log(`Toggling fullscreen: ${this.settings.fullscreen ? 'ON' : 'OFF'}`);

    // Применяем настройки
    this.ApplySettings({ render: false, audio: false });

    // Синхронизируем UI если открыты настройки
    this.syncFullscreenUI();

    // Показываем уведомление пользователю
    this.showFullscreenNotification();
  }

  // Синхронизация UI чекбокса
  static syncFullscreenUI() {
    const fullscreenToggle = document.getElementById('fullscreen-toggle');
    if (fullscreenToggle) {
      fullscreenToggle.checked = !this.settings.fullscreen;
      console.log('Updated fullscreen toggle UI');
    }
    // галочка «Оконный режим» в окне настроек лаунчера (battleSettings.js, data-setting)
    for (const box of document.querySelectorAll('input[data-setting="fullscreen"]')) {
      if (box.checked === !this.settings.fullscreen) continue;
      box.checked = !this.settings.fullscreen;
      box.dispatchEvent(new Event('change'));
    }
  }

  // Окно может выйти из полного экрана помимо настроек: Chromium в NW 0.103 делает это при
  // удержании Esc ~1,5 с (PressAndHoldEscToExitBrowserFullscreen), и со страницы это не отменить.
  // Тогда настройка оставалась «полный экран», а галочка «Оконный режим» — снятой. Следим за
  // состоянием окна и переводим настройку в оконный режим. Событие restore NW присылает
  // не всегда (проверено), поэтому опрос.
  static FULLSCREEN_GRACE_MS = 1500;
  static fullscreenGraceUntil = 0;
  static windowMinimized = false;
  static fullscreenWatchTimer = null;

  static fullscreenGrace() {
    this.fullscreenGraceUntil = Date.now() + this.FULLSCREEN_GRACE_MS;
  }

  static watchFullscreen() {
    if (this.fullscreenWatchTimer || !NativeAPI.status || !NativeAPI.window) return;
    const win = NativeAPI.window;
    this.fullscreenGrace();
    try {
      win.on('minimize', () => {
        this.windowMinimized = true;
      });
      win.on('restore', () => {
        // и разворот из свёрнутого, и выход из полного экрана; во втором случае опрос
        // увидит оконный режим после паузы
        this.windowMinimized = false;
        this.fullscreenGrace();
      });
    } catch {}
    this.fullscreenWatchTimer = setInterval(() => this.checkFullscreen(), 500);
  }

  static checkFullscreen() {
    if (!this.settings?.fullscreen || this.windowMinimized) return;
    // в бою окно лаунчера спрятано (mm.js gameStartEvent), его состояние не трогаем
    if (document.body?.style.display === 'none') {
      this.fullscreenGrace();
      return;
    }
    if (Date.now() < this.fullscreenGraceUntil) return;
    let isFullscreen = true;
    try {
      isFullscreen = Boolean(NativeAPI.window.isFullscreen);
    } catch {
      return;
    }
    if (isFullscreen) return;
    console.log('Window left fullscreen outside settings: switching to window mode');
    this.settings.fullscreen = false;
    this.syncFullscreenUI();
    this.WriteSettings();
  }

  // Размер и положение окна в оконном режиме. Раньше при каждом запуске (окно стартует в полном
  // экране, NativeAPI.setDefaultWindow) и при выходе из полного экрана ставилось 1280×720 по
  // центру. Теперь границы окна запоминаются в launcher.cfg (windowBounds) и восстанавливаются.
  static WINDOW_MIN_W = 1280;
  static WINDOW_MIN_H = 720;
  static windowMaximized = false;
  static windowBoundsTimer = null;
  static windowBoundsDirty = false;
  static windowCaptureTimer = null;

  static validWindowBounds(b) {
    if (!b || typeof b !== 'object') return null;
    const n = (v) => (Number.isFinite(v) ? Math.round(v) : null);
    const x = n(b.x), y = n(b.y), width = n(b.width), height = n(b.height);
    if (x === null || y === null || width === null || height === null) return null;
    if (width < 200 || height < 200) return null;
    // окно должно заметно попадать на какой-нибудь экран (монитор могли отключить)
    let screens = [];
    try {
      nw.Screen.Init();
      screens = nw.Screen.screens || [];
    } catch {}
    if (screens.length) {
      const visible = screens.some((s) => {
        const a = s.work_area || s.bounds;
        if (!a) return false;
        const w = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
        // по вертикали — верх окна (заголовок) должен быть на экране
        const topVisible = y >= a.y - 8 && y < a.y + a.height - 40;
        return w >= 150 && topVisible;
      });
      if (!visible) return null;
    }
    return { x, y, width: Math.max(width, this.WINDOW_MIN_W), height: Math.max(height, this.WINDOW_MIN_H), maximized: Boolean(b.maximized) };
  }

  static restoreWindowBounds() {
    const win = NativeAPI.window;
    if (!win) return;
    const b = this.validWindowBounds(this.settings.windowBounds);
    const apply = (again) => {
      if (this.settings.fullscreen) return;
      try {
        if (again) {
          // повтор нужен, только если Chromium перебил наши границы
          if (b?.maximized && this.windowMaximized) return;
          const want = b || { width: this.WINDOW_MIN_W, height: this.WINDOW_MIN_H };
          if (win.width === want.width && win.height === want.height && (!b || (win.x === b.x && win.y === b.y))) return;
        }
        if (b) {
          win.resizeTo(b.width, b.height);
          win.moveTo(b.x, b.y);
          if (b.maximized) win.maximize();
        } else {
          win.resizeTo(this.WINDOW_MIN_W, this.WINDOW_MIN_H);
          win.setPosition('center');
        }
      } catch {}
    };
    apply(false);
    // выход из полного экрана в Chromium завершается не сразу и может вернуть окну прежние
    // границы поверх наших — повторяем после того, как переход закончится
    setTimeout(() => apply(true), 400);
  }

  static isWindowedNormal() {
    const win = NativeAPI.window;
    if (!win || this.settings?.fullscreen || this.windowMinimized) return false;
    if (document.body?.style.display === 'none') return false;
    // во время смены режима окно проходит через промежуточные размеры
    if (Date.now() < this.fullscreenGraceUntil) return false;
    try {
      if (win.isFullscreen) return false;
    } catch {
      return false;
    }
    return true;
  }

  static captureWindowBounds() {
    const graceLeft = this.fullscreenGraceUntil - Date.now();
    if (graceLeft > 0) {
      // restore (в т. ч. из развёрнутого) включает паузу — дописать после неё
      clearTimeout(this.windowCaptureTimer);
      this.windowCaptureTimer = setTimeout(() => this.captureWindowBounds(), graceLeft + 50);
      return;
    }
    if (!this.isWindowedNormal()) return;
    const win = NativeAPI.window;
    const prev = this.settings.windowBounds || {};
    const next = { ...prev, maximized: this.windowMaximized };
    // у развёрнутого окна храним обычные границы, к которым оно вернётся
    if (!this.windowMaximized) {
      next.x = win.x;
      next.y = win.y;
      next.width = win.width;
      next.height = win.height;
    }
    if (!Number.isFinite(next.x) || !Number.isFinite(next.width)) return;
    if (['x', 'y', 'width', 'height', 'maximized'].every((k) => prev[k] === next[k])) return;
    this.settings.windowBounds = next;
    this.windowBoundsDirty = true;
    clearTimeout(this.windowBoundsTimer);
    this.windowBoundsTimer = setTimeout(() => {
      this.windowBoundsDirty = false;
      this.WriteSettings();
    }, 1000);
  }

  // при закрытии лаунчера (NativeAPI.exit): дописать границы, не дожидаясь таймера
  static flushWindowBounds() {
    if (!this.windowBoundsDirty) return;
    clearTimeout(this.windowBoundsTimer);
    this.windowBoundsDirty = false;
    this.WriteSettingsSync();
  }

  static watchWindowBounds() {
    const win = NativeAPI.window;
    if (!NativeAPI.status || !win) return;
    const later = () => setTimeout(() => this.captureWindowBounds(), 50);
    try {
      win.on('move', later);
      win.on('resize', later);
      win.on('maximize', () => {
        this.windowMaximized = true;
        later();
      });
      win.on('restore', () => {
        // restore — и из развёрнутого, и из свёрнутого, и выход из полного экрана
        if (!this.windowMinimized) this.windowMaximized = false;
        later();
      });
    } catch {}
  }

  // Показать уведомление о переключении режима
  static showFullscreenNotification() {
    if (typeof App !== 'undefined' && App.notify) {
      const message = this.settings.fullscreen
        ? Lang.text('fullscreenEnabled') || 'Fullscreen enabled'
        : Lang.text('fullscreenDisabled') || 'Window mode enabled';
      App.notify(message);
    }
  }

  static async ApplySettings(options = {}) {
    // Установка значений по умолчанию для options
    options = {
      render: true, // Применять настройки рендеринга по умолчанию
      audio: true, // Применять настройки звука по умолчанию
      window: true, // Применять настройки окна по умолчанию
      ...options, // Переопределение дефолтных значений
    };

    try {
      // 1. Применение настроек рендеринга (если не отключено в options)
      if (options.render !== false && typeof Castle !== 'undefined') {
        Castle.toggleRender(Castle.RENDER_LAYER_PLAYER, this.settings.render);
      }

      // 2. Применение настроек окна (если не отключено в options)
      if (options.window !== false && NativeAPI.status && NativeAPI.window) {
        const currentMode = await NativeAPI.window.isFullscreen;
        // смена режима идёт не мгновенно — watchFullscreen не должен принять её за выход по Esc
        if (Boolean(this.settings.fullscreen) !== Boolean(currentMode)) this.fullscreenGrace();
        if (this.settings.fullscreen && !currentMode) {
          await NativeAPI.window.enterFullscreen();
        } else if (!this.settings.fullscreen && currentMode) {
          await NativeAPI.window.leaveFullscreen();
          this.restoreWindowBounds();
        }
      }

      // 3. Применение настроек звука (если не отключено в options)
      if (options.audio !== false && typeof Sound !== 'undefined') {
        // Обновляем громкость для всех звуков
        for (const soundId in Sound.all) {
          const type = ['castle', 'tambur'].includes(soundId)
            ? Castle.AUDIO_MUSIC
            : soundId.startsWith('heroSound_') ? Castle.AUDIO_HERO_VOICES : Castle.AUDIO_SOUNDS;
          Sound.setVolume(soundId, Castle.GetVolume(type));
        }

        // Специальная обработка тестового звука (если используется)
        if (Castle.testSoundIsPlaying && Sound.all.sound_test) {
          Sound.setVolume('sound_test', Castle.GetVolume(Castle.AUDIO_SOUNDS));
        }
      }
      // 4. Применение настроек языка (если не отключено в options)
      if (options.language !== false && typeof Lang !== 'undefined') {
        // Обновляем текущий язык
        if (this.settings.language && this.settings.language in Lang.list) {
          Lang.target = this.settings.language;
        }
      }
    } catch (e) {
      App.error(Lang.text('settingsApplyError') + e);
    }
  }

  static async init() {
    await this.ReadSettings();
    NativeAPI.refreshVoiceHotkeys?.();
    await this.ApplySettings();

    // Инициализируем глобальные горячие клавиши
    this.initGlobalHotkeys();

    // до watchFullscreen: его обработчик restore сбрасывает windowMinimized, а watchWindowBounds
    // по этому флагу отличает разворот из свёрнутого от выхода из развёрнутого
    this.watchWindowBounds();
    this.watchFullscreen();

    window.addEventListener('beforeunload', () => {
      this.WriteSettings();
    });
  }
}
