import { Lang } from './lang.js';
import { DOM } from './dom.js';

export class Rank {

  static RATE_ICON_BACK = 'url(content/ranks/rateIconBack.png)';
  static RANK_ICON_PATH = (id) => `url(content/ranks/${id}.webp)`;

  /** Создаёт DOM-блок ранга: .rank > .rank-lvl + .rank-icon-wrapper > .rank-icon (или с stylePrefix, например castle-hero-). */
  static createRankNode(rating, options = {}) {
    const prefix = options.stylePrefix || '';
    const withIcon = options.withIcon !== false;

    const lvl = DOM({ style: `${prefix}rank-lvl` }, rating);

    if (!withIcon) {
      return DOM({ style: `${prefix}rank` }, lvl);
    }

    const icon = DOM({ style: `${prefix}rank-icon` });
    icon.style.backgroundImage = Rank.RANK_ICON_PATH(Rank.icon(rating));

    const wrapper = DOM({ style: `${prefix}rank-icon-wrapper` }, icon);
    wrapper.style.backgroundImage = Rank.RATE_ICON_BACK;
    wrapper.style.backgroundSize = 'contain';
    wrapper.style.backgroundPosition = 'center center';
    wrapper.style.backgroundRepeat = 'no-repeat';

    return DOM({ style: `${prefix}rank` }, lvl, wrapper);
  }

  /** Обновляет существующий контейнер .rank: текст рейтинга, сброс фона у .rank-lvl, иконка по рейтингу. */
  static updateRankContainer(rankContainer, rating) {
    if (!rankContainer) return;

    const lvl = rankContainer.querySelector('.rank-lvl');
    const wrapper = rankContainer.querySelector('.rank-icon-wrapper');
    const icon = wrapper ? wrapper.querySelector('.rank-icon') : rankContainer.querySelector('.rank-icon');

    if (lvl) {
      lvl.innerText = rating;
      lvl.style.backgroundImage = '';
      lvl.style.removeProperty('background-image');
    }

    if (wrapper) {
      wrapper.style.backgroundImage = Rank.RATE_ICON_BACK;
      wrapper.style.backgroundSize = 'contain';
      wrapper.style.backgroundPosition = 'center center';
      wrapper.style.backgroundRepeat = 'no-repeat';
    }

    if (icon) {
      icon.style.backgroundImage = Rank.RANK_ICON_PATH(Rank.icon(rating));
    }
  }

  /** Ставит иконку "готов" (99.png) в блок ранга. */
  static setRankReady(rankContainer) {
    if (!rankContainer) return;

    const wrapper = rankContainer.querySelector('.rank-icon-wrapper');
    const icon = wrapper ? wrapper.querySelector('.rank-icon') : rankContainer.querySelector('.rank-icon');
    if (icon) {
      icon.style.backgroundImage = 'url(content/ranks/99.png)';
    }
  }

  static _names = null;

  static get name() {
    if (!Rank._names) {
      Rank._names = [
        '',
        Lang.text('rankRecruit'),
        Lang.text('rankMercenary'),
        Lang.text('rankPrivate'),
        Lang.text('rankCorporal'),
        Lang.text('rankSergeant'),
        Lang.text('rankLieutenant'),
        Lang.text('rankCaptain'),
        Lang.text('rankMajor'),
        Lang.text('rankLieutenantColonel'),
        Lang.text('rankColonel'),
        Lang.text('rankGeneral'),
        Lang.text('rankMarshal'),
        Lang.text('rankGod'),
      ];
    }

    return Rank._names;
  }

  static icon(rating) {
    if (rating <= 1199) {
      return 1;
    } else if (rating <= 1299) {
      return 2;
    } else if (rating <= 1399) {
      return 3;
    } else if (rating <= 1499) {
      return 4;
    } else if (rating <= 1599) {
      return 5;
    } else if (rating <= 1699) {
      return 6;
    } else if (rating <= 1799) {
      return 7;
    } else if (rating <= 1899) {
      return 8;
    } else if (rating <= 1999) {
      return 9;
    } else if (rating <= 2099) {
      return 10;
    } else if (rating <= 2199) {
      return 11;
    } else {
      return 12;
    }
  }

  static getName(rating) {
    return Rank.name[Rank.icon(rating)];
  }
}
