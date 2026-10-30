import { DomAudio } from './domAudio.js';
import { Sound } from './sound.js';
import { Castle } from './castle.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';

export const domAudioPresets = {
  defaultButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK, {
        id: 'ui-click',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
  ),
  closeButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK_CLOSE, {
        id: 'ui-close',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
  ),
  bigButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK_OPEN_BIG, {
        id: 'ui-big-click',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
  ),
  smallButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, {
        id: 'ui-small-click',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
  ),
  chatButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CHAT, {
        id: 'ui-chat',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        loop: false,
      });
    },
    function up() {},
    function input() {},
  ),
  buyButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.BUY, {
        id: 'ui-buy',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
  ),
  finishQuestButton: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.GOLD_COINS, {
        id: 'ui-finish-quest',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
  ),
  talent: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK, {
        id: 'ui-small-click',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up(e) {
      if (e.button === 0) {
        Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, {
          id: 'ui-small-click',
          volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        });
      }
    },
    function input() {},
  ),
  defaultInput: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK, {
        id: 'ui-click',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {
      Sound.play(SOUNDS_LIBRARY.CHAT, {
        id: 'ui-chat',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * 0.05
      });
    },
    function change() {},
  ),
  defaultSelect: new DomAudio(
    function over() {},
    function down() {
      Sound.play(SOUNDS_LIBRARY.CLICK, {
        id: 'ui-click',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
    function up() {},
    function input() {},
    function change() {
      Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, {
        id: 'ui-select',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    },
  ),
};
