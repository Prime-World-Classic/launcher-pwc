// «Кинематографичный вид» замка. Отдельной кнопки нет: если 15 с нет движения мыши и нажатий
// клавиш (замок при этом рисуется, и открытых окон нет), интерфейс плавно гаснет — остаётся
// только рендер canvas, а камера медленно уходит в постановочный кадр. Любое действие игрока
// возвращает интерфейс мгновенно (камера доезжает до своего вида уже сама, плавно).
//
// Класс висит на body, а не на #castle-body: экран замка пересобирается (View.show('castle')),
// а часть интерфейса живёт вне замка (быстрые вкладки, войс, новости, плашка обновления).
// Наблюдение за бездействием ставит View.castle() (start) и снимает View.show (stop); окно,
// открытое во время режима, тоже снимает режим (Window.show → exit).

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

export class CastleCinematic {
  static AFK_MS = 15000;

  // сколько живём в одном кадре, прежде чем камера поедет к следующему
  static DWELL_MS = 16000;

  // постоянная времени панорамы (секунды): вход — медленно, возврат — быстро
  static TAU_IN = 3.0;

  // Castle.cameraAnimationSpeed на время режима: медленнее штатного (4.0), но ступень зума
  // всё равно доезжает за ~1.2 с — лесенка из пяти ступеней выглядит одним плавным наездом
  static CINEMATIC_SPEED = 2.5;

  static TAU_OUT = 0.6;

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

  // поза игрока до входа: куда возвращаем камеру при выходе
  static saved = null;

  static panTarget = null;

  static zoomTarget = null;

  static prevFrameMs = 0;

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
      // игрок сам взялся за камеру — тащить её к сохранённой позе уже не нужно
      CastleCinematic.cancelReturn();
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

    CastleCinematic.saved = {
      value: Castle.targetFixedValue,
      pan: [Castle.camDeltaPos[0], Castle.camDeltaPos[1]],
      speed: Castle.cameraAnimationSpeed,
      limits: Castle.camDeltaPosMinMax,
    };
    // движок сам лерпит fov/наклон/высоту к targetFixedValue — на время режима медленнее
    Castle.cameraAnimationSpeed = CastleCinematic.CINEMATIC_SPEED;
    Castle.camDeltaPosMinMax = CastleCinematic.PAN_LIMITS;

    CastleCinematic.shotIndex = 0;
    CastleCinematic.shotAt = Date.now();
    CastleCinematic.pointAt(CastleCinematic.shots()[0]);

    CastleCinematic.prevFrameMs = 0;
    if (!CastleCinematic.raf) CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
  }

  static exit() {
    if (!CastleCinematic.active) return;
    CastleCinematic.active = false;
    document.body.classList.remove(CASTLE_CINEMATIC_CLASS);

    const saved = CastleCinematic.saved;
    CastleCinematic.saved = null;
    if (!saved) return;

    Castle.cameraAnimationSpeed = saved.speed;
    Castle.camDeltaPosMinMax = saved.limits;
    CastleCinematic.returning = true;
    CastleCinematic.zoomTarget = saved.value;
    CastleCinematic.panTarget = saved.pan;
    if (!CastleCinematic.raf) {
      CastleCinematic.prevFrameMs = 0;
      CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
    }
  }

  static cancelReturn() {
    CastleCinematic.returning = false;
    CastleCinematic.panTarget = null;
    CastleCinematic.zoomTarget = null;
  }

  static shots() {
    return CASTLE_CINEMATIC_SHOTS[Castle.currentSceneName] || CASTLE_CINEMATIC_SHOTS.doct;
  }

  static pointAt(shot) {
    CastleCinematic.panTarget = shot.pan;
    CastleCinematic.zoomTarget = shot.value;
  }

  // Движок лерпит зум только для шага ±1 (camLerp = |initial - current|), поэтому постановочный
  // переход — лесенкой, по одной ступени за раз, не начиная следующий шаг, пока едет предыдущий.
  static stepZoomTo(value) {
    const want = Math.round(value);
    const here = Math.round(Castle.targetFixedValue);
    if (want === here) return false;
    if (Math.abs(Castle.currentFixedValue - Castle.targetFixedValue) > 0.05) return true;
    Castle.initialFixedValue = Castle.currentFixedValue;
    Castle.targetFixedValue = Castle.clamp(here + (want > here ? 1 : -1), Castle.MIN_FIXED_VALUE, Castle.fixedFovValues.length - 1);
    return true;
  }

  // Один rAF-цикл на всё: догоняем панораму, меняем кадр по таймеру, после выхода дотормаживаем
  // возврат и гасим цикл.
  static tick() {
    CastleCinematic.raf = 0;
    const now = Date.now();
    const dt = CastleCinematic.prevFrameMs ? Math.min((now - CastleCinematic.prevFrameMs) / 1000, 0.1) : 0.016;
    CastleCinematic.prevFrameMs = now;

    if (CastleCinematic.active) {
      const shots = CastleCinematic.shots();
      if (shots.length > 1 && now - CastleCinematic.shotAt > CastleCinematic.DWELL_MS) {
        CastleCinematic.shotAt = now;
        CastleCinematic.shotIndex = (CastleCinematic.shotIndex + 1) % shots.length;
        CastleCinematic.pointAt(shots[CastleCinematic.shotIndex]);
      }
    }

    let moving = false;

    const panTarget = CastleCinematic.panTarget;
    if (panTarget) {
      const tau = CastleCinematic.active ? CastleCinematic.TAU_IN : CastleCinematic.TAU_OUT;
      const k = 1 - Math.exp(-dt / tau);
      for (const axis of [0, 1]) {
        const delta = panTarget[axis] - Castle.camDeltaPos[axis];
        if (Math.abs(delta) > 0.2) {
          Castle.camDeltaPos[axis] += delta * k;
          moving = true;
        } else {
          Castle.camDeltaPos[axis] = panTarget[axis];
        }
      }
    }

    if (CastleCinematic.stepZoomTo(CastleCinematic.zoomTarget ?? Castle.targetFixedValue)) moving = true;
    if (Math.abs(Castle.currentFixedValue - Castle.targetFixedValue) > 0.01) moving = true;

    if (CastleCinematic.active) {
      CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
    } else if (moving) {
      CastleCinematic.raf = requestAnimationFrame(CastleCinematic.tick);
    } else {
      CastleCinematic.prevFrameMs = 0;
      CastleCinematic.returning = false;
      CastleCinematic.panTarget = null;
      CastleCinematic.zoomTarget = null;
    }
  }
}
