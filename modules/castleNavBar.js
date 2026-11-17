import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { Division } from './division.js';
import { App } from './app.js';
import { MM } from './mm.js';
import { domAudioPresets } from './domAudioPresets.js';
import { Settings } from './settings.js';

export class CastleNAVBAR {
  static state = false;

  static mode = 0;

  static stateDefaultMode = 0;

  static modeMenuCloseTimer = null;

  // Число игроков в режимах (id режима бэкенда → { limit, oneteam }), подставляется
  // в описания вместо {team}/{players}. limit правят из веб-админки, поэтому берём
  // его из бэкенда (mm.modeTeams); пока ответа нет — значения по умолчанию бэкенда.
  static modeTeams = {
    0: { limit: 10 },
    1: { limit: 6 },
    2: { limit: 8 },
    3: { limit: 10 },
    4: { limit: 10, oneteam: true },
    5: { limit: 2 },
    99: { limit: 1 },
  };

  static modeTeamsLoadedAt = 0;

  // Тренировка (режим 99 бэкенда): бой с манекенами и ботами сразу, без поиска — то же,
  // что кнопка «Тренировка» в билде (MM.startTraining). Режим локальный: в пати не
  // синхронизируется, очереди и бана поиска у него нет.
  static TRAINING_MODE = 99;

  // Режимы в списке по порядку (id бэкенда). Кнопки 0..5 — children[11..16],
  // тренировка — отдельный элемент trainingButton (индексы children[17+] заняты).
  static MODES = [0, 1, 2, 3, 4, 5, 99];

  static trainingButton = null;

  static modeButton(modeId) {
    if (!CastleNAVBAR.MODES.includes(modeId)) {
      return null;
    }

    return modeId === CastleNAVBAR.TRAINING_MODE ? CastleNAVBAR.trainingButton : CastleNAVBAR.body.children[11 + modeId];
  }

  // ключ строк режима: gm1..gm6, тренировка — gm7
  static modeKey(modeId) {
    return `gm${modeId === CastleNAVBAR.TRAINING_MODE ? 7 : modeId + 1}`;
  }

  static isTraining() {
    return CastleNAVBAR.mode === CastleNAVBAR.TRAINING_MODE;
  }

  // Бан поиска (mm.searchBan): за неподтверждённый «бой найден» или АФК в тамбуре.
  // Бэкенд отдаёт остаток в секундах, дальше отсчитываем сами: кнопка «В бой!»
  // серая и показывает м:сс. searchBanInfo — { reason: 'ready'|'tambour', nickname }.
  static searchBanUntil = 0;

  static searchBanInfo = null;

  static searchBanTimer = 0;

  static fightLabel() {
    return App.CURRENT_MM == 'mmtest' ? Lang.text('fight') + ' test' : Lang.text('fight');
  }

  static searchBanLeft() {
    return Math.max(0, Math.ceil((CastleNAVBAR.searchBanUntil - Date.now()) / 1000));
  }

  static searchBanText() {
    const info = CastleNAVBAR.searchBanInfo || {};

    const text = Lang.text(info.reason == 'tambour' ? 'searchBanTambour' : 'searchBanReady');

    return info.nickname ? text.replace('{nickname}', info.nickname) : text.replace(/\s*\(\{nickname\}\)/, '');
  }

  // Подпись и вид кнопки «В бой!», пока поиск не идёт (в поиске — «Отмена», см. play).
  static renderFightButton() {
    const button = CastleNAVBAR.body?.children[5];

    if (!button || CastleNAVBAR.state) {
      return;
    }

    const left = CastleNAVBAR.searchBanLeft();

    if (!left) {
      button.innerText = CastleNAVBAR.fightLabel();
      button.style.filter = '';
      button.dataset.tooltip = Lang.text('fightButtonTooltip');
      return;
    }

    button.innerText = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    button.style.filter = 'grayscale(85%) brightness(0.8)';
    button.dataset.tooltip = CastleNAVBAR.searchBanText();
  }

  static setSearchBan(data) {
    const seconds = Math.max(0, Number(data?.seconds) || 0);

    CastleNAVBAR.searchBanInfo = data || null;
    CastleNAVBAR.searchBanUntil = seconds ? Date.now() + seconds * 1000 : 0;

    clearInterval(CastleNAVBAR.searchBanTimer);
    CastleNAVBAR.searchBanTimer = 0;

    if (seconds) {
      CastleNAVBAR.searchBanTimer = setInterval(() => {
        if (CastleNAVBAR.searchBanLeft()) {
          CastleNAVBAR.renderFightButton();
          return;
        }

        clearInterval(CastleNAVBAR.searchBanTimer);
        CastleNAVBAR.searchBanTimer = 0;
        CastleNAVBAR.renderFightButton();

        // у другого участника пати может остаться свой бан (тамбур) — спросим ещё раз
        CastleNAVBAR.refreshSearchBan();
      }, 1000);
    }

    CastleNAVBAR.renderFightButton();
  }

  static async refreshSearchBan() {
    if (CastleNAVBAR.isTraining()) {
      CastleNAVBAR.setSearchBan(null);
      return;
    }

    try {
      CastleNAVBAR.setSearchBan(await App.api.request(App.CURRENT_MM, 'searchBan', { mode: CastleNAVBAR.mode }));
    } catch (e) {
      // бэкенд без searchBan (ещё не выкачен) — кнопка как раньше, бан проверит start
    }
  }

  static plural(value, forms) {
    const list = String(forms).split('|'),
      n = Math.abs(parseInt(value, 10)) || 0;

    if (list.length < 3) {
      return n == 1 ? list[0] : list[1] || list[0];
    }

    const d10 = n % 10,
      d100 = n % 100;

    if (d10 == 1 && d100 != 11) return list[0];

    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return list[1];

    return list[2];
  }

  static modeHoverText(modeId, hoverKey) {
    const team = CastleNAVBAR.modeTeams[modeId] || {};
    const limit = Number(team.limit) || 0;
    const size = team.oneteam ? limit : Math.max(1, Math.floor(limit / 2));

    return Lang.text(hoverKey)
      .replace(/^.*?\\A/, '')
      .replaceAll('{team}', Lang.text('gmTeam').replaceAll('{n}', size))
      .replaceAll('{players}', `${limit} ${CastleNAVBAR.plural(limit, Lang.text('gmPlayers'))}`);
  }

  static applyModeTooltips() {
    for (const modeId of CastleNAVBAR.MODES) {
      CastleNAVBAR.setModeTooltip(CastleNAVBAR.modeButton(modeId), modeId);
    }

    // круг выбранного режима над «В бой»
    CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[9], CastleNAVBAR.mode);
  }

  // Перечитывает число игроков не чаще раза в минуту (при открытии списка режимов).
  static async loadModeTeams() {
    if (Date.now() - CastleNAVBAR.modeTeamsLoadedAt < 60000) {
      return;
    }

    CastleNAVBAR.modeTeamsLoadedAt = Date.now();

    let response;

    try {
      response = await App.api.request(App.CURRENT_MM, 'modeTeams');
    } catch (error) {
      return;
    }

    if (!response || typeof response !== 'object') {
      return;
    }

    for (const modeId in CastleNAVBAR.modeTeams) {
      const limit = Number(response[modeId]?.limit);

      if (Number.isInteger(limit) && limit > 0) {
        CastleNAVBAR.modeTeams[modeId] = { limit, oneteam: Boolean(response[modeId].oneteam) };
      }
    }

    CastleNAVBAR.applyModeTooltips();
  }

  static setModeTooltip(element, modeId) {
    const key = CastleNAVBAR.modeKey(modeId);
    const title = Lang.text(key);
    const hoverText = CastleNAVBAR.modeHoverText(modeId, `${key}_hover`);
    element.style.setProperty('--filter-text', `'${title}'`);
    element.style.setProperty('--filter-text-title', `'${title}'`);
    element.style.setProperty('--filter-text-hover', `'${hoverText}'`);
  }

  static init() {
    let items = [
      'castle-button-play-l1',
      'castle-button-play-4',
      'castle-button-play-5',
      'castle-button-play-6',
      'castle-button-play-7',
      'castle-button-play-3',
      'castle-button-play-mode',
      'castle-button-play-1',
      'castle-button-play-2',
      'castle-button-play-8',
      'castle-button-play-9',
      'castle-button-play-m1',
      'castle-button-play-m2',
      'castle-button-play-m3',
      'castle-button-play-m4',
      'castle-button-play-m5',
      'castle-button-play-m6',
      'castle-button-play-division',
      'castle-button-play-karma',
    ];

    CastleNAVBAR.body = DOM({ style: 'castle-button-play' });

    for (let item of items) {
      CastleNAVBAR.body.append(DOM({domaudio: domAudioPresets.defaultButton, style: item }));
    }

    // кнопка режима «Тренировка» — после всех индексированных детей, чтобы не сдвигать их
    CastleNAVBAR.trainingButton = DOM({ domaudio: domAudioPresets.defaultButton, style: 'castle-button-play-m7' });
    CastleNAVBAR.body.append(CastleNAVBAR.trainingButton);

    CastleNAVBAR.body.children[3].onclick = () => {};

    CastleNAVBAR.body.children[4].onclick = () => {};

    for (const index of [3, 4]) {
      CastleNAVBAR.body.children[index].append(DOM({ style: ['account-rating-tooltip', 'castle-training-tooltip'] },
        DOM({ style: 'account-rating-tooltip-title' }, Lang.text('trainingBotsTooltipTitle')),
        DOM({ style: 'account-rating-tooltip-body' }, Lang.text('trainingBotsTooltipBody')),
      ));
    }

    CastleNAVBAR.renderFightButton();
    /*
        CastleNAVBAR.body.children[5].onclick = () => {
            
            if(CastleNAVBAR.state){
                
                CastleNAVBAR.cancel();
                
            }
            else{
                
                CastleNAVBAR.play();
                
            }
            
        }
        */
    // Два вида списка режимов (Доп. настройки → castleModesWings, applyModeView):
    // по умолчанию — меню, которое открывается при наведении на круг режима и закрывается,
    // когда курсор ушёл и с круга, и с панели (с задержкой, чтобы успеть перевести мышь);
    // «крылья» — все режимы видны всегда: выбранный в круге, остальные слева и справа
    // от слотов пати (layoutModes). Число игроков в подсказках обновляем при наведении.
    CastleNAVBAR.body.children[9].onclick = () => {
      if (!CastleNAVBAR.isWingsView()) {
        CastleNAVBAR.openModeMenu();
      }
    };

    for (const element of [CastleNAVBAR.body.children[9], CastleNAVBAR.body.children[10], ...CastleNAVBAR.MODES.map((modeId) => CastleNAVBAR.modeButton(modeId))]) {
      element.addEventListener('mouseenter', () => {
        if (CastleNAVBAR.isWingsView()) {
          CastleNAVBAR.loadModeTeams();
        } else if (element === CastleNAVBAR.body.children[9]) {
          CastleNAVBAR.openModeMenu();
        } else {
          clearTimeout(CastleNAVBAR.modeMenuCloseTimer);
        }
      });
      element.addEventListener('mouseleave', () => {
        if (!CastleNAVBAR.isWingsView()) {
          CastleNAVBAR.closeModeMenuSoon();
        }
      });
    }

    CastleNAVBAR.wings = [DOM({ style: 'castle-button-play-wing' }), DOM({ style: 'castle-button-play-wing' })];
    CastleNAVBAR.body.append(...CastleNAVBAR.wings);

    // бейдж на правом верхнем «плече» круга режима: сколько игроков ищут бой в выбранном режиме
    CastleNAVBAR.queuePlate = DOM({ style: 'castle-button-play-queue', data: { tooltip: Lang.text('mmQueueTooltip') } });
    CastleNAVBAR.body.children[9].append(CastleNAVBAR.queuePlate);

    // кнопки режимов: бейдж «в поиске» (у тренировки очереди нет) и выбор режима;
    // подсказки ставит applyModeView → applyModeTooltips
    for (const modeId of CastleNAVBAR.MODES) {
      const element = CastleNAVBAR.modeButton(modeId);

      if (modeId !== CastleNAVBAR.TRAINING_MODE) {
        element.append(DOM({ style: 'castle-button-play-queue-mode' }));
      }

      element.onclick = () => {
        CastleNAVBAR.setMode(modeId + 1);
      };
    }

    const karmaButton = CastleNAVBAR.body.children[18];
    const karmaLead = Lang.text('titleСhildren18_1');
    const karmaParts = karmaLead.match(/^(.+?)\s+[—-]\s+(.+)$/);
    const karmaTooltip = DOM({ style: ['account-rating-tooltip', 'karma-tooltip'] });
    if (karmaParts) {
      karmaTooltip.append(DOM({ style: 'account-rating-tooltip-title' }, karmaParts[1]));
    }
    karmaTooltip.append(DOM({ style: 'account-rating-tooltip-body' }, `${karmaParts ? `- ${karmaParts[2]}` : karmaLead}\n${Lang.text('titleСhildren18_2')}`));
    karmaButton.style.pointerEvents = 'auto';
    karmaButton.style.zIndex = '4';
    karmaButton.append(DOM({ tag: 'div' }), karmaTooltip);

    CastleNAVBAR.renderQueue();

    CastleNAVBAR.applyModeView();

    return CastleNAVBAR.body.children[5];
  }

  static defaultMode(id) {
    if (!id) {
      if (CastleNAVBAR.stateDefaultMode) {
        CastleNAVBAR.stateDefaultMode = 0;
      }

      return;
    }

    if (CastleNAVBAR.stateDefaultMode && CastleNAVBAR.stateDefaultMode == id) {
      return;
    }

    if (CastleNAVBAR.state) {
      return;
    }

    CastleNAVBAR.setMode(id);

    CastleNAVBAR.stateDefaultMode = id;
  }

  static play() {
    if (CastleNAVBAR.state) {
      return;
    }

    CastleNAVBAR.state = true;

    CastleNAVBAR.body.children[0].style.display = 'block';

    CastleNAVBAR.body.children[5].innerText = Lang.text('cancel');

    //CastleNAVBAR.body.children[5].style.fontSize = '1.1vw';

    CastleNAVBAR.body.children[1].style.filter = 'grayscale(80%)';

    CastleNAVBAR.body.children[2].style.filter = 'grayscale(80%)';

    CastleNAVBAR.body.children[3].style.filter = 'grayscale(70%)';

    CastleNAVBAR.body.children[4].style.filter = 'grayscale(70%)';
  }

  static karma(id) {
    let karma = 0;

    if (id >= 75) {
      karma = 75;
    } else if (id >= 50) {
      karma = 50;
    }

    if (karma) {
      const el = CastleNAVBAR.body.children[18];
      el.style.display = 'flex';
      el.firstChild.innerText = `>${karma}`;

      const karmaLead = Lang.text('titleСhildren18_1');
      const karmaParts = karmaLead.match(/^(.+?)\s+[—-]\s+(.+)$/);
      el.querySelector('.karma-tooltip .account-rating-tooltip-body').textContent =
        `${karmaParts ? `- ${karmaParts[2]}` : karmaLead}\n${Lang.text('titleСhildren18_2')}\n${Lang.text('titleСhildren18_3').replace('{karma}', `> ${karma}`)}`;
    }
  }

  static division(id) {
    let division = Division.get(id);

    CastleNAVBAR.body.children[17].style.backgroundImage = `url(content/ranks/${division.icon}.webp)`;

    CastleNAVBAR.body.children[17].dataset.tooltip = Lang.text('titleСhildren17_1');

    CastleNAVBAR.body.children[17].style.display = 'block';
  }

  static cancel() {
    if (!CastleNAVBAR.state) {
      return;
    }

    CastleNAVBAR.state = false;

    CastleNAVBAR.body.children[0].style.display = 'none';

    CastleNAVBAR.renderFightButton();

    //CastleNAVBAR.body.children[5].style.fontSize = '1.4vw';

    CastleNAVBAR.body.children[1].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[2].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[3].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[4].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[17].style.display = 'none';

    CastleNAVBAR.body.children[18].style.display = 'none';
  }

  // Геометрия крыльев в vh (в системе .castle-button-play шириной 15vh, до scale(1.9)).
  // Крыло — кусок полосы img/b8.png (2597×532, лунки по 421.4 px, крайние центры
  // в 255 px от краёв) высотой 4.3vh. Слот пати (шлем) — крайняя к кругу лунка того же
  // крыла: центры шлемов 4.7 и 10.3vh, внутренний конец полосы уходит под круг.
  static WING = {
    scale: 4.3 / 532,
    end: 255,
    pitch: 421.4,
    slotLeft: 4.7,
    slotRight: 10.3,
  };

  // Невыбранные режимы по порядку: первая половина (большая при нечётном числе) —
  // в левое крыло, остальные — в правое; шлем пати — в лунке у круга.
  static layoutModes() {
    const { scale, end, pitch, slotLeft, slotRight } = CastleNAVBAR.WING;
    const others = CastleNAVBAR.MODES.filter((modeId) => modeId !== CastleNAVBAR.mode);
    const leftCount = Math.ceil(others.length / 2);
    const sides = [others.slice(0, leftCount), others.slice(leftCount)];

    sides.forEach((modes, side) => {
      const wing = CastleNAVBAR.wings[side];
      const width = (2 * end + modes.length * pitch) * scale;
      const wingLeft = side ? slotRight - end * scale : slotLeft + end * scale - width;
      // слева шлем в последней лунке, справа — в первой
      const firstSlot = side ? 1 : 0;

      wing.style.left = `${wingLeft}vh`;
      wing.style.width = `${width}vh`;

      modes.forEach((modeId, index) => {
        const element = CastleNAVBAR.modeButton(modeId);

        // кнопка режима — квадрат 4vh, сжатый до 0.6 вокруг центра лунки
        element.style.left = `${wingLeft + (end + (firstSlot + index) * pitch) * scale - 2}vh`;
        element.style.display = 'block';
      });
    });

    CastleNAVBAR.modeButton(CastleNAVBAR.mode).style.display = 'none';
  }

  // Меню режимов (вид по умолчанию): полоса children[10] под кругом с лункой на каждый
  // режим, собранная из двух половин b8.png, как крылья; по центру .castle-button-play.
  static layoutMenu() {
    const { scale, end, pitch } = CastleNAVBAR.WING;
    const width = (2 * end + (CastleNAVBAR.MODES.length - 1) * pitch) * scale;
    const left = (15 - width) / 2;
    const strip = CastleNAVBAR.body.children[10];

    strip.style.left = `${left}vh`;
    strip.style.width = `${width}vh`;

    CastleNAVBAR.MODES.forEach((modeId, index) => {
      CastleNAVBAR.modeButton(modeId).style.left = `${left + (end + index * pitch) * scale - 2}vh`;
    });
  }

  static isWingsView() {
    return Settings.settings?.castleModesWings === true;
  }

  // Применяет выбранный в настройках вид списка режимов (и при смене настройки на лету).
  static applyModeView() {
    if (!CastleNAVBAR.body) {
      return;
    }

    const wings = CastleNAVBAR.isWingsView();

    clearTimeout(CastleNAVBAR.modeMenuCloseTimer);

    CastleNAVBAR.body.classList.toggle('is-mode-wings', wings);

    for (const modeId of CastleNAVBAR.MODES) {
      CastleNAVBAR.modeButton(modeId).style.left = '';
    }

    if (wings) {
      CastleNAVBAR.body.children[5].style.display = 'flex';

      CastleNAVBAR.body.children[10].style.display = 'none';

      CastleNAVBAR.layoutModes();
    } else {
      CastleNAVBAR.hideModeMenu();
    }

    CastleNAVBAR.applyModeTooltips();
  }

  static isModeMenuOpen() {
    return CastleNAVBAR.body.children[10].style.display === 'block';
  }

  static openModeMenu() {
    clearTimeout(CastleNAVBAR.modeMenuCloseTimer);

    CastleNAVBAR.loadModeTeams();

    if (!CastleNAVBAR.isModeMenuOpen()) {
      CastleNAVBAR.viewMode();
    }
  }

  static closeModeMenuSoon() {
    clearTimeout(CastleNAVBAR.modeMenuCloseTimer);

    CastleNAVBAR.modeMenuCloseTimer = setTimeout(() => {
      if (CastleNAVBAR.isModeMenuOpen()) {
        CastleNAVBAR.viewMode();
      }
    }, 250);
  }

  // меню режимов: полоса (children[10]) и все режимы вместо кнопки «В бой»
  static viewMode() {
    if (CastleNAVBAR.isModeMenuOpen()) {
      CastleNAVBAR.hideModeMenu();
    } else {
      CastleNAVBAR.body.children[5].style.display = 'none';

      CastleNAVBAR.layoutMenu();

      for (const element of [CastleNAVBAR.body.children[10], ...CastleNAVBAR.MODES.map((modeId) => CastleNAVBAR.modeButton(modeId))]) {
        element.style.display = 'block';
      }
    }
  }

  static hideModeMenu() {
    CastleNAVBAR.body.children[5].style.display = 'flex';

    for (const element of [CastleNAVBAR.body.children[10], ...CastleNAVBAR.MODES.map((modeId) => CastleNAVBAR.modeButton(modeId))]) {
      element.style.display = 'none';
    }
  }

  static setMode(type, options = {}) {
    const { syncParty = true } = options || {};
    let modeSelect = type - 1;

    // неизвестный режим (нет кнопки в списке) — оставляем выбранный
    if (!CastleNAVBAR.modeButton(modeSelect)) {
      return;
    }

    CastleNAVBAR.mode = modeSelect;

    CastleNAVBAR.renderQueue();

    let background = window.getComputedStyle(CastleNAVBAR.modeButton(modeSelect), null).getPropertyValue('background-image');

    CastleNAVBAR.body.children[6].style.backgroundImage = background;

    if (CastleNAVBAR.isWingsView()) {
      CastleNAVBAR.layoutModes();
    } else {
      CastleNAVBAR.hideModeMenu();
    }

    CastleNAVBAR.applyModeTooltips();

	window.dispatchEvent(new CustomEvent('CastleModeChanged', { detail: { mode: CastleNAVBAR.mode } }));

	// бан за АФК в тамбуре действует только в режимах с тамбуром
	CastleNAVBAR.refreshSearchBan();
	
	// тренировка локальная (бэкенд не даёт поставить её пати) — режим пати не трогаем
	const inParty = Number(MM.partyMembersCount || 1) > 1;
	if(syncParty && inParty && !CastleNAVBAR.isTraining() && MM.partyId && (String(MM.partyId) === String(App.storage?.data?.id))){
		
		App.api.request(App.CURRENT_MM,'modeParty',{id:MM.partyId,mode:CastleNAVBAR.mode}).catch((error) => {
			
			App.error(error);
			
		});
		
	}
  }

  // Последний MMQueueV2 (Events.MMQueueV2): mode — {id режима: число игроков
  // в поиске или «игроки (группы)», если бэкенд считает пати отдельно}.
  static queueData = null;

  static parseQueue(value) {
    const match = String(value ?? '').match(/^\s*(\d+)(?:\s*\((\d+)\))?/);

    return { players: match ? Number(match[1]) : 0, parties: match && match[2] ? Number(match[2]) : 0 };
  }

  static queue(data) {
    CastleNAVBAR.queueData = data && typeof data === 'object' ? data : null;

    CastleNAVBAR.renderQueue();
  }

  // Бейджи «в поиске»: на кнопке выбранного режима (только если кто-то ищет)
  // и у каждого режима в крыльях (ноль — приглушённый).
  static renderQueue() {
    if (!CastleNAVBAR.body) {
      return;
    }

    const modes = CastleNAVBAR.queueData?.mode || {};

    // бейдж на круге режима: число в поиске, в подсказке — режим и группы
    const { players, parties } = CastleNAVBAR.parseQueue(modes[CastleNAVBAR.mode]);
    const badge = CastleNAVBAR.queuePlate;

    if (badge) {
      badge.textContent = String(players);

      badge.classList.toggle('is-empty', !players);

      // у тренировки очереди нет — бейдж не показываем
      badge.style.display = CastleNAVBAR.isTraining() ? 'none' : '';

      badge.dataset.tooltip = `${Lang.text(CastleNAVBAR.modeKey(CastleNAVBAR.mode))}\n${Lang.text('mmQueueSearching').replace('{n}', players)}${parties ? `\n${Lang.text('mmQueueParties').replace('{n}', parties)}` : ''}`;
    }

    // бейджи у каждого режима в крыльях (ноль — приглушённый)
    for (const modeId of CastleNAVBAR.MODES) {
      if (modeId === CastleNAVBAR.TRAINING_MODE) {
        continue;
      }

      const element = CastleNAVBAR.modeButton(modeId).firstChild;

      const queue = CastleNAVBAR.parseQueue(modes[modeId]);

      element.textContent = String(queue.players);

      element.classList.toggle('is-empty', !queue.players);
    }
  }
}
