// Зима в замке: зимние текстуры (снег на земле, крышах, деревьях) у замков Адорнии и Доктов.
//
// Включает её админ для всех — флаг castle_settings.winter в pw-api (админ-панель лаунчера → «Замок»,
// Window.adminCastle → build.castleWinter). Бэкенд шлёт его при подключении (пуш CastleWinter) и тем же
// пушем всем онлайн, когда админ его меняет. Игрок может выключить зиму у себя — галочка
// «Зима в замке» (Settings.settings.castleWinter, по умолчанию вкл).
//
// Текстуры — пары <имя>.webp (обычная) и <имя>_winter.webp (зимняя, korobkad3v, 2025-12);
// в scenes.json всегда обычные имена, зимой при загрузке берётся файл _winter. Смена на лету
// (флаг пришёл, галочку переключили) перегружает только эти текстуры текущей сцены.
//
// Стенд: ?previewCastle=1&previewWinter=1 (или =0) — без бэкенда.
import { Settings } from './settings.js';
import { PreloadImages } from './preloadImages.js';

export class CastleWinter {
  // имена текстур (как в scenes.json), у которых есть файл <имя>_winter.webp
  static TEXTURES = new Set([
    // Адорния
    'building01_02',
    'building01_03',
    'building02',
    'bushes',
    'terrain_02',
    'terrain_03',
    'terrain_04',
    'terrain_05',
    'trees',
    'water',
    'water02',
    'water03',
    'build/a598440',
    'build/a650384',
    // Докты
    'doct3697',
    'doct3702',
    'doct3756',
    'doct4050',
    'doct4179',
    'doct4238',
    'build/d334960',
    'build/d65387',
  ]);

  // флаг админа (пуш CastleWinter); до первого пуша — выкл
  static server = false;

  // стенд ?previewWinter: true/false поверх флага админа
  static override = null;

  static reloading = false;

  static active() {
    const on = CastleWinter.override ?? CastleWinter.server;
    return on && Settings.settings.castleWinter !== false;
  }

  // файл текстуры с учётом зимы
  static file(name, winter = CastleWinter.active()) {
    return winter && CastleWinter.TEXTURES.has(name) ? `${name}_winter` : name;
  }

  static url(name, winter) {
    return `content/textures/${CastleWinter.file(name, winter)}.webp`;
  }

  static setServer(on) {
    CastleWinter.server = Boolean(on);
    CastleWinter.sync();
  }

  // Привести текстуры текущей сцены к нужному виду (после пуша, галочки или стенда).
  // Castle подтягивается лениво: castle.js сам импортирует этот модуль.
  static async sync() {
    const { Castle } = await import('./castle.js');
    if (!Castle.gl || !Castle.sceneTextureNames || Castle.sceneLoading || CastleWinter.reloading) return;
    const want = CastleWinter.active();
    if (Castle.sceneWinter === want) return;
    CastleWinter.reloading = true;
    try {
      const names = Castle.sceneTextureNames;
      const textures = Castle.sceneTextures;
      const gl = Castle.gl;
      await Promise.all(
        names.map(async (name, i) => {
          if (!CastleWinter.TEXTURES.has(name)) return;
          let image = await PreloadImages.loadAsync(CastleWinter.url(name, want));
          try {
            image = await createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
          } catch (e) {}
          // за время загрузки могли сменить фракцию — тогда текстуры уже чужие
          if (Castle.sceneTextures !== textures) return;
          const texture = Castle.loadTexture(image, gl.REPEAT);
          image.close?.();
          if (textures[i]) gl.deleteTexture(textures[i]);
          textures[i] = texture;
        }),
      );
      if (Castle.sceneTextures === textures) Castle.sceneWinter = want;
    } finally {
      CastleWinter.reloading = false;
    }
    // пока грузили, могли переключить ещё раз
    if (Castle.sceneTextures && Castle.sceneWinter !== CastleWinter.active()) CastleWinter.sync();
  }
}
