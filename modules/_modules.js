import { Lang } from './lang.js';
import { TalentData } from './talentData.js';
import { ClientData } from './clientData/clientData.js';
import { TalentTooltip } from './clientData/talentTooltip.js';
import { ParentEvent } from './parentEvent.js';
import { View } from './view.js';
import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { Settings } from './settings.js';
import { Splash } from './splash.js';
import { MM } from './mm.js';
import { UiTooltip } from './uiTooltip.js';

// фирменные подсказки вместо стандартных title — во всём лаунчере
UiTooltip.init();

window.addEventListener('message', (event) => {
  if (event.data == '') {
    return;
  }

  if (!('action' in event.data)) {
    return;
  }

  if (event.data.action in ParentEvent) {
    ParentEvent[event.data.action](event.data.body);
  }

  console.log('event.data', event.data);
});

Promise.all([Lang.init(), TalentData.init()]).then(() => {
  Splash.init();

  NativeAPI.init();

  // данные игры из pile (подсказки талантов, статы героев) — в фоне, к открытию билда готовы
  ClientData.init()
    .then((ready) => ready && TalentTooltip.warmUp())
    .catch((error) => console.warn('ClientData: прогрев не удался', error));

  // Bootstrap-канал (legacy content-test): замок между стадиями обновления показывать нельзя —
  // ассеты придут только со второй стадии, поэтому прогресс обновления — полноэкранный Splash.
  View.bootstrapContent = NativeAPI.bootstrapContent();

  NativeAPI.update((data) => {
    // идущий поиск боя останавливаем: игра не должна запуститься, пока апдейтер пишет её файлы
    if (data.update && !View.updateProgress) MM.onUpdateStarted();
    View.updateIndicator(data);
  }).catch((e) => NativeAPI.logUpdateError(e, 'update'));

  Settings.init().then(() => {
    App.connectAndInit();
  });
});
