import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { App } from './app.js';
import { domAudioPresets } from './domAudioPresets.js';

export class Game {
  static sizeX = 10;

  static sizeY = 15;

  // перетаскивание фишки: {unit, x, y, startX, startY, pointerId}
  static drag = null;

  static blocked = false;

  static eventBack = false;

  static eventFinish = false;

  static eventExit = false;

  // Режим поля: 'farm' — одиночный фарм (gamev2), 'duel' — дуэль (match3Duel.js).
  // options (дуэль): unitImage(id), unitClass(id), requestMove({x1,y1,x2,y2}) → ответ с render,
  // afterMove(ответ) — вызывается после анимации своего хода.
  static mode = 'farm';

  static options = {};

  static init(body, object, isSplah, options = {}) {
    Game.options = options || {};

    Game.mode = Game.options.mode || 'farm';

    if (object) {
      if ('back' in object) {
        Game.eventBack = object.back;
      }

      if ('finish' in object) {
        Game.eventFinish = object.finish;
      }

      if ('exit' in object) {
        Game.eventExit = object.exit;
      }
    }

    Game.units = new Array();

    Game.info = DOM({
      style: 'game-info',
      domaudio: domAudioPresets.smallButton,
    });

    Game.scoring = DOM({
      style: 'game-scoring',
      domaudio: domAudioPresets.smallButton,
    });

    Game.field = DOM({
      style: 'game-field',
      domaudio: domAudioPresets.smallButton,
    });

    Game.fieldScoringContainer = DOM(
      {
        domaudio: domAudioPresets.smallButton,
        style: 'game-field-scoring-container',
      },
      Game.scoring,
      Game.field,
    );

    Game.viewScore = DOM({ style: 'game-view-score' });

    Game.viewInfo = DOM({ style: 'game-view-info' });

    Game.viewMoves = DOM();

    Game.viewTotalScore = DOM();

    Game.map = object.map;

    Game.chips = object.chips || null;

    Game.sizeX = Number(object.sizeX) || object.map.length;

    Game.sizeY = Number(object.sizeY) || (object.map[0] ? object.map[0].length : 0);

    Game.field.style.setProperty('--game-rows', Game.sizeX);

    Game.field.style.setProperty('--game-cols', Game.sizeY);

    Game.background = object.background;

    Game.units = object.unit;

    Game.rarity = object.rarity;

    Game.moves = object.move;

    Game.dataScore = new Object();

    Game.totalScore = 0;

    if ('score' in object) {
      for (let id in object.score) {
        Game.score(id, object.score[id]);
      }
    }

    Game.viewMoves.innerText = Lang.text('match3Moves').replace('{move}', object.move ?? 0).replace('{total}', object.moveTotal ?? 0);

    Game.viewTotalScore.innerText = `${Lang.text('match3Shards').replace('{count}', Game.totalScore)} | `;

    if (!isSplah) {
      Game.viewInfo.append(DOM({domaudio: domAudioPresets.smallButton, event: ['click', () => Game.eventBack()] }, Lang.text('goBack')), DOM({}, ` | `));
    }

    Game.viewInfo.append(
      Game.viewTotalScore,
      Game.viewMoves,
      DOM({}, ` | `),
      DOM({domaudio: domAudioPresets.bigButton, event: ['click', () => Game.eventFinish()] }, Lang.text('finishGame')),
    );

    Game.scoring.append(Game.viewScore);
    Game.info.append(Game.viewInfo);

    if (Game.mode == 'duel') {
      body.append(Game.field);
    } else if (body) {
      body.append(Game.info, Game.fieldScoringContainer);
    } else {
      document.body.append(Game.info, Game.field);
    }

    Game.view();
  }

  static score(id, number) {
    if (Game.mode != 'farm' || !id || id == '0') {
      return;
    }

    if (!(id in Game.dataScore)) {
      let unit = DOM({
        style: [`rarity${Game.rarity[id]}`, 'game-rarity-general'],
      });
      let text = DOM({ style: 'game-text' });

      unit.style.backgroundImage = `url(content/talents/${id}.webp)`;

      unit.append(text);

      Game.dataScore[id] = unit;

      Game.viewScore.append(unit);
    }

    Game.totalScore += number;

    Game.viewTotalScore.innerText = `${Lang.text('match3Shards').replace('{count}', Game.totalScore)} | `;

    Game.dataScore[id].firstChild.innerText = Number(Game.dataScore[id].innerText) + number;

    Game.dataScore[id].animate({ transform: ['scale(1)', 'scale(1.5)', 'scale(1)'] }, { duration: 250, fill: 'both', easing: 'ease-out' });
  }

  static position(coordinate) {
    return coordinate ? `${coordinate * 100}cqh` : '0';
  }

  // chip — значок стата фишки (только дуэль): талант на всю клетку, значок — маленький
  // и полупрозрачный в углу поверх таланта
  static createUnit(id, x, y, chip = 0) {
    let unit = DOM({ style: 'game-unit-item', id: `${x}:${y}` });

    if (Game.mode == 'duel') {
      unit.classList.add('m3d-cell');

      unit.dataset.talent = id;

      unit.dataset.chip = chip;

      // кристалл прайма — со свечением
      if (id == Game.options.crystalId) {
        unit.classList.add('m3d-crystal');
      }

      unit.style.backgroundImage = `url(content/talents/${id}.webp)`;

      if (chip) {
        const badge = DOM({ style: 'm3d-chip' });

        // картинка значка — переменной: в CSS под ней ещё слой с кольцом
        badge.style.setProperty('--chip', Game.options.chipImage ? Game.options.chipImage(chip) : 'none');

        unit.append(badge);
      }

      unit.style.top = `${Game.position(x)}`;

      unit.style.left = `${Game.position(y)}`;

      Game.field.append(DOM({ domaudio: domAudioPresets.smallButton, style: 'unit-container', event: ['pointerdown', (e) => Game.dragStart(e, unit)] }, unit));

      return unit;
    }

    let rarity = '';

    switch (Game.rarity?.[id]) {
      case 2:
        rarity = '0 0 20cqh rgba(174,80,251,0.8), inset 10cqh 10cqh 15cqh rgba(174,80,251,0.5)';
        break;

      case 3:
        rarity = '0 0 20cqh rgba(255,156,32,0.8), inset 10cqh 10cqh 15cqh rgba(255,156,32,0.5)';
        break;

      case 4:
        rarity = '0 0 20cqh rgba(255,26,26,0.8), inset 10cqh 10cqh 15cqh rgba(255,26,26,0.5)';
        break;
    }

    if (rarity) {
      unit.style.boxShadow = rarity;
    }

    unit.style.backgroundImage = `url(content/talents/${id}.webp)`;

    unit.style.top = `${Game.position(x)}`;

    unit.style.left = `${Game.position(y)}`;

    Game.field.append(DOM({ domaudio: domAudioPresets.smallButton, style: 'unit-container', event: ['pointerdown', (e) => Game.dragStart(e, unit)] }, unit));

    return unit;
  }

  static createBackgroundUnit(x, y) {
    let unit = DOM({ style: 'game-unit-bg', id: `${x}:${y}` });

    unit.id = `BG:${x}:${y}`;

    unit.style.backgroundImage = `url(content/talents/763.webp)`;

    unit.style.top = `${Game.position(x)}`;

    unit.style.left = `${Game.position(y)}`;

    Game.field.append(DOM({ domaudio: domAudioPresets.smallButton, style: 'unit-container' }, unit));

    return unit;
  }

  static shuffle(arr) {
    let j, temp;

    for (let i = arr.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));

      temp = arr[j];

      arr[j] = arr[i];

      arr[i] = temp;
    }

    return arr;
  }

  static getRandomInt(min, max) {
    min = Math.ceil(min);

    max = Math.floor(max);

    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static view() {
    Game.blocked = true;

    let units = new Array(),
      background = new Array();

    for (let x = 0; x < Game.sizeX; x++) {
      for (let y = 0; y < Game.sizeY; y++) {
        if (Game.background?.[x]?.[y]) {
          background.push({
            x: x,
            y: y,
            body: Game.createBackgroundUnit(x, y),
          });
        }

        units.push(Game.createUnit(Game.map[x][y], x, y, Game.chips?.[x]?.[y]));
      }
    }

    units = Game.shuffle(units);

    let delay = 0,
      number = 0;

    for (let unit of units) {
      number++;

      let topOffset = `${unit.offsetTop + Game.getRandomInt(-50, 50)}cqh`;

      let leftOffset = `${unit.offsetLeft + Game.getRandomInt(-50, 50)}cqh`;

      let animate = unit.animate(
        {
          top: [topOffset, unit.style.top],
          left: [leftOffset, unit.style.left],
          opacity: [0, 1],
          transform: ['scale(2.5)', 'scale(0.9)'],
        },
        { delay: delay, duration: 250, fill: 'both', easing: 'ease-out' },
      );

      delay += 5;

      if (number == units.length) {
        animate.onfinish = () => {
          for (let item of background) {
            let state = Game.background[item.x][item.y];

            switch (state) {
              case 1:
                state = 0.9;
                break;

              case 2:
                state = 0.6;
                break;

              case 3:
                state = 0.3;
                break;
            }

            item.body.animate(
              {
                opacity: [0, state],
                transform: ['scale(0.3)', 'scale(1)', 'scale(0.9)'],
              },
              { duration: 500, fill: 'both', easing: 'ease-in' },
            );
          }

          // в дуэли поле открыто только в свой ход
          Game.blocked = Game.options.isBlocked ? Game.options.isBlocked() : false;

          Game.options.onReady?.();

          animate.onfinish = null;
        };
      }
    }
  }

  // Ход перетаскиванием: тянем фишку к соседней клетке; как только сдвиг больше
  // трети клетки, меняем её с соседом в эту сторону (по большей оси).
  static dragStart(event, unit) {
    if (Game.blocked || Game.drag || event.button > 0 || !unit.isConnected) {
      return;
    }

    let data = unit.id.split(':');

    if (data.length != 2) {
      return;
    }

    event.preventDefault();

    Game.drag = {
      unit: unit,
      x: Number(data[0]),
      y: Number(data[1]),
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      cell: unit.parentElement.getBoundingClientRect().width || 1,
    };

    unit.classList.add('game-unit-drag');

    window.addEventListener('pointermove', Game.dragMove);
    window.addEventListener('pointerup', Game.dragEnd);
    window.addEventListener('pointercancel', Game.dragEnd);
  }

  static dragMove(event) {
    let drag = Game.drag;

    if (!drag || event.pointerId != drag.pointerId) {
      return;
    }

    // кнопку отпустили там, где pointerup не дошёл (за окном) — ход не делаем
    if (!(event.buttons & 1)) {
      Game.dragEnd();

      return;
    }

    let dx = event.clientX - drag.startX,
      dy = event.clientY - drag.startY,
      horizontal = Math.abs(dx) >= Math.abs(dy),
      shift = horizontal ? dx : dy,
      limit = drag.cell * 0.5;

    // фишка следует за курсором только вдоль одной оси и не дальше полклетки
    shift = Math.max(-limit, Math.min(limit, shift));

    drag.unit.style.translate = horizontal ? `${shift}px 0` : `0 ${shift}px`;

    if (Math.abs(horizontal ? dx : dy) < drag.cell / 3) {
      return;
    }

    let x2 = drag.x + (horizontal ? 0 : Math.sign(dy)),
      y2 = drag.y + (horizontal ? Math.sign(dx) : 0),
      neighbor = x2 >= 0 && y2 >= 0 && x2 < Game.sizeX && y2 < Game.sizeY ? document.getElementById(`${x2}:${y2}`) : null,
      unit = drag.unit;

    Game.dragEnd();

    if (!neighbor || Game.blocked) {
      return;
    }

    Game.move(unit, neighbor).catch((e) => {
      console.log(e);
      Game.exit();
    });
  }

  static dragEnd() {
    window.removeEventListener('pointermove', Game.dragMove);
    window.removeEventListener('pointerup', Game.dragEnd);
    window.removeEventListener('pointercancel', Game.dragEnd);

    if (Game.drag) {
      Game.drag.unit.style.translate = '';
      Game.drag.unit.classList.remove('game-unit-drag');
    }

    Game.drag = null;
  }

  static async move(element1, element2) {
    Game.blocked = true;

    let data1 = element1.id.split(':'),
      data2 = element2.id.split(':');

    let protect = false;

    if (
      (Number(data1[0]) - 1 == data2[0] && data1[1] == data2[1]) ||
      (Number(data1[0]) + 1 == data2[0] && data1[1] == data2[1]) ||
      (Number(data1[1]) - 1 == data2[1] && data1[0] == data2[0]) ||
      (Number(data1[1]) + 1 == data2[1] && data1[0] == data2[0])
    ) {
      protect = true;
    }

    if (!protect) {
      Game.blocked = false;

      return;
    }

    let coords = { x1: data1[0], y1: data1[1], x2: data2[0], y2: data2[1] };

    let request = Game.options.requestMove ? await Game.options.requestMove(coords) : await App.api.request('gamev2', 'move2', coords);

    let render = request?.render || [];

    if (Game.mode == 'farm' && render.length) {
      Game.moves++;

      Game.viewMoves.innerText = Lang.text('match3Moves').replace('{move}', request.move).replace('{total}', request.moveTotal);
    }

    await Game.playMove(element1, element2, render);

    if (Game.mode == 'duel') {
      // дуэль сама решает, когда снова можно ходить (ход соперника, конец боя)
      await Game.options.afterMove?.(request);

      return;
    }

    if (request.move != request.moveTotal) {
      Game.blocked = false;
    }
  }

  // Анимация обмена двух фишек и всего render; пустой render — фишки возвращаются на место.
  static playMove(element1, element2, render) {
    return new Promise((resolve) => {
      let data1 = element1.id.split(':'),
        data2 = element2.id.split(':');

      if (render.length) {
        element1.id = `${data2[0]}:${data2[1]}`;

        element2.id = `${data1[0]}:${data1[1]}`;
      }

      let element1Animate = element1.animate(
        {
          top: [`${Game.position(data1[0])}`, `${Game.position(data2[0])}`],
          left: [`${Game.position(data1[1])}`, `${Game.position(data2[1])}`],
        },
        { duration: 250, fill: 'both' },
      );

      let element2Animate = element2.animate(
        {
          top: [`${Game.position(data2[0])}`, `${Game.position(data1[0])}`],
          left: [`${Game.position(data2[1])}`, `${Game.position(data1[1])}`],
        },
        { duration: 250, fill: 'both' },
      );

      element1Animate.onfinish = async () => {
        element1Animate.onfinish = null;

        if (render.length) {
          await Game.playRender(render);
        } else {
          element1Animate.reverse();

          element2Animate.reverse();

          await element1Animate.finished.catch(() => {});
        }

        resolve();
      };
    });
  }

  static async playRender(render) {
    for (let item of render) {
      switch (item.action) {
        case 'hide':
          await Game.hideAnimate(item.data);

          await Game.backgroundAnimate(item.data);

          break;

        case 'move':
          await Game.moveAnimate(item.data);
          break;

        case 'add':
          await Game.dropAnimate(item.data);
          break;
      }
    }
  }

  // Ход соперника (дуэль): те же анимации по координатам
  static async playRemoteMove(x1, y1, x2, y2, render) {
    let element1 = document.getElementById(`${x1}:${y1}`),
      element2 = document.getElementById(`${x2}:${y2}`);

    if (!element1 || !element2) {
      return;
    }

    await Game.playMove(element1, element2, render || []);
  }

  // Сменить значок под талантом (умение героя в дуэли), со вспышкой
  static setChip(x, y, chip) {
    const unit = document.getElementById(`${x}:${y}`);

    if (Game.chips?.[x]) {
      Game.chips[x][y] = chip;
    }

    if (!unit) {
      return;
    }

    unit.dataset.chip = chip;

    let badge = unit.querySelector('.m3d-chip');

    if (!badge) {
      badge = DOM({ style: 'm3d-chip' });

      unit.append(badge);
    }

    badge.style.setProperty('--chip', Game.options.chipImage ? Game.options.chipImage(chip) : 'none');

    badge.animate(
      [
        { transform: 'scale(0.3) rotate(-90deg)', filter: 'brightness(2.5)' },
        { transform: 'scale(1.3) rotate(0deg)', filter: 'brightness(1.8)', offset: 0.6 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 600, easing: 'ease-out' },
    );
  }

  // Новое поле целиком (перемешивание в дуэли)
  static rebuild(map, chips = null) {
    Game.dragEnd();

    Game.field.replaceChildren();

    Game.map = map;

    Game.chips = chips;

    return new Promise((resolve) => {
      let units = new Array();

      for (let x = 0; x < Game.sizeX; x++) {
        for (let y = 0; y < Game.sizeY; y++) {
          units.push(Game.createUnit(map[x][y], x, y, chips?.[x]?.[y]));
        }
      }

      let last = null;

      units.forEach((unit, i) => {
        last = unit.animate(
          { opacity: [0, 1], transform: ['scale(0.2) rotate(-90deg)', 'scale(0.9) rotate(0)'] },
          { delay: (i % 15) * 12, duration: 300, fill: 'both', easing: 'ease-out' },
        );
      });

      if (!last) {
        resolve();

        return;
      }

      last.onfinish = () => resolve();
    });
  }

  static async hideAnimate(data) {
    let animations = new Array();

    for (let unit of data.hide || []) {
      let findUnit = document.getElementById(`${unit.x}:${unit.y}`);

      if (!findUnit) {
        continue;
      }

      // id сразу снимаем, чтобы падающие фишки могли его занять
      findUnit.removeAttribute('id');

      let animate = findUnit.animate(
        { opacity: [1, 0], transform: ['scale(0.9)', 'scale(3)'] },
        { duration: 250, fill: 'both', easing: 'ease-out' },
      );

      animations.push(
        animate.finished
          .catch(() => {})
          .then(() => {
            (findUnit.parentElement || findUnit).remove();
          }),
      );
    }

    await Promise.all(animations);

    for (let id in data.score || {}) {
      Game.score(id, data.score[id]);
    }

    return animations.length > 0;
  }

  static async backgroundAnimate(data) {
    return new Promise((resolve, reject) => {
      if (!data.hide.length || !Game.background) {
        resolve(false);

        return;
      }

      let hideBackground = new Array();

      for (let unit of data.hide) {
        if (!Game.background[unit.x][unit.y]) {
          continue;
        }

        hideBackground.push({
          x: unit.x,
          y: unit.y,
          body: document.getElementById(`BG:${unit.x}:${unit.y}`),
        });
      }

      if (!hideBackground.length) {
        resolve(true);
      }

      let number = 0,
        state = [0, 0.9, 0.6, 0.3];

      for (let item of hideBackground) {
        number++;

        if (!item.body) {
          continue;
        }

        let currentState = Game.background[item.x][item.y];

        Game.background[item.x][item.y]--;

        let animate = item.body.animate(
          {
            opacity: [currentState, Game.background[item.x][item.y]],
            transform: ['scale(0.9)', 'scale(1.6)', 'scale(0.9)'],
          },
          { duration: 500, fill: 'both', easing: 'ease-out' },
        );

        if (number == hideBackground.length) {
          animate.onfinish = () => {
            if (!Game.background[item.x][item.y]) {
              item.body.remove();
            }

            resolve(true);
          };
        } else {
          animate.onfinish = () => {
            if (!Game.background[item.x][item.y]) {
              item.body.remove();
            }
          };
        }
      }
    });
  }

  static async moveAnimate(data) {
    let animations = new Array();

    for (let unit of data) {
      let findUnit = document.getElementById(`${unit.x1}:${unit.y1}`);

      if (!findUnit) {
        continue;
      }

      findUnit.id = `${unit.x2}:${unit.y2}`;

      let animate = findUnit.animate(
        {
          top: [`${Game.position(unit.x1)}`, `${Game.position(unit.x2)}`],
          transform: ['rotate(0) scale(0.9)', `rotate(${Game.getRandomInt(-180, 180)}deg) scale(0.9)`, 'rotate(0) scale(0.9)'],
        },
        { duration: 250, fill: 'both', easing: 'ease-in' },
      );

      animations.push(animate.finished.catch(() => {}));
    }

    await Promise.all(animations);

    return animations.length > 0;
  }

  static async dropAnimate(data) {
    let animations = new Array();

    for (let unit of data) {
      let createUnit = Game.createUnit(unit.id, unit.x, unit.y, unit.chip);

      let animate = createUnit.animate(
        {
          opacity: [0, 1],
          transform: ['rotate(0) scale(0.9)', 'rotate(360deg) scale(0.9)'],
        },
        { duration: 250, fill: 'both', easing: 'ease-in' },
      );

      animations.push(animate.finished.catch(() => {}));
    }

    await Promise.all(animations);

    return animations.length > 0;
  }

  static exit() {
    Game.dragEnd();

    if (Game.eventExit) {
      Game.eventExit();
    }
  }
}
