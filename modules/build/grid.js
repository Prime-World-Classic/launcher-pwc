// Сетка билда: 36 слотов (6 рядов по 6), верхний ряд — уровень VI, нижний — I.
// Слот 0 — левый верхний, 35 — правый нижний. Панель активных — 24 слота: в ней номер
// слота поля + 1, со знаком минус — включён смарткаст.

export const SLOTS = 36;
export const ROW = 6;
export const LEVELS = 6;
export const ACTIVE_SLOTS = 24;

export const emptyBody = () => new Array(SLOTS).fill(null);
export const emptyActive = () => new Array(ACTIVE_SLOTS).fill(0);

// уровень ряда слота: 0..5 -> 6, 30..35 -> 1
export const levelOfSlot = (slot) => LEVELS - Math.floor(Number(slot) / ROW);

// слоты ряда уровня слева направо
export function rowSlots(level) {
  const start = (LEVELS - Number(level)) * ROW;
  return [start, start + 1, start + 2, start + 3, start + 4, start + 5];
}

// Первый пустой слот ряда таланта: справа налево (сеты) или слева направо (клик, превью таланта)
export function firstEmptySlot(body, level, fromLeft = false) {
  const lvl = Number(level);
  if (!(lvl >= 1 && lvl <= LEVELS)) return -1;
  const slots = rowSlots(lvl);
  if (!fromLeft) slots.reverse();
  return slots.find((slot) => !body[slot]) ?? -1;
}

// номер слота поля, на который ссылается элемент панели активных (-1 — пусто)
export const activeTarget = (item) => Math.abs(Number(item) || 0) - 1;

// элемент панели, ссылающийся на слот поля, или -1
export const activeIndexOf = (active, slot) => active.findIndex((item) => activeTarget(item) === slot);

export const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
