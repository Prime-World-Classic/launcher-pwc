// Esc в лаунчере срабатывает при отпускании и только если клавишу держали меньше секунды.
//
// Зачем. При удержании Esc автоповтор присылает keydown десятки раз в секунду, и меню
// открывалось и закрывалось много раз. А через ~1,5 с удержания Chromium внутри NW 0.103
// (функция PressAndHoldEscToExitBrowserFullscreen) выводит окно из полноэкранного режима.
// Отменить это со страницы нельзя: preventDefault на keydown не помогает (проверено на NW 0.103.1).
// Выход из полного экрана Settings.watchFullscreen отражает в галочке «Оконный режим».
//
// Как. Настоящие keydown Esc перехватываются на window в фазе захвата, раньше всех обработчиков,
// и дальше не идут. При отпускании, если Esc держали меньше HOLD_LIMIT_MS, тому же элементу
// отправляется один синтетический keydown Esc — обработчики в модулях остаются на keydown
// и ничего о перехвате не знают.
export class EscKey {
  static HOLD_LIMIT_MS = 1000;
  static installed = false;
  static pressedAt = 0;
  static pressed = null; // { target, code, ctrlKey, shiftKey, altKey, metaKey }
  static replaying = null;

  static install() {
    if (EscKey.installed) return;
    EscKey.installed = true;
    window.addEventListener('keydown', EscKey.onKeyDown, true);
    window.addEventListener('keyup', EscKey.onKeyUp, true);
    window.addEventListener('blur', EscKey.reset);
  }

  static isEsc(e) {
    return e.key === 'Escape' || e.key === 'Esc';
  }

  static reset() {
    EscKey.pressedAt = 0;
    EscKey.pressed = null;
  }

  static onKeyDown(e) {
    if (!EscKey.isEsc(e) || e === EscKey.replaying) return;
    // Штатные действия Esc (закрытие <dialog> и т. п.) раньше гасил общий обработчик в app.js;
    // теперь он получит только синтетическое событие, поэтому гасим здесь.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat || EscKey.pressed) return;
    EscKey.pressedAt = performance.now();
    EscKey.pressed = {
      target: e.target,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    };
  }

  static onKeyUp(e) {
    if (!EscKey.isEsc(e)) return;
    const pressed = EscKey.pressed;
    const heldMs = performance.now() - EscKey.pressedAt;
    EscKey.reset();
    if (!pressed || heldMs >= EscKey.HOLD_LIMIT_MS) return;

    const target = pressed.target?.isConnected ? pressed.target : document.activeElement || document.body;
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: pressed.code || 'Escape',
      keyCode: 27,
      which: 27,
      ctrlKey: pressed.ctrlKey,
      shiftKey: pressed.shiftKey,
      altKey: pressed.altKey,
      metaKey: pressed.metaKey,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    EscKey.replaying = event;
    try {
      target.dispatchEvent(event);
    } finally {
      EscKey.replaying = null;
    }
  }
}
