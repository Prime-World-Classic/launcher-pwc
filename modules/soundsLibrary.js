import { NativeAPI } from './nativeApi.js';


export const SOUNDS_LIBRARY = {
  // UI Sounds
  CLICK: 'content/sounds/ui/Click.wav',
  CLICK_CLOSE: 'content/sounds/ui/ClickClose.wav',
  CLICK_OPEN_BIG: 'content/sounds/ui/ClickOpenBig.wav',
  CLICK_BUTTON_PRESS_SMALL: 'content/sounds/ui/ClickButtonPressSmall.wav',

  CHAT: 'content/sounds/ui/chat.wav',
  BUY: 'content/sounds/ui/buy.wav',
  NEW_LEVEL: 'content/sounds/ui/NewLevel.wav',
  GOLD_COINS: 'content/sounds/ui/GoldCoins.wav',

  ERROR: 'content/sounds/ui/error.wav',
  MM_FOUND: 'content/sounds/found.ogg',
  GROUP_INVITE: 'content/sounds/ui/GroupInvite.wav',
  CALL: 'content/sounds/ui/Call.wav',

  // Music
  AD: {
    AD_1: 'content/sounds/ad/1.ogg',
    AD_2: 'content/sounds/ad/2.ogg',
    AD_3: 'content/sounds/ad/3.ogg',
    AD_4: 'content/sounds/ad/4.ogg',
    AD_5: 'content/sounds/ad/5.ogg',
    AD_6: 'content/sounds/ad/6.ogg',
  },

  DOCT: {
    DOCT_1: 'content/sounds/doct/1.ogg',
    DOCT_2: 'content/sounds/doct/2.ogg',
    DOCT_3: 'content/sounds/doct/3.ogg',
    DOCT_4: 'content/sounds/doct/4.ogg',
    DOCT_5: 'content/sounds/doct/5.ogg',
  },

  VC_ENABALED: 'content/sounds/voice/enabled.mp3',
  VC_DISABLED: 'content/sounds/voice/disabled.mp3',

  // Tambur
  TAMBUR: 'content/sounds/tambur.ogg',
  SINGLE_TIMER: 'content/sounds/ui/SingleTimer.mp3',

  // «3 в ряд» (дуэль): звуки мини-игры «Мастерская свитков» из Prime World (content/easel/sounds)
  MATCH3: {
    M3_MATCH: 'content/easel/sounds/easel_hit_color_match.ogg',
    M3_MISS: 'content/easel/sounds/easel_hit_color_missmatch.ogg',
    M3_COMBO_2: 'content/easel/sounds/easel_combo_2x.ogg',
    M3_COMBO_3: 'content/easel/sounds/easel_combo_3x.ogg',
    M3_COMBO_4: 'content/easel/sounds/easel_combo_4x.ogg',
    M3_COMBO_5: 'content/easel/sounds/easel_combo_5x.ogg',
    M3_BLAST: 'content/easel/sounds/easel_boost_paintblas_explosion.ogg',
    M3_HEAL: 'content/easel/sounds/easel_boost_inspiration_cli.ogg',
    M3_CHARGE: 'content/easel/sounds/easel_boost_brightering_cli.ogg',
    M3_SHIELD: 'content/easel/sounds/easel_boost_freeze_click.ogg',
    M3_STEAL: 'content/easel/sounds/Magnet.ogg',
    M3_CURSED: 'content/easel/sounds/easel_chain_reach_end.ogg',
    M3_ABILITY: 'content/easel/sounds/easel_boost_paintblast_clic.ogg',
    M3_READY: 'content/easel/sounds/easel_new_boost_obtained.ogg',
    M3_CRYSTAL: 'content/easel/sounds/easel_coin_catched.ogg',
    M3_EXTRA: 'content/easel/sounds/easel_tunnel_appeared.ogg',
    M3_SHUFFLE: 'content/easel/sounds/easel_chain_merged.ogg',
    M3_WIN: 'content/easel/sounds/easel_level_win.ogg',
    M3_LOSE: 'content/easel/sounds/easel_level_loose.ogg',
  },
};

/*  HERO SOUNDS GENERATION */

const HERO_SOUND_TYPES = ['revive'];

export function generateHeroSoundsNative() {
  const fs = NativeAPI.fileSystem;
  const path = NativeAPI.path;

  const heroRoot = path.join(process.cwd(), 'content/hero');

  const heroIds = fs
    .readdirSync(heroRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const heroId of heroIds) {
    for (const type of HERO_SOUND_TYPES) {
      const typeDir = path.join(heroRoot, heroId, type);
      if (!fs.existsSync(typeDir)) continue;

      const sounds = fs
        .readdirSync(typeDir)
        .filter(f => f.endsWith('.ogg'))
        .map(f => f.replace('.ogg', ''));

      for (const sound of sounds) {
        SOUNDS_LIBRARY[`HERO_${heroId}_${type}_${sound}`] =
          `content/hero/${heroId}/${type}/${sound}.ogg`;
      }
    }
  }
}

export function generateHeroSoundsFallback() {
  const HERO_IDS = Array.from({ length: 67 }, (_, i) => i + 1);
  const FALLBACK_SOUNDS = ['1', '2', '3', '4'];

  for (const heroId of HERO_IDS) {
    for (const type of HERO_SOUND_TYPES) {
      for (const sound of FALLBACK_SOUNDS) {
        SOUNDS_LIBRARY[`HERO_${heroId}_${type}_${sound}`] =
          `content/hero/${heroId}/${type}/${sound}.ogg`;
      }
    }
  }
}


