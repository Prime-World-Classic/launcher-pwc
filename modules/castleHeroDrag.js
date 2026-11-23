// Перетаскивание героя из полосы героев замка в списки (вкладки 1…8 и «+»).
// Отпустить над вкладкой — герой добавляется в этот список; отпустить где угодно,
// кроме вкладок, когда открыт список с этим героем, — герой убирается из него.
// Сам модуль только рисует: что делать со списками, решает ctx из view.js.
//
// ctx = {
//   selectedList(): number                — открытый список (0 — «все герои»)
//   inList(item, listId): boolean
//   listName(listId): string
//   targets(): [{ el, listId, isNew }]    — вкладки-приёмники (перерисовываются после изменений)
//   apply(action, listId, item): void     — 'add' | 'remove': поменять список и перерисовать
//   text(key): string
//   sound(name): void                     — 'pick' | 'add' | 'remove' | 'deny'
// }

// перетаскивание начинается, только если курсор ушёл заметно дальше — иначе это клик (открыть билд):
// не меньше 16 px и не меньше пятой части ширины карточки
const DRAG_THRESHOLD_MIN = 16;
const DRAG_THRESHOLD_CARD = 0.2;
const HIT_PAD_X = 8;
const HIT_PAD_Y = 14;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.55, 0, 0.75, 0.2)';

let active = null;

export const CastleHeroDrag = {
  attach(card, item, ctx) {
    card.addEventListener('pointerdown', (event) => onPointerDown(event, card, item, ctx));
  },

  isDragging() {
    return Boolean(active);
  },
};

function onPointerDown(event, card, item, ctx) {
  if (event.button !== 0 || active) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  const threshold = Math.max(DRAG_THRESHOLD_MIN, card.getBoundingClientRect().width * DRAG_THRESHOLD_CARD);
  let started = false;

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
      started = true;
      startDrag(card, item, ctx, startX, startY);
    }
    moveDrag(ev.clientX, ev.clientY);
  };
  const onUp = (ev) => {
    if (ev.pointerId !== pointerId) return;
    detach();
    if (started && active) {
      swallowNextClick();
      dropDrag(ev.clientX, ev.clientY);
    }
  };
  const onCancel = (ev) => {
    if (ev.pointerId !== pointerId) return;
    detach();
    if (started && active) cancelDrag();
  };
  const onKey = (ev) => {
    if (ev.key !== 'Escape' || !started || !active) return;
    ev.preventDefault();
    ev.stopPropagation();
    detach();
    swallowNextClick();
    cancelDrag();
  };
  const detach = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
}

// после перетаскивания браузер всё равно пришлёт click — он не должен открыть билд или отметить героя
function swallowNextClick() {
  const stop = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, true), 80);
}

function startDrag(card, item, ctx, startX, startY) {
  const rect = card.getBoundingClientRect();
  const offX = startX - rect.left;
  const offY = startY - rect.top;

  const wrap = document.createElement('div');
  wrap.className = 'castle-hero-drag-ghost';
  wrap.style.width = `${rect.width}px`;
  wrap.style.height = `${rect.height}px`;

  const clone = card.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  // у призрака — только портрет: своя круглая кнопка рамки путалась бы со значком «+»/«−»
  clone.querySelectorAll('.castle-hero-list-pick, .hero-frame-select').forEach((el) => el.remove());
  clone.classList.remove('hover-brightness', 'castle-hero-item-build-open', 'castle-hero-drag-source');
  clone.classList.add('castle-hero-drag-card');
  // PreloadImages ставит карточке inline opacity: 1 — он перебивал бы прозрачность из castle.css
  clone.style.removeProperty('opacity');
  clone.style.transformOrigin = `${offX}px ${offY}px`;

  const label = document.createElement('div');
  label.className = 'castle-hero-drag-label';

  const badge = document.createElement('div');
  badge.className = 'castle-hero-drag-badge';
  // карточка сжимается вокруг точки захвата, поэтому значок и подпись держатся у курсора
  badge.style.left = `${offX + rect.width * 0.24}px`;
  badge.style.top = `${offY - rect.height * 0.2}px`;
  label.style.left = `${offX}px`;
  label.style.top = `${offY + (rect.height - offY) * 0.62 + 6}px`;

  wrap.append(clone, badge, label);
  document.body.append(wrap);

  const selected = Number(ctx.selectedList()) || 0;
  const sourceList = selected > 0 && ctx.inList(item, selected) ? selected : 0;

  active = {
    card,
    item,
    ctx,
    wrap,
    clone,
    label,
    badge,
    offX,
    offY,
    rect,
    sourceList,
    targets: [],
    hover: null,
    state: '',
    x: rect.left,
    y: rect.top,
    lastX: startX,
    tilt: 0,
  };

  collectTargets();
  for (const target of active.targets) {
    target.el.classList.add('castle-hero-drop-ready');
    if (target.has) target.el.classList.add('castle-hero-drop-has');
    // подсказка вкладки («Список 2», uiTooltip.js) всплывала поверх карточки — на время перетаскивания убираем
    const el = target.el;
    target.savedTitle = el.getAttribute('title');
    target.savedTip = el.dataset.tip;
    el.removeAttribute('title');
    delete el.dataset.tip;
  }
  document.documentElement.classList.add('castle-hero-dragging');
  card.classList.add('castle-hero-drag-source');
  try {
    window.getSelection()?.removeAllRanges();
  } catch {}

  clone.animate(
    [
      { transform: 'scale(1) rotate(0deg)', filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' },
      { transform: 'scale(0.82) rotate(-3deg)', filter: 'drop-shadow(0 1.4vh 1.6vh rgba(0,0,0,0.65))' },
    ],
    { duration: 160, easing: EASE_OUT },
  );
  ctx.sound('pick');
}

function collectTargets() {
  const drag = active;
  drag.targets = (drag.ctx.targets() || []).map((target) => {
    const r = target.el.getBoundingClientRect();
    const bottom = Number.isFinite(target.clipBottom) ? Math.min(r.bottom, target.clipBottom) + 3 : r.bottom + HIT_PAD_Y;
    return {
      ...target,
      has: !target.isNew && drag.ctx.inList(drag.item, target.listId),
      hit: { left: r.left - HIT_PAD_X, right: r.right + HIT_PAD_X, top: r.top - HIT_PAD_Y, bottom },
    };
  });
}

function findTarget(x, y) {
  for (const target of active.targets) {
    const h = target.hit;
    if (x >= h.left && x <= h.right && y >= h.top && y <= h.bottom) return target;
  }
  return null;
}

function insideSource(x, y) {
  const r = active.rect;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function moveDrag(x, y) {
  const drag = active;
  if (!drag) return;
  drag.x = x - drag.offX;
  drag.y = y - drag.offY;
  drag.wrap.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0)`;

  // наклон по скорости — карточка «тянется» за курсором
  const vx = x - drag.lastX;
  drag.lastX = x;
  drag.tilt = drag.tilt * 0.7 + Math.max(-14, Math.min(14, vx * 0.9)) * 0.3;

  const target = findTarget(x, y);
  if (target !== drag.hover) {
    drag.hover?.el.classList.remove('castle-hero-drop-hover');
    target?.el.classList.add('castle-hero-drop-hover');
    drag.hover = target;
  }

  let state = 'idle';
  if (target) state = target.has ? 'already' : 'add';
  else if (drag.sourceList && !insideSource(x, y)) state = 'remove';
  setState(state, target);

  // над вкладкой карточка остаётся под курсором, только уменьшается (и просвечивает — см. castle.css)
  const scale = state === 'add' ? 0.5 : state === 'already' ? 0.56 : state === 'remove' ? 0.74 : 0.82;
  drag.clone.style.transform = `scale(${scale}) rotate(${(drag.tilt - 3).toFixed(2)}deg)`;
}

function setState(state, target) {
  const drag = active;
  const key = `${state}:${target ? target.listId : ''}`;
  if (drag.stateKey === key) return;
  drag.stateKey = key;
  drag.state = state;
  drag.wrap.classList.toggle('castle-hero-drag-add', state === 'add');
  drag.wrap.classList.toggle('castle-hero-drag-remove', state === 'remove');
  drag.wrap.classList.toggle('castle-hero-drag-already', state === 'already');

  const { ctx } = drag;
  let text = '';
  if (state === 'add') {
    text = target.isNew ? ctx.text('heroListDragNew') : ctx.text('heroListDragAdd').replace('{name}', ctx.listName(target.listId));
  } else if (state === 'already') {
    text = ctx.text('heroListDragAlready').replace('{name}', ctx.listName(target.listId));
  } else if (state === 'remove') {
    text = ctx.text('heroListDragRemove').replace('{name}', ctx.listName(drag.sourceList));
  }
  drag.label.textContent = text;
  drag.label.classList.toggle('castle-hero-drag-label-visible', Boolean(text));
  drag.badge.textContent = state === 'add' ? '+' : state === 'remove' ? '−' : '';
}

function dropDrag(x, y) {
  const drag = active;
  if (!drag) return;
  const target = findTarget(x, y);
  if (target && !target.has) {
    finishAdd(target);
  } else if (target && target.has) {
    shake(target.el);
    drag.ctx.sound('deny');
    flyBack();
  } else if (drag.sourceList && !insideSource(x, y)) {
    finishRemove();
  } else {
    flyBack();
  }
}

function cancelDrag() {
  if (!active) return;
  flyBack();
}

function endDrag() {
  const drag = active;
  if (!drag) return;
  for (const target of drag.targets) {
    const el = target.el;
    el.classList.remove('castle-hero-drop-ready', 'castle-hero-drop-has', 'castle-hero-drop-hover');
    if (target.savedTitle) el.setAttribute('title', target.savedTitle);
    if (target.savedTip) el.dataset.tip = target.savedTip;
  }
  document.documentElement.classList.remove('castle-hero-dragging');
  drag.card.classList.remove('castle-hero-drag-source');
  active = null;
  return drag;
}

function currentCloneTransform(drag) {
  return getComputedStyle(drag.clone).transform || 'none';
}

function flyBack() {
  const drag = endDrag();
  if (!drag) return;
  const home = drag.card.isConnected ? drag.card.getBoundingClientRect() : drag.rect;
  drag.label.classList.remove('castle-hero-drag-label-visible');
  drag.badge.textContent = '';
  drag.wrap.classList.remove('castle-hero-drag-add', 'castle-hero-drag-remove', 'castle-hero-drag-already');
  const from = currentCloneTransform(drag);
  drag.clone.style.transform = '';
  drag.wrap.animate(
    [{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }, { transform: `translate3d(${home.left}px, ${home.top}px, 0)` }],
    { duration: 260, easing: EASE_OUT, fill: 'forwards' },
  );
  const anim = drag.clone.animate([{ transform: from }, { transform: 'scale(1) rotate(0deg)' }], {
    duration: 260,
    easing: EASE_OUT,
    fill: 'forwards',
  });
  drag.card.classList.add('castle-hero-drag-returning');
  afterAnim(anim, 260, () => {
    drag.wrap.remove();
    drag.card.classList.remove('castle-hero-drag-returning');
  });
}

// окончание анимации; в свёрнутом/фоновом окне finish может прийти сильно позже — тогда по таймеру
function afterAnim(anim, ms, fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  anim.finished.then(run, run);
  setTimeout(run, ms + 150);
}

function finishAdd(target) {
  const drag = endDrag();
  if (!drag) return;
  const r = target.el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // точка захвата (там стоит курсор) летит в центр вкладки
  const toX = cx - drag.offX;
  const toY = cy - drag.offY;
  drag.label.classList.remove('castle-hero-drag-label-visible');
  const from = currentCloneTransform(drag);
  drag.clone.style.transform = '';

  drag.wrap.animate([{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }, { transform: `translate3d(${toX}px, ${toY}px, 0)` }], {
    duration: 240,
    easing: EASE_IN,
    fill: 'forwards',
  });
  const anim = drag.clone.animate(
    [
      { transform: from, opacity: 1 },
      { transform: 'scale(0.12) rotate(18deg)', opacity: 0.15 },
    ],
    { duration: 240, easing: EASE_IN, fill: 'forwards' },
  );
  // список меняется сразу, полёт — только картинка поверх
  const listId = target.listId;
  drag.ctx.apply('add', listId, drag.item);
  afterAnim(anim, 240, () => {
    drag.wrap.remove();
    drag.ctx.sound('add');
    // вкладки перерисованы — ищем новую (у «+» это вкладка нового списка)
    const fresh = (drag.ctx.targets() || []).find((t) => !t.isNew && t.listId === listId);
    const el = fresh?.el || (target.el.isConnected ? target.el : null);
    if (el) acceptBurst(el, target.isNew);
  });
}

function acceptBurst(el, isNew) {
  el.animate(
    isNew
      ? [
          { transform: 'translateY(-0.16cqh) scale(0.2)', opacity: 0 },
          { transform: 'translateY(-0.9cqh) scale(1.25)', opacity: 1, offset: 0.55 },
          { transform: 'translateY(-0.16cqh) scale(1)', opacity: 1 },
        ]
      : [
          { transform: 'translateY(-0.16cqh) scale(1)' },
          { transform: 'translateY(-0.9cqh) scale(1.22)', offset: 0.35 },
          { transform: 'translateY(-0.16cqh) scale(0.96)', offset: 0.7 },
          { transform: 'translateY(-0.16cqh) scale(1)' },
        ],
    { duration: 460, easing: 'ease-out' },
  );
  el.classList.remove('castle-hero-drop-flash');
  void el.offsetWidth;
  el.classList.add('castle-hero-drop-flash');
  setTimeout(() => el.classList.remove('castle-hero-drop-flash'), 700);

  const r = el.getBoundingClientRect();
  const plus = document.createElement('div');
  plus.className = 'castle-hero-drop-plus';
  plus.textContent = '+1';
  plus.style.left = `${r.left + r.width / 2}px`;
  plus.style.top = `${r.top}px`;
  document.body.append(plus);
  plus
    .animate(
      [
        { transform: 'translate(-50%, 0) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -2.2vh) scale(1.15)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%, -4.6vh) scale(1)', opacity: 0 },
      ],
      { duration: 820, easing: 'ease-out', fill: 'forwards' },
    )
    .finished.then(
      () => plus.remove(),
      () => plus.remove(),
    );

  sparks(r.left + r.width / 2, r.top + r.height / 2, 10, ['#ffe27a', '#7fe0ff', '#ffffff']);
}

function finishRemove() {
  const drag = endDrag();
  if (!drag) return;
  drag.label.classList.remove('castle-hero-drag-label-visible');
  drag.card.classList.add('castle-hero-drag-source');
  const from = currentCloneTransform(drag);
  drag.clone.style.transform = '';
  const box = drag.clone.getBoundingClientRect();
  const anim = drag.clone.animate(
    [
      { transform: from, opacity: 1, filter: 'blur(0) brightness(1)' },
      { transform: `${from === 'none' ? '' : from} scale(1.35)`, opacity: 0, filter: 'blur(0.6vh) brightness(1.8)' },
    ],
    { duration: 300, easing: 'ease-out', fill: 'forwards' },
  );
  drag.badge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
  sparks(box.left + box.width / 2, box.top + box.height / 2, 14, ['#ff7a6b', '#ffcf8a', '#d9c16f']);
  drag.ctx.sound('remove');
  afterAnim(anim, 300, () => drag.wrap.remove());
  drag.ctx.apply('remove', drag.sourceList, drag.item);
}

function shake(el) {
  el.animate(
    [
      { transform: 'translateY(-0.16cqh) translateX(0)' },
      { transform: 'translateY(-0.16cqh) translateX(-0.5cqh)' },
      { transform: 'translateY(-0.16cqh) translateX(0.45cqh)' },
      { transform: 'translateY(-0.16cqh) translateX(-0.3cqh)' },
      { transform: 'translateY(-0.16cqh) translateX(0.2cqh)' },
      { transform: 'translateY(-0.16cqh) translateX(0)' },
    ],
    { duration: 360, easing: 'ease-out' },
  );
}

function sparks(cx, cy, count, colors) {
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'castle-hero-drop-spark';
    dot.style.left = `${cx}px`;
    dot.style.top = `${cy}px`;
    dot.style.background = colors[i % colors.length];
    document.body.append(dot);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 3 + Math.random() * 3.5;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 0.8;
    dot
      .animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx.toFixed(2)}vh), calc(-50% + ${dy.toFixed(2)}vh)) scale(0.2)`, opacity: 0 },
        ],
        { duration: 480 + Math.random() * 220, easing: 'cubic-bezier(0.1, 0.8, 0.3, 1)', fill: 'forwards' },
      )
      .finished.then(
        () => dot.remove(),
        () => dot.remove(),
      );
  }
}
