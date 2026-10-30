import { App } from './app.js';
import { Lang } from './lang.js';
import { Window } from './window.js';
import { CastleFarm } from './castleFarm.js';

export class CastleBuildingsEvents {
  // ресурсные здания фермы: окно здания (уровень, улучшение, сбор)
  static light_farm() {
    CastleFarm.openInfo('light_farm');
  }
  static heavy_farm() {
    CastleFarm.openInfo('heavy_farm');
  }
  static food_farm() {
    CastleFarm.openInfo('food_farm');
  }
  // склад ресурсов: лимит и его улучшение
  static storage() {
    CastleFarm.openInfo('storage');
  }
  static library() {
    Window.show('main', 'inventory');
  }
  static talent_farm() {
    Window.show('main', 'farm');
  }
  static fair() {
    Window.show('main', 'shop');
  }
  // «Мастерская свитков»: мини-игра Easel (модуль грузится по требованию)
  static easel() {
    return App.openEasel();
  }
}
