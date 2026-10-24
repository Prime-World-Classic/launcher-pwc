// Синхронизация билда с сервером. Окно меняет билд у себя сразу и отдаёт сюда итог (поле и
// панель активных); на сервер уходит одна правка build.optimisticLayout с итогом. Старый
// бэкенд без неё получает те же правки по шагам (remove/swap/set/setActive/clearActive),
// которые сервер повторяет у себя так же, как simulate() здесь. Пока правка в пути, новые
// итоги не копятся: уходит только последний.

import { App } from '../app.js';
import { ACTIVE_SLOTS, SLOTS } from './grid.js';

const ids = (body) => Array.from({ length: SLOTS }, (_, i) => Number(body[i]?.id ?? body[i]) || 0);
const actives = (active) => Array.from({ length: ACTIVE_SLOTS }, (_, i) => Number(active[i]) || 0);
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

// Правка сервера (build.model.js validateAndApplyOptimisticAction) без проверок
export function simulate(state, { method, data }) {
  const body = state.body.slice();
  let active = state.active.slice();
  const clearRefs = (pos) => (active = active.map((item) => (Math.abs(item) === pos ? 0 : item)));
  switch (method) {
    case 'optimisticSet': {
      const id = Number(data.talentId);
      body.forEach((item, i) => {
        if (item === id && i !== data.index) {
          body[i] = 0;
          clearRefs(i + 1);
        }
      });
      body[data.index] = id;
      break;
    }
    case 'optimisticRemove':
      if (body[data.index]) {
        body[data.index] = 0;
        clearRefs(data.index + 1);
      }
      break;
    case 'optimisticSwap': {
      const p1 = data.i1 + 1;
      const p2 = data.i2 + 1;
      const has1 = active.some((item) => Math.abs(item) === p1);
      const has2 = active.some((item) => Math.abs(item) === p2);
      // ссылка панели переезжает за талантом, только если на панели один из двух
      if (has1 !== has2) {
        const [from, to] = has1 ? [p1, p2] : [p2, p1];
        active = active.map((item) => (Math.abs(item) === from ? Math.sign(item) * to : item));
      }
      [body[data.i1], body[data.i2]] = [body[data.i2], body[data.i1]];
      break;
    }
    case 'optimisticSetActive':
      active = active.map((item, i) => (i !== data.index && Math.abs(item) === Math.abs(data.position) ? 0 : item));
      active[data.index] = data.position;
      break;
    case 'optimisticClearActive':
      active[data.index] = 0;
      break;
  }
  return { body, active };
}

// Шаги от состояния сервера к нужному: снять лишнее, переставить, поставить новое, панель
export function diff(server, target) {
  const ops = [];
  let state = { body: server.body.slice(), active: server.active.slice() };
  const run = (method, data) => {
    ops.push({ method, data });
    state = simulate(state, { method, data });
  };
  const wanted = new Set(target.body.filter(Boolean));
  state.body.forEach((id, index) => {
    if (id && !wanted.has(id)) run('optimisticRemove', { index });
  });
  for (let i = 0; i < SLOTS; i++) {
    const id = target.body[i];
    if (!id || state.body[i] === id) continue;
    const from = state.body.indexOf(id);
    if (from >= 0) run('optimisticSwap', { i1: i, i2: from });
  }
  for (let index = 0; index < SLOTS; index++) {
    if (target.body[index] && state.body[index] !== target.body[index]) run('optimisticSet', { index, talentId: target.body[index] });
  }
  for (let pass = 0; pass < 2 && !same(state.active, target.active); pass++) {
    for (let index = 0; index < ACTIVE_SLOTS; index++) {
      const position = target.active[index];
      if (position && state.active[index] !== position) run('optimisticSetActive', { index, position });
    }
    for (let index = 0; index < ACTIVE_SLOTS; index++) {
      if (!target.active[index] && state.active[index]) run('optimisticClearActive', { index });
    }
  }
  return ops;
}

export class BuildSync {
  static layoutSupported = true; // бэкенд без optimisticLayout отвечает «Not method»

  // onReject({ body, active, reason }) — сервер не принял правку, его состояние в ответе
  constructor(buildId, body, active, { onReject = () => {}, request = (...args) => App.api.request(...args) } = {}) {
    this.buildId = buildId;
    this.server = { body: ids(body), active: actives(active) };
    this.target = null;
    this.running = null;
    this.onReject = onReject;
    this.request = request;
  }

  // новый итог билда; ответ — когда сервер принял всё, что было до этого вызова
  push(body, active) {
    this.target = { body: ids(body), active: actives(active) };
    return this.flush();
  }

  // все правки ушли и подтверждены
  idle() {
    return this.running || Promise.resolve();
  }

  flush() {
    this.running ??= this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async loop() {
    while (this.target) {
      const target = this.target;
      if (same(target.body, this.server.body) && same(target.active, this.server.active)) {
        if (this.target === target) this.target = null;
        continue;
      }
      try {
        const ok = BuildSync.layoutSupported ? await this.sendLayout(target) : await this.sendSteps(target);
        if (!ok) return;
      } catch (error) {
        // связь, таймаут — состояние сервера неизвестно: окно перечитает билд
        this.target = null;
        this.onReject({ reason: 'talentAnomalyUnknown', error });
        return;
      }
      if (this.target === target) this.target = null;
    }
  }

  async sendLayout(target) {
    let result;
    try {
      result = await this.request('build', 'optimisticLayout', { buildId: this.buildId, body: target.body, active: target.active });
    } catch (error) {
      if (!String(error?.message ?? error).includes('Not method')) throw error;
      BuildSync.layoutSupported = false;
      return this.sendSteps(target);
    }
    return this.accept(result, target);
  }

  async sendSteps(target) {
    for (const op of diff(this.server, target)) {
      const result = await this.request('build', op.method, { buildId: this.buildId, ...op.data });
      if (!this.accept(result, simulate(this.server, op))) return false;
    }
    return true;
  }

  // ответ сервера: { ok, reason, rollback: { body, active } } (старые ответы без ok — успех)
  accept(result, next) {
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok) {
      this.server = { body: next.body.slice(), active: next.active.slice() };
      return true;
    }
    this.target = null;
    const rollback = result.rollback;
    if (Array.isArray(rollback?.body) && Array.isArray(rollback?.active)) {
      this.server = { body: ids(rollback.body), active: actives(rollback.active) };
    }
    this.onReject({ reason: result.reason, body: rollback ? this.server.body : null, active: rollback ? this.server.active : null });
    return false;
  }
}
