// Перестановки поля целиком: раскладка сетов по колонкам, зеркало, классовые таланты на одну
// сторону. Все функции чистые: берут массив 36 талантов и возвращают новый (та же раскладка
// по рядам — таланты меняются местами только внутри своего ряда).

import { rowSlots, ROW } from './grid.js';
import { Sets } from './sets.js';

const isClass = (talent) => !!talent && Number(talent.id) < 0;
const LEFT = [0, 1, 2];
const RIGHT = [3, 4, 5];

function swap(body, a, b) {
  const t = body[a];
  body[a] = body[b];
  body[b] = t;
}

// Сторона, где классовых талантов больше; поровну или нет ни одного — null
function majorClassSide(body) {
  let left = 0;
  let right = 0;
  body.forEach((talent, slot) => {
    if (isClass(talent)) LEFT.includes(slot % ROW) ? left++ : right++;
  });
  return left === right ? null : left > right ? LEFT : RIGHT;
}

// Есть классовые таланты не на своей стороне
export function hasDetachedClassTalents(body) {
  const major = majorClassSide(body);
  return !!major && body.some((talent, slot) => isClass(talent) && !major.includes(slot % ROW));
}

// Классовые таланты каждого ряда — на сторону, где их больше
function gatherClassTalents(body) {
  const major = majorClassSide(body);
  if (!major) return;
  for (let level = 6; level >= 1; level--) {
    const slots = rowSlots(level);
    const minor = slots.filter((slot, col) => isClass(body[slot]) && !major.includes(col));
    if (!minor.length) continue;
    const targets = major.map((col) => slots[col]).filter((slot) => !isClass(body[slot]));
    for (const source of minor) {
      const target = targets.shift();
      if (target === undefined) break;
      swap(body, source, target);
    }
  }
}

// Зеркало: колонки 0..5 -> 5..0 в каждом ряду
export function mirror(input) {
  const body = input.slice();
  for (let level = 6; level >= 1; level--) {
    const slots = rowSlots(level);
    for (let col = 0; col < 3; col++) swap(body, slots[col], slots[ROW - 1 - col]);
  }
  return body;
}

// ПКМ по кнопке сортировки: классовые не на своей стороне — собрать их, отзеркалить и разложить
// сеты; иначе только зеркало
export function mirrorOrGather(input) {
  if (!hasDetachedClassTalents(input)) return mirror(input);
  const body = input.slice();
  gatherClassTalents(body);
  return sortSetsIntoColumns(mirror(body));
}

// Вес сета при раскладке: больше талантов и сплошнее по рядам — раньше и важнее
function setWeight(count, rows) {
  if (count <= 0) return 0;
  if (count === 1 || rows.length <= 1) return 1; // все в одном ряду — как одиночные
  const contiguous = rows[rows.length - 1] - rows[0] + 1 === rows.length;
  if (count === 6) return 10;
  if (count === 5) return contiguous ? 9 : 8;
  if (count === 4) return contiguous ? 7 : 6;
  if (count === 3) return contiguous ? 5 : 4;
  if (count === 2) return contiguous ? 3 : 2;
  return 1;
}

const bitCount6 = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1) + ((m >> 5) & 1);

// Раскладка талантов одного сета в одну колонку (две — у больших сетов), снизу вверх.
// Классовые таланты не двигаются. Жадные перестановки внутри рядов по оценке доски.
export function sortSetsIntoColumns(input) {
  const body = input.slice();
  const setAt = (slot) => {
    const id = Number(body[slot]?.id);
    return id > 0 ? Sets.ofTalent(id)?.key || null : null;
  };
  const fixed = new Set();
  const counts = new Map();
  const rowsBySet = new Map();
  for (let level = 6; level >= 1; level--) {
    const seen = new Set();
    for (const slot of rowSlots(level)) {
      if (!body[slot]) continue;
      if (isClass(body[slot])) {
        fixed.add(slot);
        continue;
      }
      const key = setAt(slot);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
      seen.add(key);
    }
    for (const key of seen) {
      if (!rowsBySet.has(key)) rowsBySet.set(key, new Set());
      rowsBySet.get(key).add(level);
    }
  }
  const weightOf = (key) => setWeight(counts.get(key) || 0, [...(rowsBySet.get(key) || [])].sort((a, b) => a - b));
  const weight = new Map();
  const keys = [...counts.keys()].sort((a, b) => {
    const wa = weightOf(a);
    const wb = weightOf(b);
    if (wb !== wa) return wb - wa;
    const ca = counts.get(a) || 0;
    const cb = counts.get(b) || 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });
  for (const key of keys) weight.set(key, weightOf(key));
  const rank = new Map(keys.map((key, i) => [key, i]));
  const colsOf = (slots, key) => slots.map((_, col) => col).filter((col) => setAt(slots[col]) === key);

  // колонки сета: сколько рядов, где сет есть в колонке
  const columnSupport = () => {
    const support = new Map();
    for (let level = 6; level >= 1; level--) {
      const slots = rowSlots(level);
      const byRow = new Map();
      slots.forEach((slot, col) => {
        const key = setAt(slot);
        if (!key) return;
        if (!byRow.has(key)) byRow.set(key, new Set());
        byRow.get(key).add(col);
      });
      for (const [key, cols] of byRow) {
        if (!support.has(key)) support.set(key, new Array(ROW).fill(0));
        for (const col of cols) support.get(key)[col] += 1;
      }
    }
    return support;
  };

  // Оценка доски на битовых масках: высокие колонки, сплошные столбцы, соседство в ряду
  const scoreKeys = [...counts.keys()];
  const scoreIndex = new Map(scoreKeys.map((key, i) => [key, i]));
  const scoreWeight = scoreKeys.map((key) => Math.max(1, weight.get(key) || 1));
  const scoreTotal = scoreKeys.map((key) => counts.get(key) || 0);
  const masks = new Int32Array(scoreKeys.length * 7);
  const hist = new Int32Array(ROW);
  const levelSlots = [null, ...[1, 2, 3, 4, 5, 6].map(rowSlots)];
  const evaluate = () => {
    masks.fill(0);
    for (let level = 1; level <= 6; level++) {
      for (let col = 0; col < ROW; col++) {
        const index = scoreIndex.get(setAt(levelSlots[level][col]));
        if (index !== undefined) masks[index * 7 + level] |= 1 << col;
      }
    }
    let score = 0;
    for (let index = 0; index < scoreKeys.length; index++) {
      const base = index * 7;
      let present = false;
      hist.fill(0);
      for (let level = 1; level <= 6; level++) {
        const m = masks[base + level];
        if (!m) continue;
        present = true;
        for (let col = 0; col < ROW; col++) if (m & (1 << col)) hist[col]++;
      }
      if (!present) continue;
      const w = scoreWeight[index];
      let bestCol = 0;
      for (let col = 1; col < ROW; col++) if (hist[col] > hist[bestCol]) bestCol = col;
      score += w * hist[bestCol] * hist[bestCol] * 40;
      let streak = 0;
      let bestStreak = 0;
      for (let level = 6; level >= 1; level--) {
        if (masks[base + level] & (1 << bestCol)) bestStreak = Math.max(bestStreak, ++streak);
        else streak = 0;
      }
      score += w * bestStreak * bestStreak * 20;
      // у больших сетов вторая колонка рядом — тоже форма
      if (scoreTotal[index] >= 4) {
        let second = bestCol === 0 ? 1 : 0;
        for (let col = 0; col < ROW; col++) if (col !== bestCol && hist[col] > hist[second]) second = col;
        score += w * hist[second] * hist[second] * 22;
        if (Math.abs(second - bestCol) === 1) score += w * 35;
      }
      for (let level = 1; level <= 6; level++) {
        const m = masks[base + level];
        const count = bitCount6(m);
        if (count < 2) continue;
        score += w * 12 * bitCount6(m & (m >> 1));
        const spread = 31 - Math.clz32(m) - (31 - Math.clz32(m & -m));
        if (spread > count - 1) score -= (spread - count + 1) * w * 8;
      }
      for (let level = 1; level <= 5; level++) {
        const overlap = bitCount6(masks[base + level] & masks[base + level + 1]);
        if (overlap > 0) score += w * overlap * overlap * 18;
      }
    }
    return score;
  };

  // одиночный талант сета в ряду, у которого есть опора сверху/снизу или в колонке, не трогаем
  const protectedCols = (level, slots, rowCount, support) => {
    const above = level < 6 ? rowSlots(level + 1) : null;
    const below = level > 1 ? rowSlots(level - 1) : null;
    const result = new Set();
    slots.forEach((slot, col) => {
      if (fixed.has(slot)) return result.add(col);
      const key = setAt(slot);
      if (!key || (rowCount.get(key) || 0) !== 1) return;
      const columnSupport = support.get(key)?.[col] || 0;
      if ((above && setAt(above[col]) === key) || (below && setAt(below[col]) === key) || columnSupport > 1) result.add(col);
    });
    return result;
  };

  let improved = true;
  for (let pass = 0; improved && pass < 10; pass++) {
    improved = false;
    const support = columnSupport();
    // целевая колонка сета — левая колонка в самом нижнем ряду, где он есть
    const target = new Map();
    for (const key of keys) {
      const weighted = new Array(ROW).fill(0);
      let anchor = null;
      for (let level = 1; level <= 6; level++) {
        const cols = colsOf(rowSlots(level), key);
        if (!cols.length) continue;
        const rowWeight = (7 - level) * (7 - level);
        weighted[cols[0]] += rowWeight;
        for (const col of cols) weighted[col] += rowWeight;
        anchor ??= cols[0];
      }
      const hist = support.get(key) || new Array(ROW).fill(0);
      const ranked = [0, 1, 2, 3, 4, 5].sort((a, b) => weighted[b] - weighted[a] || hist[b] - hist[a] || a - b);
      target.set(key, anchor ?? ranked[0]);
    }

    // направленный проход снизу вверх: таланты сета — в его колонку
    for (const key of keys) {
      const col = target.get(key);
      const w = weight.get(key) || 0;
      if (!Number.isFinite(col) || w <= 0) continue;
      for (let level = 1; level <= 6; level++) {
        const slots = rowSlots(level);
        const cols = colsOf(slots, key);
        if (!cols.length) continue;
        const from = cols.slice().sort((a, b) => Math.abs(a - col) - Math.abs(b - col))[0];
        if (from === col || fixed.has(slots[from]) || fixed.has(slots[col])) continue;
        const other = setAt(slots[col]);
        if (other && other !== key) {
          const otherWeight = weight.get(other) || 0;
          if (otherWeight > w) continue;
          // равный вес: более приоритетный сет из своей колонки не вытесняем (иначе качели)
          if (otherWeight === w && rank.get(other) < rank.get(key) && target.get(other) === col) continue;
        }
        swap(body, slots[from], slots[col]);
        improved = true;
      }
    }

    // жадный проход по рядам: лучшая по оценке перестановка двух слотов ряда
    for (let level = 1; level <= 6; level++) {
      const slots = rowSlots(level);
      const rowCount = new Map();
      for (const slot of slots) {
        const key = setAt(slot);
        if (key) rowCount.set(key, (rowCount.get(key) || 0) + 1);
      }
      const guarded = protectedCols(level, slots, rowCount, support);
      const movable = [0, 1, 2, 3, 4, 5].filter((col) => !guarded.has(col) && !fixed.has(slots[col]));
      if (movable.length < 2) continue;
      const base = evaluate();
      let best = null;
      for (let i = 0; i < movable.length; i++) {
        for (let j = i + 1; j < movable.length; j++) {
          const c1 = movable[i];
          const c2 = movable[j];
          const s1 = slots[c1];
          const s2 = slots[c2];
          if (isClass(body[s1]) || isClass(body[s2])) continue;
          if (!allowSwap(setAt(s1), setAt(s2), c1, c2, weight, counts, support)) continue;
          swap(body, s1, s2);
          const score = evaluate();
          swap(body, s1, s2);
          if (score > base + 0.001 && (!best || score > best.score)) best = { s1, s2, score };
        }
      }
      if (!best) continue;
      swap(body, best.s1, best.s2);
      improved = true;
    }
  }
  return body;
}

// Перестановка двух талантов разных сетов не должна портить форму более сильного сета
function allowSwap(k1, k2, c1, c2, weight, counts, support) {
  if (!k1 || !k2 || k1 === k2) return true;
  const w1 = weight.get(k1) || 0;
  const w2 = weight.get(k2) || 0;
  if (w1 === w2) return true;
  const [strong, strongCol, strongTo, weak, weakFrom, weakTo] = w1 > w2 ? [k1, c1, c2, k2, c2, c1] : [k2, c2, c1, k1, c1, c2];
  const strongHist = support.get(strong) || new Array(ROW).fill(0);
  const weakHist = support.get(weak) || new Array(ROW).fill(0);
  // у сильного сета есть опора в колонке — в чужую колонку его не уводим
  if (strongHist[strongCol] > 1 && strongHist[strongTo] <= 0) return false;
  // сильный теряет опору, а слабый ничего не теряет — нет
  if (strongHist[strongTo] < strongHist[strongCol] && strongHist[strongCol] > 1 && weakHist[weakTo] >= weakHist[weakFrom]) return false;
  // ядро большого сета (две колонки по 2+ таланта) не разбираем
  if ((counts.get(strong) || 0) >= 4) {
    let top1 = 0;
    for (let col = 1; col < ROW; col++) if (strongHist[col] > strongHist[top1]) top1 = col;
    let top2 = top1 === 0 ? 1 : 0;
    for (let col = 0; col < ROW; col++) if (col !== top1 && strongHist[col] > strongHist[top2]) top2 = col;
    const core = new Set([top1, top2].filter((col) => strongHist[col] > 1));
    if (core.has(strongCol) && !core.has(strongTo)) return false;
  }
  return true;
}
