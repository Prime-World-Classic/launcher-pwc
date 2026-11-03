// «Кинематографичный вид» замка. Отдельной кнопки нет: если 15 с нет движения мыши и нажатий
// клавиш (замок при этом рисуется, и открытых окон нет), интерфейс плавно гаснет — остаётся
// только рендер canvas, а камера уходит в постановочный кадр. Любое действие игрока возвращает
// интерфейс мгновенно (камера доезжает до своего вида уже сама).
//
// Движение камеры — СВОЁ, не штатная анимация движка: tick ведёт одну таймлайн-позу с
// ease-in-out (плавный набор скорости и такое же торможение), а штатную скорость зума на время
// режима обнуляет. Класс висит на body, а не на #castle-body: экран замка пересобирается
// (View.show('castle')), а часть интерфейса живёт вне замка (быстрые вкладки, войс, новости,
// плашка обновления). Наблюдение за бездействием ставит View.castle() (start) и снимает
// View.show (stop); окно, открытое во время режима, тоже снимает режим (Window.show → exit).

import { Castle } from './castle.js';

export const CASTLE_CINEMATIC_CLASS = 'castle-cinematic';

// Постановочные кадры. value — ступень зума (индекс в Castle.fixedFovValues /
// fixedRotationTiltValues / fixedCameraHeightValues, 1..6): ступени 4-6 — приподнятая камера
// с наклоном, только они дают «постановочный» вид; 1-3 — штатная верхняя перспектива, в кадр
// на ней вылезает светлая подложка замка. pan — сдвиг камеры в тех же координатах, что и
// штатное перетаскивание (Castle.camDeltaPos). Кадры подобраны скриншотами реального рендера
// (?previewCastle=1 + --use-angle=vulkan), днём и ночью.
export const CASTLE_CINEMATIC_SHOTS = {
  doct: [
    { value: 6, pan: [-45, -25] }, // пояс построек крупно: мельница слева, кузницы справа
    { value: 5, pan: [-45, 10] }, // общий план: замок на облаках, луна в правом верхнем углу
    { value: 6, pan: [20, -25] }, // правый край: дома, шестерни, огонь кузни
  ],
  ad: [
    { value: 6, pan: [20, -25] }, // поселение и орёл на фоне стены водопадов
    { value: 4, pan: [-45, 10] }, // общий план: водопады, листья, небо
    { value: 6, pan: [0, -30] }, // центр поселения крупно
  ],
};

// ease-in-out по кубике: старт и торможение без рывка
export function castleCinematicEase(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export class CastleCinematic {
  static AFK_MS = 15000;

  // сколько живём в одном кадре, прежде чем камера поедет к следующему
  static DWELL_MS = 16000;

  // длительности перелёта камеры: вход в кадр, кадр→кадр, возврат к виду игрока
  static MOVE_IN_MS = 4500;

  static MOVE_MS = 4000;

  static MOVE_OUT_MS = 1200;

  static ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart'];

  // расширенный на время режима диапазон панорамы (штатный — Castle.camDeltaPosMinMax):
  // постановочные кадры стоят дальше, чем игрок дотягивает перетаскиванием
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

  // поза игрока до входа (куда возвращаем) и её же штатные настройки камеры; живёт до конца возврата
  static saved = null;

  // активный перелёт: { from, to, panFrom, panTo, t0, ms }
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
      // игрок сам взялся за камеру: возврат снимаем, а его колесо прокручиваем уже сами —
      // движок в полёте камеры его игнорирует (ранний выход в Castle.zoom)
      const step = event.type === 'wheel' ? event : null;
      CastleCinematic.finishReturn();
      if (step) Castle.zoom(step);
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
    if (!document.getElementById('castle-body')) return false;
    if (Castle.render.includes(false)) return false;
    if (document.querySelector('#castle-body > [id^="w"], #castle-body > .window__overlay, dialog[open]')) return false;
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
        speed: Castle.cameraAnimationSpeed,
        limits: Castle.camDeltaPosMinMax,
      };
    }
    // штатная анимация зума (экспоненциальное сглаживание current→target) на время режима
    // выключена: позой на каждом кадре управляет tick
    Castle.cameraAnimationSpeed = 0;
    Castle.camDeltaPosMinMax = CastleCinematic.PAN_LIMITS;

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
    CastleCinematic.startMove({ value: CastleCinematic.saved.value, pan: CastleCinematic.saved.pan }, CastleCinematic.MOVE_OUT_MS);
  }

  // вернуть движку управление камерой и зафиксировать ступень: пока
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

  static startMove(shot, ms) {
    CastleCinematic.move = {
      from: Castle.currentFixedValue,
      to: shot.value,
      panFrom: [Castle.camDeltaPos[0], Castle.camDeltaPos[1]],
      panTo: shot.pan,
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
      // ступени таблицы (у неё fov не монотонен: 45→25→55→35).
      const from = Math.round(move.from);
      const to = Math.round(move.to);
      Castle.initialFixedValue = from;
      Castle.targetFixedValue = to;
      Castle.currentFixedValue = from + (to >= from ? 1 : -1) * e;
      for (const axis of [0, 1]) {
        Castle.camDeltaPos[axis] = move.panFrom[axis] + (move.panTo[axis] - move.panFrom[axis]) * e;
      }
      if (p >= 1) {
        CastleCinematic.move = null;
        // «куда» фиксируем только в конце: до этого current живёт рядом с «от»
        Castle.currentFixedValue = Castle.initialFixedValue = Castle.targetFixedValue = to;
        if (CastleCinematic.returning) CastleCinematic.finishReturn();
      }
    }

    if (CastleCinematic.active || CastleCinematic.move) CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
  }
}
