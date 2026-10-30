// Боевой режим: прокачка билда по шагам, как в бою. Уровень героя = число изученных талантов,
// ряд открывается по уровню героя и числу изученных талантов в рядах ниже. Первым всегда
// изучен главный классовый талант.

import { ROW, SLOTS } from './grid.js';

// уровень ряда таланта (1..6)
const rowOf = (talent) => Math.max(1, Number(talent?.level) || 1);

// сколько рядов открыто на уровне героя
export const unlockedRows = (heroLevel) => {
  const level = Math.max(1, Number(heroLevel) || 1);
  return level >= 20 ? 6 : Math.max(1, Math.min(6, 1 + Math.floor(level / 4)));
};

// для ряда N+1 нужно изучить столько талантов в рядах 1..N
const ROW_REQUIREMENTS = [4, 8, 12, 16, 20];

export class Combat {
  constructor(body, mainSlot) {
    this.body = body;
    this.mainSlot = mainSlot;
    this.order = mainSlot >= 0 ? [mainSlot] : [];
  }

  get level() {
    return this.order.length;
  }

  // множитель стаков: доля от 36 уровней
  get factor() {
    return Math.max(0, Math.min(1, Math.max(1, this.level) / SLOTS));
  }

  get learned() {
    return new Set(this.order);
  }

  orderOf(slot) {
    const index = this.order.indexOf(slot);
    return index < 0 ? null : index + 1;
  }

  canLearn(slot) {
    const talent = this.body[slot];
    return !!talent && !this.order.includes(slot) && rowOf(talent) <= unlockedRows(this.level);
  }

  // ЛКМ: не изучен — изучить; изучен — откатить прокачку до него (он тоже снимается)
  click(slot) {
    const order = this.orderOf(slot);
    if (order) this.rollbackTo(order - 1);
    else if (this.canLearn(slot)) this.order.push(slot);
    else return false;
    return true;
  }

  // ПКМ: снять один изученный талант (кроме главного), номера следующих сдвигаются
  remove(slot) {
    if (slot === this.mainSlot || !this.order.includes(slot)) return false;
    this.order.splice(this.order.indexOf(slot), 1);
    this.enforce();
    return true;
  }

  rollbackTo(keep) {
    this.order = this.order.slice(0, Math.max(0, Math.floor(Number(keep) || 0)));
    if (!this.order.length && this.mainSlot >= 0) this.order = [this.mainSlot];
    this.enforce();
  }

  // После снятия таланта: ряды, которые больше не открыты, снимаются с конца порядка изучения
  enforce() {
    let changed = true;
    while (changed) {
      changed = false;
      const byRow = new Map();
      for (const slot of this.order) byRow.set(rowOf(this.body[slot]), (byRow.get(rowOf(this.body[slot])) || 0) + 1);
      let total = 0;
      for (let row = 1; row <= 5; row++) {
        total += byRow.get(row) || 0;
        if (total >= ROW_REQUIREMENTS[row - 1]) continue;
        for (let i = this.order.length - 1; i > 0; i--) {
          if (rowOf(this.body[this.order[i]]) === row + 1) {
            this.order.splice(i, 1);
            changed = true;
            break;
          }
        }
        break;
      }
    }
    for (;;) {
      const open = unlockedRows(this.order.length);
      let index = -1;
      for (let i = this.order.length - 1; i > 0; i--) {
        if (rowOf(this.body[this.order[i]]) > open) {
          index = i;
          break;
        }
      }
      if (index < 0) break;
      this.order.splice(index, 1);
    }
    if (!this.order.length && this.mainSlot >= 0) this.order = [this.mainSlot];
  }

  // Состояние слота для поля: номер изучения, «закрыт» (ряд ещё не открыт), «окружён» (мигает:
  // со всех сторон стены или изученные — подсказка, что его пора изучить)
  slotState(slot) {
    const order = this.orderOf(slot);
    if (order) return { order };
    const learned = this.learned;
    const row = Math.floor(slot / ROW);
    const col = slot % ROW;
    const enclosed =
      (row === 0 || learned.has(slot - ROW)) &&
      (col === ROW - 1 || learned.has(slot + 1)) &&
      (row === ROW - 1 || learned.has(slot + ROW)) &&
      (col === 0 || learned.has(slot - 1));
    return { locked: rowOf(this.body[slot]) > unlockedRows(this.level), enclosed };
  }
}
