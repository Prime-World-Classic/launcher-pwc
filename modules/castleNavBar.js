import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { Division } from './division.js';
import { App } from './app.js';
import { MM } from './mm.js';
import { domAudioPresets } from './domAudioPresets.js';

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
  };

  static modeTeamsLoadedAt = 0;

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
    for (let modeId = 0; modeId < 6; modeId++) {
      CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[11 + modeId], `gm${modeId + 1}`, `gm${modeId + 1}_hover`);
    }
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

  static setModeTooltip(element, titleKey, hoverKey) {
    const title = Lang.text(titleKey);
    const hoverText = CastleNAVBAR.modeHoverText(Number(titleKey.slice(2)) - 1, hoverKey);
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

    CastleNAVBAR.body.children[3].onclick = () => {};

    CastleNAVBAR.body.children[4].onclick = () => {};

    for (const index of [3, 4]) {
      CastleNAVBAR.body.children[index].append(DOM({ style: ['account-rating-tooltip', 'castle-training-tooltip'] },
        DOM({ style: 'account-rating-tooltip-title' }, Lang.text('trainingBotsTooltipTitle')),
        DOM({ style: 'account-rating-tooltip-body' }, Lang.text('trainingBotsTooltipBody')),
      ));
    }

    CastleNAVBAR.body.children[5].innerText = App.CURRENT_MM == 'mmtest' ? Lang.text('fight') + ' test' : Lang.text('fight');
    CastleNAVBAR.body.children[5].dataset.tooltip = Lang.text('fightButtonTooltip');
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
    // Список режимов открывается при наведении на кнопку режима и закрывается,
    // когда курсор ушёл и с кнопки, и с панели (с задержкой, чтобы успеть перевести мышь).
    CastleNAVBAR.body.children[9].onclick = () => {
      CastleNAVBAR.openModeMenu();
    };

    for (const index of [9, 10, 11, 12, 13, 14, 15, 16]) {
      CastleNAVBAR.body.children[index].addEventListener('mouseenter', () => {
        if (index === 9) {
          CastleNAVBAR.openModeMenu();
        } else {
          clearTimeout(CastleNAVBAR.modeMenuCloseTimer);
        }
      });
      CastleNAVBAR.body.children[index].addEventListener('mouseleave', () => {
        CastleNAVBAR.closeModeMenuSoon();
      });
    }

    // бейдж на правом верхнем «плече» круга режима: сколько игроков ищут бой в выбранном режиме
    CastleNAVBAR.queuePlate = DOM({ style: 'castle-button-play-queue', data: { tooltip: Lang.text('mmQueueTooltip') } });
    CastleNAVBAR.body.children[9].append(CastleNAVBAR.queuePlate);

	  CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[11], 'gm1', 'gm1_hover');
	  CastleNAVBAR.body.children[11].append(DOM({ style: 'castle-button-play-queue-mode' }));
	  CastleNAVBAR.body.children[11].onclick = () => {
		CastleNAVBAR.setMode(1);
	  };

	  CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[12], 'gm2', 'gm2_hover');
	  CastleNAVBAR.body.children[12].append(DOM({ style: 'castle-button-play-queue-mode' }));
	  CastleNAVBAR.body.children[12].onclick = () => {
		CastleNAVBAR.setMode(2);
	  };

	  CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[13], 'gm3', 'gm3_hover');
	  CastleNAVBAR.body.children[13].append(DOM({ style: 'castle-button-play-queue-mode' }));
	  CastleNAVBAR.body.children[13].onclick = () => {
		CastleNAVBAR.setMode(3);
	  };

	  CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[14], 'gm4', 'gm4_hover');
	  CastleNAVBAR.body.children[14].append(DOM({ style: 'castle-button-play-queue-mode' }));
	  CastleNAVBAR.body.children[14].onclick = () => {
		CastleNAVBAR.setMode(4);
	  };

	  CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[15], 'gm5', 'gm5_hover');
	  CastleNAVBAR.body.children[15].append(DOM({ style: 'castle-button-play-queue-mode' }));
	  CastleNAVBAR.body.children[15].onclick = () => {
		CastleNAVBAR.setMode(5);
	  };

	  CastleNAVBAR.setModeTooltip(CastleNAVBAR.body.children[16], 'gm6', 'gm6_hover');
	  CastleNAVBAR.body.children[16].append(DOM({ style: 'castle-button-play-queue-mode' }));
	  CastleNAVBAR.body.children[16].onclick = () => {
		CastleNAVBAR.setMode(6);
	  };

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

    CastleNAVBAR.body.children[5].innerText = App.CURRENT_MM == 'mmtest' ? Lang.text('fight') + ' test' : Lang.text('fight');

    //CastleNAVBAR.body.children[5].style.fontSize = '1.4vw';

    CastleNAVBAR.body.children[1].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[2].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[3].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[4].style.filter = 'grayscale(0)';

    CastleNAVBAR.body.children[17].style.display = 'none';

    CastleNAVBAR.body.children[18].style.display = 'none';
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

  static viewMode() {
    if (CastleNAVBAR.body.children[10].style.display === 'block') {
      CastleNAVBAR.body.children[5].style.display = 'flex';

      CastleNAVBAR.body.children[10].style.display = 'none';

      CastleNAVBAR.body.children[11].style.display = 'none';

      CastleNAVBAR.body.children[12].style.display = 'none';

      CastleNAVBAR.body.children[13].style.display = 'none';

      CastleNAVBAR.body.children[14].style.display = 'none';

      CastleNAVBAR.body.children[15].style.display = 'none';

      CastleNAVBAR.body.children[16].style.display = 'none';
    } else {
      CastleNAVBAR.body.children[5].style.display = 'none';

      CastleNAVBAR.body.children[10].style.display = 'block';

      CastleNAVBAR.body.children[11].style.display = 'block';

      CastleNAVBAR.body.children[12].style.display = 'block';

      CastleNAVBAR.body.children[13].style.display = 'block';

      CastleNAVBAR.body.children[14].style.display = 'block';

      CastleNAVBAR.body.children[15].style.display = 'block';

      CastleNAVBAR.body.children[16].style.display = 'block';
    }
  }

  static setMode(type, options = {}) {
    const { syncParty = true } = options || {};
    let modeSelect = type - 1;

    CastleNAVBAR.mode = modeSelect;

    CastleNAVBAR.renderQueue();

    CastleNAVBAR.body.children[5].style.display = 'flex'; //починил кнопку

    let background = window.getComputedStyle(CastleNAVBAR.body.children[`1${type}`], null).getPropertyValue('background-image');

    CastleNAVBAR.body.children[6].style.backgroundImage = background;

    CastleNAVBAR.body.children[10].style.display = 'none';

    CastleNAVBAR.body.children[11].style.display = 'none';

    CastleNAVBAR.body.children[12].style.display = 'none';

    CastleNAVBAR.body.children[13].style.display = 'none';

    CastleNAVBAR.body.children[14].style.display = 'none';

    CastleNAVBAR.body.children[15].style.display = 'none';

    CastleNAVBAR.body.children[16].style.display = 'none';
	
	window.dispatchEvent(new CustomEvent('CastleModeChanged', { detail: { mode: CastleNAVBAR.mode } }));
	
	const inParty = Number(MM.partyMembersCount || 1) > 1;
	if(syncParty && inParty && MM.partyId && (String(MM.partyId) === String(App.storage?.data?.id))){
		
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
  // и у каждого режима в раскрытом списке (ноль — приглушённый).
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

      badge.dataset.tooltip = `${Lang.text(`gm${CastleNAVBAR.mode + 1}`)}\n${Lang.text('mmQueueSearching').replace('{n}', players)}${parties ? `\n${Lang.text('mmQueueParties').replace('{n}', parties)}` : ''}`;
    }

    // бейджи у каждого режима в раскрытом списке (ноль — приглушённый)
    for (let modeId = 0; modeId < 6; modeId++) {
      const element = CastleNAVBAR.body.children[11 + modeId].firstChild;

      const queue = CastleNAVBAR.parseQueue(modes[modeId]);

      element.textContent = String(queue.players);

      element.classList.toggle('is-empty', !queue.players);
    }
  }
}
