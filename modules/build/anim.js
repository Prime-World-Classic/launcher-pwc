// Анимации талантов: «перелёт» на новое место (FLIP) и исчезновение. Ячейки поля обрезают
// содержимое (overflow: hidden), поэтому летит не сам талант, а его копия в фиксированном слое
// поверх окна; оригинал скрыт атрибутом ячейки, пока копия летит.

const MOVE_MS = 220;
const ghosts = new WeakMap(); // талант -> завершить его полёт

export const animationsEnabled = () => {
  try {
    return typeof Element.prototype.animate === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
};

let styleInstalled = false;
function installStyle() {
  if (styleInstalled) return;
  styleInstalled = true;
  const style = document.createElement('style');
  style.textContent =
    '[data-talent-move-anim] > * { visibility: hidden !important; }' +
    // слот панели без смарткаста: летит только иконка, без рамки и фона
    '.build-talent-move-ghost-neutral { background: none !important; box-shadow: none !important;' +
    ' border-color: transparent !important; animation: none !important; }' +
    '.build-talent-move-ghost-neutral:after { display: none !important; }';
  document.head.append(style);
}

// копия ячейки (тех же размеров — для cq-единиц) с копией таланта
function ghostOf(node, box) {
  const parent = node.parentElement;
  const ghost = document.createElement('div');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.className = parent.className;
  const activeSlot = parent.classList.contains('build-active-bar-item');
  if (activeSlot) {
    ghost.classList.add(parent.classList.contains('smartcast') ? 'build-talent-move-ghost-smartcast' : 'build-talent-move-ghost-neutral');
    ghost.style.boxSizing = 'border-box';
    ghost.style.borderWidth = getComputedStyle(parent).borderTopWidth;
  }
  Object.assign(ghost.style, {
    position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
    margin: '0', overflow: 'visible', pointerEvents: 'none', zIndex: '10000', willChange: 'transform',
  });
  const clone = node.cloneNode(true);
  Object.assign(clone.style, { position: 'static', left: '', top: '', translate: '', opacity: '1' });
  clone.style.removeProperty('transform');
  ghost.append(clone);
  document.body.append(ghost);
  return ghost;
}

// где талант виден сейчас: если ещё летит — там, где его копия
export function visualRect(node) {
  const ghost = ghosts.get(node)?.ghost?.firstChild;
  return (ghost?.isConnected ? ghost : node).getBoundingClientRect();
}

// плавно довезти талант из from на его текущее место
export function animateMove(node, from, duration = MOVE_MS) {
  if (!node?.isConnected || !from?.width || !animationsEnabled()) return;
  const parent = node.parentElement;
  const to = node.getBoundingClientRect();
  if (!parent || !to.width) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  ghosts.get(node)?.();
  installStyle();
  const ghost = ghostOf(node, parent.getBoundingClientRect());
  parent.dataset.talentMoveAnim = `${(Number(parent.dataset.talentMoveAnim) || 0) + 1}`;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    ghost.remove();
    const left = (Number(parent.dataset.talentMoveAnim) || 1) - 1;
    if (left > 0) parent.dataset.talentMoveAnim = `${left}`;
    else delete parent.dataset.talentMoveAnim;
    ghosts.delete(node);
  };
  done.ghost = ghost;
  ghosts.set(node, done);
  const animation = ghost.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
    duration,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  });
  animation.onfinish = animation.oncancel = done;
  setTimeout(done, duration + 300);
}

// талант убран: копия гаснет и сжимается там, где он был виден (rect — например, точка броска)
export function animateVanish(node, rect = null, duration = 170) {
  if (!node?.parentElement || !animationsEnabled()) return;
  const from = rect || visualRect(node);
  const cell = node.parentElement.getBoundingClientRect();
  if (!from?.width || !cell.width) return;
  installStyle();
  ghosts.get(node)?.();
  const ghost = ghostOf(node, {
    left: from.left + from.width / 2 - cell.width / 2,
    top: from.top + from.height / 2 - cell.height / 2,
    width: cell.width,
    height: cell.height,
  });
  Object.assign(ghost.style, { display: 'flex', alignItems: 'center', justifyContent: 'center' });
  const animation = ghost.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6)' }], { duration, easing: 'ease-in' });
  const done = () => ghost.remove();
  animation.onfinish = animation.oncancel = done;
  setTimeout(done, duration + 300);
}

// FLIP для набора узлов: rects = capture(узлы по ключу) до перерисовки, play — после
export function capture(entries) {
  const rects = new Map();
  if (!animationsEnabled()) return rects;
  for (const [key, node] of entries) {
    if (!node?.isConnected) continue;
    const rect = visualRect(node);
    if (rect.width) rects.set(key, rect);
  }
  return rects;
}

export function play(rects, entries, overrides = new Map()) {
  for (const [key, node] of entries) {
    const from = overrides.get(key) || rects.get(key);
    if (from) animateMove(node, from, overrides.has(key) ? 180 : MOVE_MS);
  }
}
