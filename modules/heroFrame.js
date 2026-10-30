import { DOM } from './dom.js';

// Рамка портрета героя по победам на нём. Бэкенд отдаёт только wins (победы на герое) и frameType
// (тип надетой рамки из магазина, 0 — не надета): build.heroAll — у каждого героя, данные пати и PHero — у игрока.
// Картинка content/frames/<frameType + ступень - 1>.png, как в лобби (mm.model.js loadFlagAndFrame).
export class HeroFrame {
  // с какого числа побед включается ступень 1..4
  static WINS = [25, 50, 75, 100];

  static tier(wins) {
    const value = Number(wins) || 0;
    return HeroFrame.WINS.filter((need) => value >= need).length;
  }

  static frameId(wins, frameType) {
    const type = Number(frameType) || 0;
    const tier = HeroFrame.tier(wins);
    return type > 0 && tier > 0 ? type + tier - 1 : 0;
  }

  static url(wins, frameType) {
    const id = HeroFrame.frameId(wins, frameType);
    return id > 0 ? `url(content/frames/${id}.png)` : '';
  }

  // data — объект с wins и frameType (герой из heroAll, игрок пати, событие PHero)
  static createNode(data) {
    const node = DOM({ style: 'hero-win-frame' });
    HeroFrame.apply(node, data);
    return node;
  }

  static apply(node, data) {
    if (!node) return;
    const url = HeroFrame.url(data?.wins, data?.frameType);
    node.style.backgroundImage = url || 'none';
    node.style.display = url ? '' : 'none';
  }

  // герой из списка build.heroAll (MM.hero / View.castleHeroAll)
  static fromHeroList(heroes, heroId) {
    const id = Number(heroId) || 0;
    if (!id || !Array.isArray(heroes)) return null;
    return heroes.find((hero) => Number(hero?.id) === id) || null;
  }
}
