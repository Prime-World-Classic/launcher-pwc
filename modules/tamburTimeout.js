// Время хода в тамбуре вышло по часам лаунчера — что делать с тамбуром.
//
// Лаунчер считает дедлайн хода как «остаток на сервере + время отправки
// getTimer», без задержки сети, поэтому его таймер доходит до нуля раньше
// серверного. Сервер принимает героя, пока не вышел его собственный таймер
// (mm.hero → Timer.check), и сам рассылает, чем закончился ход: MMHero
// (следующий ход), MMKick (АФК), MMStart/MMReady (замена), MMEnd (бой).
// Раньше лаунчер по нулю сразу закрывал тамбур: выбор в последний миг сервер
// принимал, а игрока выкидывало из тамбура, хотя лобби жило (вернуть могла
// только перезагрузка лаунчера).
//
// Теперь по нулю тамбур остаётся открытым, а решает сервер:
// - пришло событие лобби (тамбур перерисован или закрыт) — isAlive() = false,
//   ничего не делаем;
// - getTimer > 0 — идёт следующий ход, перезапускаем таймер (restart);
// - таймера нет, но lobbySnapshot отвечает — лобби живо (например, идёт
//   запуск боя), ждём дальше;
// - lobbySnapshot отказал — лобби на сервере нет, тамбур закрываем (close).
// Если сервер так и не ответил за maxChecks проверок — закрываем, как раньше.
export const TAMBUR_TIMEOUT_GRACE_MS = 3000;
export const TAMBUR_TIMEOUT_MAX_CHECKS = 5;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} options
 * @param {string} options.lobbyId
 * @param {(method: string, data: object) => Promise<any>} options.request запрос к текущему mm
 * @param {() => boolean} options.isAlive тамбур этого лобби всё ещё открыт и ждёт решения
 * @returns {Promise<'stale'|'restart'|'close'>}
 */
export async function resolveTamburTimeout({
  lobbyId,
  request,
  isAlive,
  now = () => Date.now(),
  sleep = delay,
  graceMs = TAMBUR_TIMEOUT_GRACE_MS,
  maxChecks = TAMBUR_TIMEOUT_MAX_CHECKS,
}) {
  for (let check = 0; check < maxChecks; check++) {
    await sleep(graceMs);

    if (!isAlive()) {
      return 'stale';
    }

    let finish = 0;

    try {
      finish = Number(await request('getTimer', { id: lobbyId, time: now() })) || 0;
    } catch (error) {
      // сеть или бэкенд не ответили — спросим ещё раз
      continue;
    }

    if (!isAlive()) {
      return 'stale';
    }

    if (finish > now()) {
      return 'restart';
    }

    try {
      await request('lobbySnapshot', { id: lobbyId });
    } catch (error) {
      return isAlive() ? 'close' : 'stale';
    }

    if (!isAlive()) {
      return 'stale';
    }
  }

  return isAlive() ? 'close' : 'stale';
}
