import { DOM } from './dom.js';
import { App } from './app.js';
import { Castle } from './castle.js';
import { Sound } from './sound.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';

export class Timer {
  static intervalId = false;

  static sfxOptions = 
  {
    play: false, // whether to play the sound or not, set to true when the timer is started for the current user
    lastSecond: -1, // the last second when the sound was played
    playFromSecond: 8, // from which second to play the sound (inclusive)
    sound: SOUNDS_LIBRARY.SINGLE_TIMER, // sound to play
    volumeModifier: 1, // volume modifier
  }

  static init() {
    Timer.sb = DOM(`${name} 00:00`);
    Timer.body = DOM({ style: 'mm-timer' }, Timer.sb);
  }

  // Номер запуска: stop() и каждый start() его меняют. getTimer — запрос к серверу,
  // и запуск, который за это время перебили, не должен ожить: раньше он заводил
  // второй setInterval поверх нового, и тот дёргал колбэк каждые 250 мс.
  static runId = 0;

  // Что отсчитываем сейчас ({id, name, callback}) — чтобы перезапросить время
  // после переподключения к API (resync). null — таймер остановлен или дошёл до нуля.
  static current = null;

  static GET_TIMER_ATTEMPTS = 3;

  static GET_TIMER_RETRY_MS = 1000;

  // true — таймер идёт (или уже дошёл до нуля и вызвал колбэк), false — запуск перебит.
  // Бросает, если сервер так и не ответил: тогда таймер стоит, а current остаётся для resync().
  static async start(id, name, callback) {
    Timer.stop();

    const runId = Timer.runId;

    Timer.callback = callback;

    Timer.message = name;

    Timer.current = { id, name, callback };

    Timer.sfxOptions.play = false;
    Timer.sfxOptions.lastSecond = -1;

    let timeFinish = 0;

    for (let attempt = 1; ; attempt++) {
      try {
        timeFinish = await App.api.request(App.CURRENT_MM, 'getTimer', {
          id: id,
          time: Date.now(),
        });

        break;
      } catch (error) {
        // обрыв связи или предыдущий getTimer ещё не ответил — спросим ещё раз
        if (runId !== Timer.runId) return false;
        if (attempt >= Timer.GET_TIMER_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, Timer.GET_TIMER_RETRY_MS));
        if (runId !== Timer.runId) return false;
      }
    }

    if (runId !== Timer.runId) {
      return false;
    }

    Timer.timeFinish = timeFinish;

    if (Timer.end()) {
      return true;
    }

    Timer.intervalId = setInterval(() => Timer.update(), 250);

    Timer.update();

    return true;
  }

  // Переподключились к API: перезапросить время текущего таймера. Пока связи не было,
  // запуск мог упасть (таймер стоит на месте), а события хода — потеряться.
  static async resync() {
    const current = Timer.current;

    if (!current) {
      return false;
    }

    const play = Timer.sfxOptions.play;
    const started = await Timer.start(current.id, current.name, current.callback);

    if (started && Timer.current?.callback === current.callback) {
      Timer.sfxOptions.play = play;
    }

    return started;
  }

  static update() {
    if (Timer.end()) {
      return;
    }

    let seconds = Math.round(Math.abs(Date.now() - Timer.timeFinish) / 1000);

    Timer.render(seconds);

    Timer.sfx(seconds);
  }

  static render(seconds) {
    Timer.seconds = seconds;
    Timer.sb.innerText = `${Timer.message || ''} 00:${seconds < 10 ? '0' : ''}${seconds}`;
    Timer.body.classList.toggle('mm-timer--urgent', seconds > 0 && seconds <= 8);
    Timer.updateConfirmLabel();
  }

  static updateConfirmLabel() {
    const button = Timer.body?.parentElement?.querySelector('.mm-lobby-confirm');
    if (!button || Number(button.dataset.errorUntil) > Date.now()) return;
    const urgent = !button.disabled && Timer.seconds > 0 && Timer.seconds <= 8;
    button.textContent = urgent ? button.dataset.urgentLabel : button.dataset.defaultLabel;
  }

  static end() {
    if (Date.now() - Timer.timeFinish >= 0) {
      Timer.stop();

      Timer.callback();

      return true;
    }

    return false;
  }

  static stop() {
    Timer.runId++;
    Timer.current = null;
    Timer.seconds = 0;
    Timer.updateConfirmLabel();
    Timer.body?.classList.remove('mm-timer--urgent');
    Sound.stop('timer');
    Timer.sfxOptions.play = false;
    Timer.sfxOptions.lastSecond = -1;
    if (Timer.intervalId) {
      clearInterval(Timer.intervalId);

      Timer.intervalId = false;
    }
  }

  static sfx(seconds) {
    if (!Timer.sfxOptions.play) return;
    if (seconds > Timer.sfxOptions.playFromSecond) return;
    if (seconds <= 0) return;
    if (seconds === Timer.sfxOptions.lastSecond) return;

    Sound.play(
      Timer.sfxOptions.sound, 
      { volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * Timer.sfxOptions.volumeModifier, id: 'timer' },
    );

    Timer.sfxOptions.lastSecond = seconds;
  }

  static oneSecond = 1000;
  static oneMinute = this.oneSecond * 60;
  static oneHour = this.oneMinute * 60;
  static oneDay = this.oneHour * 24;

  static getNextMoscowMidnight(now = Date.now()) {
    const offset = 3 * this.oneHour;
    return (Math.floor((now + offset) / this.oneDay) + 1) * this.oneDay - offset;
  }

  static getFormattedTimeDays(timer) {
    return Math.floor(timer / this.oneDay);
  }

  static getFormattedTimeHours(timer) {
    return Math.floor((timer / this.oneHour) % 24);
  }

  static getFormattedTimeMinutes(timer) {
    return Math.floor((timer / this.oneMinute) % 60);
  }

  static getFormattedTimeSeconds(timer) {
    return Math.floor((timer / this.oneSecond) % 60);
  }

  static getFormattedTimer(timer) {
    const days = this.getFormattedTimeDays(timer);
    const hours = this.getFormattedTimeHours(timer);
    const minutes = this.getFormattedTimeMinutes(timer);
    const seconds = this.getFormattedTimeSeconds(timer);
    let formattedDate = '';
    if (days) {
      formattedDate += `${String(days).padStart(2, '0')}:`;
    }
    if (days || hours) {
      formattedDate += `${String(hours).padStart(2, '0')}:`;
    }
    if (days || hours || minutes) {
      formattedDate += `${String(minutes).padStart(2, '0')}:`;
    }
    if (days || hours || minutes || seconds) {
      formattedDate += `${String(seconds).padStart(2, '0')}`;
    }
    return formattedDate;
  }
}
