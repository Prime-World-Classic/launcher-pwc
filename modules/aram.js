import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { App } from './app.js';
import { Castle } from './castle.js';
import { Sound } from './sound.js';
import { Splash } from './splash.js';

export class ARAM {
  static role = {
    1: {
      name: 'Защитник',
      description: 'Прорвать оборону противника и недопустить подхода вражеских героев к более уязвимым союзникам вашей команды.',
    },
    2: {
      name: 'Штурмовик',
      description: 'Поддержать прорыв обороны противника и недопустить подхода вражеских героев к более уязвимым союзникам вашей команды.',
    },
    3: {
      name: 'Верховный повелитель',
      description:
        'Нанести основной урон вражеской команде и соблюдать дистанцию между противниками, чтобы исключить их подход близко к вам.',
    },
    4: {
      name: 'Младший повелитель',
      description:
        'Нанести основной урон вражеской команде и соблюдать дистанцию между противниками, чтобы исключить их подход близко к вам.',
    },
    5: {
      name: 'Поддержка',
      description: 'Не допустить ослабления героев союзной команды и любой ценой быть готовым спасти каждого из них.',
    },
    6: {
      name: 'Преследователь',
      description: 'Найти уязвимых героев вражеской команды для нанесения урона с целью ослабления роли противника или его уничтожения.',
    },
    7: {
      name: 'Стрелок',
      description:
        'Нанести урон по более уязвимым героям вражеской команды и соблюдать дистанцию между противниками, чтобы исключить их подход близко к вам.',
    },
  };

  static briefing(heroId, roleId, callback) {
    let hero = DOM({ style: 'aram-briefing-left' }, DOM({ style: 'aram-random' }));

    hero.style.backgroundImage = `url(content/hero/empty.webp)`;

    let lastRandomHero = 0,
      second = 17,
      timer = DOM({ style: 'aram-timer' }, 'Начало боя через 15...');

    let setIntervalId = setInterval(() => {
      if (second <= 5) {
        clearInterval(setIntervalId);

        hero.style.backgroundImage = `url(content/hero/${heroId}/1.webp)`;

        Sound.play(`content/hero/${heroId}/revive/${App.getRandomInt(1, 4)}.ogg`, {
          volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        });

        hero.firstChild.animate({ opacity: [1, 0] }, { duration: 5000, fill: 'forwards', easing: 'ease-out' });

        // hero.animate({ backgroundSize: ['100%', '125%'] }, { duration: 1500, fill: 'forwards', easing: 'ease-in' });

        return;
      }

      let heroRandom = 0;

      while (true) {
        heroRandom = App.getRandomInt(1, 65);

        if (heroRandom != lastRandomHero) {
          lastRandomHero = heroRandom;

          break;
        }
      }

      hero.style.backgroundImage = `url(content/hero/${heroRandom}/1.webp)`;
    }, 150);

    let timerId = setInterval(() => {
      if (second == 0) {
        clearInterval(timerId);

        return;
      }

      second--;

      timer.innerText = second == 0 ? Lang.text('fight') : `Начало боя через ${second}...`;
    }, 1000);

    let part = DOM({ style: 'aram-background-part' });

    part.style.backgroundImage = `url(content/img/aram/part.png)`;

    part.style.backdropFilter = 'blur(5vmax)';

    //let text = DOM({style:'aram-text'},DOM({style:'aram-text-center'},DOM({tag:'div'},DOM({tag:'h1'},`Ваша роль — ${ARAM.role[roleId].name}`)),DOM({tag:'div'},ARAM.role[roleId].task)));
    let h1 = DOM({ tag: 'h1' }, 'Без права на ошибку');
    let text = DOM(
      { tag: 'div' },
      'Одна ошибка в ARAM — равномерна гибели всей команды. Восстановить запас здоровья или энергии героя на главной базе нельзя.',
    );
    let bodyText = DOM({ style: 'aram-text' }, DOM({ style: 'aram-text-center' }, h1, text));

    setTimeout(() => {
      let animate = bodyText.animate({ opacity: [0, 1] }, { duration: 1650, fill: 'forwards', easing: 'ease-out' });

      animate.onfinish = () => {
        setTimeout(() => {
          animate.reverse();

          animate.onfinish = () => {
            h1.innerText = `Ваша роль
                        ${ARAM.role[roleId].name}`;

            text.innerText = '';

            animate.onfinish = () => {
              animate.onfinish = () => {
                h1.innerText = 'Ваша задача';
                text.innerText = ARAM.role[roleId].description;

                animate.reverse();

                animate.onfinish = () => {
                  animate.reverse();

                  animate.onfinish = null;
                };
              };

              animate.reverse();
            };

            animate.reverse();
          };
        }, 1000);
      };
    }, 1000);

    let background = DOM({ style: 'aram-background' }, part, hero, bodyText); // content

    background.style.backgroundImage = `url(content/img/aram/bg.png)`;

    //timer.animate({ transform: ['scale(1)', 'scale(1.1)', 'scale(1)'] }, { duration: 1000, iterations: Infinity, easing: 'ease-out' });

    setTimeout(() => {
      let animate = part.animate(
        { backdropFilter: ['blur(5vmax)', 'blur(0)'] },
        { duration: 5000, fill: 'forwards', easing: 'ease-in-out' },
      );

      animate.onfinish = () => {
        part.style.display = 'none';

        setTimeout(() => {
          background.animate({ transform: ['scale(1)', 'scale(1.9)'] }, { duration: 1000, easing: 'ease-out', fill: 'forwards' });

          setTimeout(() => {
            Castle.toggleMusic(Castle.MUSIC_LAYER_TAMBUR, true);

            callback();

            Splash.hide();
          }, 4000);
        }, 500);
      };
    }, 7500);

    Castle.toggleMusic(Castle.MUSIC_LAYER_TAMBUR, false);

    Sound.play('content/sounds/aram/bg.mp3', {
      id: 'backgroundAram',
      volume: Castle.GetVolume(Castle.AUDIO_MUSIC),
    });

    Splash.show(background, false);
  }
}
