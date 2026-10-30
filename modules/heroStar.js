// Избранные герои: кнопка «В избранные» в окне билда (build/heroPanel.js).
// Избранные идут первыми в списках героев (низ замка, выбор героя в пати и тамбуре),
// перед именем — золотая звёздочка. Признак star (0/1) приходит в build.heroAll,
// переключается build.heroStar { id, value }; бэкенд и сам ставит избранных первыми.

import { App } from './app.js';
import { DOM } from './dom.js';
import { MM } from './mm.js';
import { View } from './view.js';

export class HeroStar {
  static isStarred(item) {
    return Number(item?.star) === 1;
  }

  static has(heroId) {
    const id = Number(heroId);
    return HeroStar.lists().some((list) => list.some((item) => Number(item?.id) === id && HeroStar.isStarred(item)));
  }

  // Избранные — первыми; внутри групп порядок прежний (по рейтингу)
  static sort(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item, index) => ({ item, index }))
      .sort((a, b) => Number(HeroStar.isStarred(b.item)) - Number(HeroStar.isStarred(a.item)) || a.index - b.index)
      .map((entry) => entry.item);
  }

  // Звёздочка перед именем героя; filled = false — контур (кнопка «В избранные»)
  static icon(filled = true) {
    return DOM({ tag: 'span', style: filled ? 'hero-star' : ['hero-star', 'hero-star--empty'], ariaHidden: 'true' });
  }

  // Все загруженные списки героев (это могут быть одни и те же массивы)
  static lists() {
    const lists = [MM.hero, View.castleHeroAll, View.partyHeroesCache?.list].filter(Array.isArray);
    return [...new Set(lists)];
  }

  // Добавить героя в избранные / убрать; preview — без запроса (DEV-превью)
  static async set(heroId, value, { preview = false } = {}) {
    const id = Number(heroId);
    const star = value ? 1 : 0;
    if (!preview) await App.api.request('build', 'heroStar', { id, value: star });
    for (const list of HeroStar.lists()) {
      for (const item of list) if (Number(item?.id) === id) item.star = star;
      // снятая звёздочка — герой возвращается на место по рейтингу
      const sorted = HeroStar.sort([...list].sort((a, b) => Number(b?.rating || 0) - Number(a?.rating || 0)));
      list.splice(0, list.length, ...sorted);
    }
    if (View.castleActiveTab === 'heroes') View.renderCastleHeroesFromCache({ refreshToolbar: false });
    return star;
  }
}
