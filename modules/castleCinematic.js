// «Кинематографичный вид» замка. Отдельной кнопки нет: если 15 с нет движения мыши и нажатий
// клавиш (замок при этом рисуется, и открытых окон нет), интерфейс плавно гаснет — остаётся
// только рендер canvas, а камера уходит в постановочный кадр. Любое действие игрока возвращает
// интерфейс мгновенно (камера доезжает до своего вида уже сама).
//
// Движение камеры — СВОЁ, не штатная анимация движка: tick ведёт одну таймлайн-позу с
// ease-in-out (плавный набор скорости и такое же торможение), а штатную скорость зума на время
// режима обнуляет. Обход сцены (yaw) делает Castle.camYaw/camPivot (castle.js). Класс висит на
// body, а не на #castle-body: экран замка пересобирается (View.show('castle')), а часть
// интерфейса живёт вне замка (быстрые вкладки, войс, новости, плашка обновления). Наблюдение за
// бездействием ставит View.castle() (start) и снимает View.show (stop); окно, открытое во время
// режима, тоже снимает режим (Window.show → exit).

import { Castle } from './castle.js';
import { Settings } from './settings.js';

export const CASTLE_CINEMATIC_CLASS = 'castle-cinematic';

// Точка, вокруг которой камера обходит сцену: пересечение оси зрения с землёй при штатной
// позе (мировые X/Z в системе Castle.updateMainCam). Одна для обеих фракций — камера общая.
export const CASTLE_CINEMATIC_PIVOT = [1200, 1350];

// Постановочные кадры. value — ступень зума (индекс в Castle.fixedFovValues /
// fixedRotationTiltValues / fixedCameraHeightValues, 1..6): ступени 4-6 — приподнятая камера
// с наклоном, только они дают «постановочный» вид; 1-3 — штатная верхняя перспектива, в кадр
// на ней вылезает светлая подложка замка. yaw — обход вокруг pivot в градусах, pan — сдвиг
// камеры в тех же координатах, что и штатное перетаскивание (Castle.camDeltaPos).
// Кадры подобраны скриншотами реального рендера (?previewCastle=1 + --use-angle=vulkan),
// днём и ночью; за ±135° у doct в кадр начинает вылезать край сцены — потому диапазон
// [-90°, +135°].
//
// tilt — наклон камеры в радианах, СВОЙ у кадра (Castle.cinematicTilt), а не наклон ступени
// зума из Castle.fixedRotationTiltValues. Нужен он вот для чего: небо замка — шесть граней
// скайбокса (sky_01…sky_06) с ЦИЛИНДРИЧЕСКОЙ панорамой на текстуре, и у этой панорамы есть
// верхний край — дуга, выше неё небо однотонное. При штатном наклоне ступеней 4-6 (−0.8…−0.9)
// верхняя граница цилиндра лежит ровно в верхней части кадра и видна и днём, и (гораздо
// сильнее) ночью. Наклон «меньше по модулю» = камера смотрит ниже: дуга уходит за верхнюю
// кромку кадра, а её место занимают горы/скалы заднего плана. Подобрано измерением
// (лучи верхней кромки кадра → грань скайбокса → v на текстуре против v_arc(u), измеренной
// с самой текстуры) для всех двенадцати кадров; у каждого — своё, с запасом ~3° от порога,
// при котором дуга уходит за кадр:
export const CASTLE_CINEMATIC_SHOTS = {
  doct: [
    { value: 5, yaw: 0, pan: [0, 0], tilt: -0.75 }, // фасад: донжон в центре, снежные горы за стеной
    { value: 6, yaw: 45, pan: [0, 0], tilt: -0.8 }, // крупно: юго-восточная стена, мельница, дома
    { value: 5, yaw: 90, pan: [0, 25], tilt: -0.7 }, // мост через ров и восточная башня
    { value: 5, yaw: -90, pan: [0, 10], tilt: -0.75 }, // закат: западная стена, облака, вода
    { value: 6, yaw: 135, pan: [0, 20], tilt: -0.75 }, // ворота и подъёмный мост в упор
    { value: 4, yaw: -20, pan: [0, 15], tilt: -0.65 }, // широкий охват: поселение, скалы, горы
  ],
  ad: [
    { value: 5, yaw: 0, pan: [0, 0], tilt: -0.8 }, // водопад и радуга над поселением
    { value: 6, yaw: 45, pan: [0, 0], tilt: -0.85 }, // крупно: пагода на утёсе и сакуры
    { value: 4, yaw: 90, pan: [0, 0], tilt: -0.55 }, // широко: скалы, водопады, поселения сбоку
    { value: 5, yaw: 135, pan: [0, 0], tilt: -0.6 }, // пагода на утёсе, синее небо и луна
    { value: 5, yaw: -45, pan: [0, 25], tilt: -0.8 }, // радуга аркой над всем поселением
    { value: 4, yaw: -20, pan: [0, 15], tilt: -0.7 }, // широко: водопады и лучи света слева
  ],
};

// Диапазон обхода, в котором кадры проверены скриншотами: за −90°…+135° в кадр лезет край
// сцены (бледный клин неба между гор, водная стена водопада). Диапазон — только страховка:
// каждый кадр сверялся со скриншотом ДНЁМ И НОЧЬЮ, и pan в таблице не косметика: опускание
// камеры (pan[1] +10…+25) убирает из верхней части кадра тот же клин, который на тех же yaw
// без pan виден; ночью клин заметнее всего (белый на тёмном небе) — ad на −90°/ступень 6
// пришлось снять именно из-за него.
export const CASTLE_CINEMATIC_YAW_LIMITS = {
  doct: [-90, 135],
  ad: [-90, 135],
};

// ease-in-out по кубике: старт и торможение без рывка
export function castleCinematicEase(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export class CastleCinematic {
  static AFK_MS = 15000;

  // сколько живём в одном кадре, прежде чем камера поедет к следующему
  static DWELL_MS = 32000;

  // длительности перелёта камеры: вход в кадр, кадр→кадр, возврат к виду игрока
  static MOVE_IN_MS = 9000;

  static MOVE_MS = 8000;

  static MOVE_OUT_MS = 2400;

  static ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart'];

  // расширенный на время режима диапазон панорамы (штатный — Castle.camDeltaPosMinMax)
  static PAN_LIMITS = [
    [-150, 90],
    [-150, 90],
  ];

  static watching = false;

  static active = false;

  // идёт возврат камеры к виду игрока (после выхода из режима)
  static returning = false;

  static lastActivity = 0;

  static pollTimer = 0;

  static raf = 0;

  static shotIndex = 0;

  static shotAt = 0;

  // поза игрока до входа (куда возвращаем) и её же штатные настройки камеры;
  // живёт до конца возврата
  static saved = null;

  // активный перелёт: { from, to, panFrom, panTo, yawFrom, yawTo, tiltFrom, tiltTo, t0, ms }
  // (panFrom/panTo, yawFrom/yawTo и tiltFrom/tiltTo могут отсутствовать — тогда компонент не ведём)
  static move = null;

  // --- наблюдение за бездействием (живёт, пока открыт замок) ---

  static start() {
    if (CastleCinematic.watching) return;
    CastleCinematic.watching = true;
    CastleCinematic.lastActivity = Date.now();
    for (const name of CastleCinematic.ACTIVITY_EVENTS) window.addEventListener(name, CastleCinematic.onActivity, { passive: true });
    // опрос вместо таймера на каждое событие: мышь шевелится сотнями событий в секунду
    CastleCinematic.pollTimer = setInterval(CastleCinematic.poll, 1000);
  }

  static stop() {
    if (!CastleCinematic.watching) return;
    CastleCinematic.watching = false;
    for (const name of CastleCinematic.ACTIVITY_EVENTS) window.removeEventListener(name, CastleCinematic.onActivity);
    clearInterval(CastleCinematic.pollTimer);
    CastleCinematic.pollTimer = 0;
    CastleCinematic.exit();
  }

  static onActivity(event) {
    CastleCinematic.lastActivity = Date.now();
    if (CastleCinematic.active) {
      CastleCinematic.exit();
    } else if (CastleCinematic.returning && (event.type === 'wheel' || event.type === 'mousedown')) {
      // игрок сам взялся за камеру: зум и панораму отдаём ему сразу, а угол обхода
      // всё равно доезжает до нуля — иначе вид останется повёрнутым навсегда
      const wheel = event.type === 'wheel' ? event : null;
      CastleCinematic.yieldCamera();
      if (wheel) Castle.zoom(wheel);
    }
  }

  static poll() {
    if (CastleCinematic.active || !CastleCinematic.watching) return;
    if (Date.now() - CastleCinematic.lastActivity < CastleCinematic.AFK_MS) return;
    if (!CastleCinematic.canEnter()) return;
    CastleCinematic.enter();
  }

  // Замок должен реально рисоваться (3D выключено в настройках, идёт бой, открыта мини-игра —
  // не на что смотреть) и под интерфейсом не должно быть окна лончера или диалога фермы.
  static canEnter() {
    // «Панорамный режим» в «Настройках замка» → «Замок (3D)»
    if (Settings.settings?.castlePanorama === false) return false;
    if (!document.getElementById('castle-body')) return false;
    if (Castle.render.includes(false)) return false;
    if (document.querySelector('#castle-body > [id^="w"], #castle-body > .window__overlay, dialog[open], .launcher-notifications-panel.is-open')) return false;
    return true;
  }

  // --- режим ---

  static enter() {
    if (CastleCinematic.active) return;
    CastleCinematic.active = true;
    CastleCinematic.returning = false;
    document.body.classList.add(CASTLE_CINEMATIC_CLASS);

    // поза игрока сохраняется один раз: возврат, прерванный повторным входом, не должен
    // записать промежуточную позу
    if (!CastleCinematic.saved) {
      CastleCinematic.saved = {
        value: Castle.currentFixedValue,
        pan: [Castle.camDeltaPos[0], Castle.camDeltaPos[1]],
        yaw: Castle.camYaw,
        speed: Castle.cameraAnimationSpeed,
        limits: Castle.camDeltaPosMinMax,
      };
    }
    // штатная анимация зума (экспоненциальное сглаживание current→target) на время режима
    // выключена: позой на каждом кадре управляет tick
    Castle.cameraAnimationSpeed = 0;
    Castle.camDeltaPosMinMax = CastleCinematic.PAN_LIMITS;
    Castle.camPivot = CASTLE_CINEMATIC_PIVOT;
    // наклон переходим на свой не рывком, а с текущего — иначе первый же кадр перелёта
    // подпрыгнет на величину разницы между наклоном ступени и наклоном кадра
    Castle.cinematicTilt = CastleCinematic.currentTilt();
    Castle.cinematicHeight = CastleCinematic.currentHeight();

    CastleCinematic.shotIndex = 0;
    CastleCinematic.shotAt = Date.now();
    CastleCinematic.startMove(CastleCinematic.shots()[0], CastleCinematic.MOVE_IN_MS);
  }

  static exit() {
    if (!CastleCinematic.active) return;
    CastleCinematic.active = false;
    document.body.classList.remove(CASTLE_CINEMATIC_CLASS);
    if (!CastleCinematic.saved) return;
    CastleCinematic.returning = true;
    CastleCinematic.startMove(CastleCinematic.saved, CastleCinematic.MOVE_OUT_MS);
  }

  // отменить возврат зума/панорамы, но довести угол обхода до нуля
  static yieldCamera() {
    const move = CastleCinematic.move;
    const yaw = Castle.camYaw;
    CastleCinematic.settleStep();
    CastleCinematic.returning = false;
    const saved = CastleCinematic.saved;
    CastleCinematic.saved = null;
    if (saved) {
      Castle.cameraAnimationSpeed = saved.speed;
      Castle.camDeltaPosMinMax = saved.limits;
    }
    Castle.cinematicTilt = null;
    Castle.cinematicHeight = null;
    CastleCinematic.move = {
      yawFrom: yaw,
      yawTo: 0,
      t0: Date.now(),
      ms: CastleCinematic.MOVE_OUT_MS,
    };
    if (!CastleCinematic.raf) CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
  }

  // вернуть движку управление зумом и зафиксировать ступень: пока
  // |currentFixedValue - targetFixedValue| > 0.04, Castle.zoom() игнорирует колесо
  static finishReturn() {
    CastleCinematic.returning = false;
    CastleCinematic.move = null;
    const saved = CastleCinematic.saved;
    CastleCinematic.saved = null;
    if (saved) {
      Castle.cameraAnimationSpeed = saved.speed;
      Castle.camDeltaPosMinMax = saved.limits;
    }
    CastleCinematic.settleStep();
    // наклон и высота больше не постановочные: движок берёт их из ступени зума
    Castle.cinematicTilt = null;
    Castle.cinematicHeight = null;
  }

  static settleStep() {
    const value = Math.round(Castle.currentFixedValue);
    Castle.initialFixedValue = value;
    Castle.targetFixedValue = value;
    Castle.currentFixedValue = value;
  }

  static shots() {
    return CASTLE_CINEMATIC_SHOTS[Castle.currentSceneName] || CASTLE_CINEMATIC_SHOTS.doct;
  }

  // наклон штатной ступени зума (то, что даёт движок без постановочного кадра)
  static stepTilt(value) {
    const table = Castle.fixedRotationTiltValues || [0, 0, 0, 0, -0.8, -0.9, -0.8];
    return table[Castle.clamp(Math.round(value), 0, table.length - 1)];
  }

  // наклон кадра: свой (shot.tilt) или ступени, если кадр его не задаёт
  static shotTilt(shot) {
    return shot && shot.tilt !== undefined && shot.tilt !== null ? shot.tilt : CastleCinematic.stepTilt(shot && shot.value);
  }

  // высота штатной ступени зума
  static stepHeight(value) {
    const table = Castle.fixedCameraHeightValues || [0, 0, 0, 0, 350, 350, 350];
    return table[Castle.clamp(Math.round(value), 0, table.length - 1)];
  }

  static shotHeight(shot) {
    return shot && shot.height !== undefined && shot.height !== null ? shot.height : CastleCinematic.stepHeight(shot && shot.value);
  }

  // фактический наклон камеры сейчас: постановочный, если он задан, иначе штатный
  static currentTilt() {
    return Castle.cinematicTilt === null || Castle.cinematicTilt === undefined ? Castle.rotationTilt : Castle.cinematicTilt;
  }

  static currentHeight() {
    return Castle.cinematicHeight === null || Castle.cinematicHeight === undefined ? Castle.cameraHeight : Castle.cinematicHeight;
  }

  static yawLimits() {
    return CASTLE_CINEMATIC_YAW_LIMITS[Castle.currentSceneName] || CASTLE_CINEMATIC_YAW_LIMITS.doct;
  }

  static startMove(shot, ms) {
    CastleCinematic.move = {
      from: Castle.currentFixedValue,
      to: shot.value,
      panFrom: [Castle.camDeltaPos[0], Castle.camDeltaPos[1]],
      panTo: shot.pan,
      yawFrom: Castle.camYaw,
      yawTo: ((shot.yaw || 0) * Math.PI) / 180,
      tiltFrom: CastleCinematic.currentTilt(),
      tiltTo: CastleCinematic.shotTilt(shot),
      heightFrom: CastleCinematic.currentHeight(),
      heightTo: CastleCinematic.shotHeight(shot),
      t0: Date.now(),
      ms,
    };
    if (!CastleCinematic.raf) CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
  }

  // Один rAF-цикл на всё: ведёт перелёт камеры, меняет кадр по таймеру, по окончании возврата
  // отдаёт камеру движку.
  static tick() {
    CastleCinematic.raf = 0;
    const now = Date.now();

    if (CastleCinematic.active) {
      const shots = CastleCinematic.shots();
      if (shots.length > 1 && now - CastleCinematic.shotAt > CastleCinematic.DWELL_MS) {
        CastleCinematic.shotAt = now;
        CastleCinematic.shotIndex = (CastleCinematic.shotIndex + 1) % shots.length;
        CastleCinematic.startMove(shots[CastleCinematic.shotIndex], CastleCinematic.MOVE_MS);
      }
    }

    const move = CastleCinematic.move;
    if (move) {
      const p = Castle.clamp((now - move.t0) / move.ms, 0, 1);
      const e = castleCinematicEase(p);
      // Движок берёт fov/наклон/высоту как lerp(fov[round(initial)], fov[round(target)],
      // |initial - current|) и корректен только при |initial - current| <= 1. Поэтому концы
      // задаём целыми индексами пресетов (от и куда), а current ставим на e рядом с «от»:
      // интерполяция идёт напрямую между двумя кадрами, без пролёта через промежуточные
      // ступени (у таблицы fov не монотонен: 45→25→55→35).
      if (move.to != null) {
        const from = Math.round(move.from);
        const to = Math.round(move.to);
        Castle.initialFixedValue = from;
        Castle.targetFixedValue = to;
        Castle.currentFixedValue = from + (to >= from ? 1 : -1) * e;
      }
      if (move.panTo) {
        for (const axis of [0, 1]) {
          Castle.camDeltaPos[axis] = move.panFrom[axis] + (move.panTo[axis] - move.panFrom[axis]) * e;
        }
      }
      if (move.yawTo != null) {
        Castle.camYaw = move.yawFrom + (move.yawTo - move.yawFrom) * e;
      }
      // наклон кадра ведётся по той же кривой, что fov/пан/угол: отдельный экспотейн ему не нужен
      if (move.tiltTo != null) {
        Castle.cinematicTilt = move.tiltFrom + (move.tiltTo - move.tiltFrom) * e;
      }
      if (move.heightTo != null) {
        Castle.cinematicHeight = move.heightFrom + (move.heightTo - move.heightFrom) * e;
      }
      if (p >= 1) {
        if (move.to != null) {
          const to = Math.round(move.to);
          Castle.currentFixedValue = Castle.initialFixedValue = Castle.targetFixedValue = to;
        }
        if (move.yawTo != null) Castle.camYaw = move.yawTo;
        if (move.tiltTo != null) Castle.cinematicTilt = move.tiltTo;
        if (move.heightTo != null) Castle.cinematicHeight = move.heightTo;
        CastleCinematic.move = null;
        if (CastleCinematic.returning) CastleCinematic.finishReturn();
      }
    }

    if (CastleCinematic.active || CastleCinematic.move) CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
  }
}
