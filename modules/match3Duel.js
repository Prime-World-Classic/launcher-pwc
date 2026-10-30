import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { App } from './app.js';
import { Game } from './game.js';
import { domAudioPresets } from './domAudioPresets.js';
import { Sound } from './sound.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { Castle } from './castle.js';
import { Window } from './window.js';

// Дуэль «3 в ряд» во вкладке «Дуэль» окна «Фарм талантов».
// На поле таланты, под каждым — значок стата. Сгоревшие значки заряжают копилки,
// полная копилка срабатывает сама. Сервер (match3.duelStart/duelState/duelMove/duelAbility/duelSurrender) —
// источник правды: клиент шлёт ход, получает события по порядку и проигрывает их на поле game.js.
// Герои случайные: у каждого бонус и умение (match3Heroes.js на бэкенде), описания собираются здесь
// из чисел сервера по шаблонам m3h*/m3a* в lang.

const STATS = { 1: 'strength', 2: 'intelligence', 3: 'health', 4: 'energy', 5: 'stamina', 6: 'cunning', 7: 'cursed' };

// название стата (ключи глоссария лаунчера) и шаблон эффекта полной копилки
const LEGEND = [
  [1, 'strength', 'match3FxDamage'],
  [2, 'intelligence', 'match3FxDamageCharge'],
  [3, 'health', 'match3FxHeal'],
  [4, 'energy', 'match3FxCharge'],
  [5, 'stamina', 'match3FxShield'],
  [6, 'dexterity', 'match3FxSteal'],
  [7, 'match3Cursed', 'match3FxSelf'],
];

// если сервер не прислал числа (старый бэкенд) — значения по умолчанию из match3Settings.js
const FX_DEFAULT = { chargeMax: 6, extraTurnCombo: 5, strength: 20, intelligence: 14, intelligenceCharge: 1, health: 10, energyCharge: 2, stamina: 10, cunning: 3, cursed: 10 };

// значки статусов на портрете героя: [ключ статуса, символ, подсказка]
const STATUS_ICONS = [
  ['poison', '☠', 'm3sPoison'],
  ['stun', '✦', 'm3sStun'],
  ['ward', '⛨', 'm3sWard'],
  ['summon', '⚔', 'm3sSummon'],
  ['mark', '◎', 'm3sMark'],
  ['weaken', '↓', 'm3sWeaken'],
  ['reflect', '↺', 'm3sReflect'],
];

export class Match3Duel {
  static container = null;

  static state = null;

  static clockOffset = 0;

  static timer = 0;

  static busy = false;

  static polling = false;

  static rolling = false;

  // PvP: идёт поиск соперника; цепочка обработки пушей
  static searching = null;

  // плашка поиска в углу экрана; сообщение «соперник найден» для открывающегося боя
  static searchWidget = null;

  static foundNotice = null;

  static pushChain = Promise.resolve();

  static listening = false;

  static panels = [];

  // Звук дуэли — громкость как у остальных звуков лаунчера (ползунок «Звуки»)
  // Сколько мс звучит звук: звуки «Мастерской свитков» длиннее наших событий — обрезаем с затуханием.
  // 0 — не обрезать (щелчок таймера и так короткий).
  static SFX_MAX = { M3_MATCH: 450, M3_MISS: 400, M3_CRYSTAL: 800, M3_WIN: 2600, M3_LOSE: 2600, MM_FOUND: 1500, SINGLE_TIMER: 0 };

  static sfx(name, volume = 1) {
    const src = SOUNDS_LIBRARY.MATCH3?.[name] || SOUNDS_LIBRARY[name];

    if (!src) {
      return;
    }

    try {
      const id = `m3-${name}`,
        level = Castle.GetVolume(Castle.AUDIO_SOUNDS) * volume,
        max = Match3Duel.SFX_MAX[name] ?? 650;

      Sound.play(src, { id, volume: level });

      if (max && Sound.all[id]) {
        Match3Duel.fadeOut(Sound.all[id], max, level);
      }
    } catch (e) {
      // нет звука — не страшно
    }
  }

  // Плавно заглушить звук к моменту after (мс); если его уже перебили — ничего не делать
  static fadeOut(audio, after, level) {
    const fade = 160;

    setTimeout(() => {
      const start = Date.now();

      const step = () => {
        if (audio.paused) {
          return;
        }

        const k = 1 - (Date.now() - start) / fade;

        if (k <= 0) {
          audio.pause();

          return;
        }

        audio.volume = Math.max(0, level * k);

        setTimeout(step, 30);
      };

      step();
    }, Math.max(0, after - fade));
  }

  // Окно закрыли — звуки дуэли больше не нужны
  static stopSounds() {
    for (const id in Sound.all) {
      if (id.startsWith('m3-')) {
        Sound.stop(id);
      }
    }
  }

  // Сгоревшие таланты: «совпадение», за каскад — комбо 2x…5x
  static moveSound(event) {
    Match3Duel.sfx('M3_MATCH');

    if (event?.waves >= 2) {
      setTimeout(() => Match3Duel.sfx(`M3_COMBO_${Math.min(5, event.waves)}`), 260);
    }
  }

  static chipImage(id) {
    return `content/img/match3/${STATS[id] || 'cursed'}.webp`;
  }

  static fx() {
    return Object.assign({}, FX_DEFAULT, Match3Duel.state?.fx || Match3Duel.introFx || {});
  }

  static fxText(id, key) {
    const fx = Match3Duel.fx();
    const n = { 1: fx.strength, 2: fx.intelligence, 3: fx.health, 4: 0, 5: fx.stamina, 6: fx.cunning, 7: fx.cursed }[id];
    const c = id == 2 ? fx.intelligenceCharge : fx.energyCharge;
    return Lang.text(key).replace('{n}', n).replace('{c}', c);
  }

  // --- описания героев ---

  // Шаблон из lang: {n} {m} {s} — значения; [слово:n] — слово в форме для числа n
  // (формы — в m3w_<слово> через «|»: «заряд|заряда|зарядов», в en — «charge|charges»)
  static fmt(key, n = '', m = '', s = '') {
    const values = { n, m };

    return Lang.text(key)
      .replace(/\[(\w+):([nm])\]/g, (all, word, which) => Match3Duel.plural(values[which], Lang.text(`m3w_${word}`)))
      .replaceAll('{n}', n)
      .replaceAll('{m}', m)
      .replaceAll('{s}', s);
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

  static statName(id) {
    return Lang.text(LEGEND[(Number(id) || 7) - 1]?.[1] || 'match3Cursed');
  }

  static heroName(id) {
    return Lang.text(`hero_${id}_name`);
  }

  // название таланта без стоимости, КД и разметки
  static talentName(id) {
    return String(Lang.text(`htalent_${id}_name`) || '')
      .replace(/<(CD|mana|detail)>.*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
  }

  // ресурс умения героя: мана или своё (кураж, ярость, детали…) — ключи m3r<Что>_<ресурс>
  static res(hero, what, n = '', m = '') {
    return Match3Duel.fmt(`m3r${what}_${hero?.resource || 'mana'}`, n, m);
  }

  static talentIcon(id) {
    return `content/htalents/${id}.webp`;
  }

  // что ещё делает срабатывание копилки (onFire / everyN) — глаголами: «лечит вас на 3, даёт 2 щита»
  static pieces(o) {
    const F = Match3Duel.fmt,
      list = [];

    if (o.dmgPct) list.push(F('m3pDmgPct', o.dmgPct));
    if (o.damage) list.push(F('m3pDamage', o.damage));
    if (o.heal) list.push(F('m3pHeal', o.heal));
    if (o.shield) list.push(F('m3pShield', o.shield));
    if (o.burnTop) list.push(F('m3pBurn', o.burnTop));
    if (o.mana) list.push(F('m3pMana', o.mana));
    if (o.maxHp) list.push(F('m3pMaxHp', o.maxHp));

    return list.join(', ');
  }

  static bonusText(b = {}) {
    const F = Match3Duel.fmt,
      S = Match3Duel.statName,
      list = [];

    // у каждой копилки свой эффект: «наносит больше урона», «даёт больше щита»…
    for (const id in b.fx || {}) list.push(F(`${b.fx[id] < 0 ? 'm3hFxLess' : 'm3hFx'}${id}`, Math.abs(b.fx[id]), '', S(id)));
    for (const id in b.gain || {}) list.push(F('m3hGain', b.gain[id] + 1, '', S(id)));
    if (b.dmg) list.push(F('m3hDmg', b.dmg));
    if (b.armor) list.push(F('m3hArmor', b.armor));
    for (const id in b.armorFrom || {}) list.push(F('m3hArmorFrom', b.armorFrom[id], '', S(id)));
    if (b.bigHit) list.push(F('m3hBigHit', b.bigHit[0], b.bigHit[1]));
    if (b.dodge) list.push(b.dodge[1] >= 100 ? F('m3hDodgeFull', b.dodge[0]) : F('m3hDodge', b.dodge[0], b.dodge[1]));
    if (b.thorns) list.push(F('m3hThorns', b.thorns));
    if (b.counter) list.push(F('m3hCounter', b.counter[0], b.counter[1]));
    if (b.lifesteal) list.push(F('m3hLifesteal', b.lifesteal));
    if (b.hp) list.push(F('m3hHp', b.hp));
    if (b.shieldStart) list.push(F('m3hShieldStart', b.shieldStart));
    if (b.onFire) list.push(b.onFire.stat ? F('m3hOnFireStat', Match3Duel.pieces(b.onFire), '', S(b.onFire.stat)) : F('m3hOnFire', Match3Duel.pieces(b.onFire)));
    if (b.twice) list.push(F('m3hTwice', b.twice.chance, '', S(b.twice.stat)));
    if (b.everyN) list.push(F('m3hEveryN', b.everyN.n, Match3Duel.pieces(b.everyN)));
    if (b.opener) list.push(F('m3hOpener', b.opener));
    if (b.execute) list.push(F('m3hExecute', b.execute[0], b.execute[1]));
    if (b.fresh) list.push(F('m3hFresh', b.fresh[0], b.fresh[1]));
    if (b.lowHp) list.push(F('m3hLowHp', b.lowHp[0], b.lowHp[1]));
    if (b.combo) list.push(F('m3hCombo', b.combo));
    if (b.poison) list.push(F('m3hPoison', b.poison[0], b.poison[1]));
    if (b.regen) list.push(F('m3hRegen', b.regen));
    for (const id in b.turnCharge || {}) list.push(F('m3hTurnCharge', b.turnCharge[id], '', S(id)));
    if (b.turnShield) list.push(F('m3hTurnShield', b.turnShield));
    if (b.minion) list.push(F('m3hMinion', b.minion));
    for (const id in b.rage || {}) list.push(F('m3hRage', b.rage[id], '', S(id)));
    if (b.curse) list.push(F(b.curse >= 100 ? 'm3hCurseNone' : 'm3hCurse', b.curse));
    if (b.curseHit) list.push(F('m3hCurseHit', b.curseHit));
    if (b.vuln) list.push(F('m3hVuln', b.vuln));
    if (b.healMul) list.push(F('m3hHealMul', b.healMul));
    if (b.shieldMul) list.push(F('m3hShieldMul', b.shieldMul));
    if (b.antiheal) list.push(F('m3hAntiheal', b.antiheal));
    if (b.pierce) list.push(F('m3hPierce', b.pierce));
    if (b.abilityGain) list.push(F('m3hAbilityGain', b.abilityGain));

    return Match3Duel.sentences(list);
  }

  static abilityText(a = {}) {
    const F = Match3Duel.fmt,
      S = Match3Duel.statName,
      list = [],
      hits = a.hits || 1,
      rounds = (key, v) => F(v[1] > 1 ? `${key}N` : key, v[0], v[1]);

    if (a.hpCost) list.push(F('m3aHpCost', a.hpCost));
    if (a.cleanse) list.push(F('m3aCleanse'));
    if (a.cells) list.push(F({ random: 'm3aCellsRandom', square: 'm3aCellsSquare', cross: 'm3aCellsCross', line: 'm3aCellsLine' }[a.cells.shape] || 'm3aCellsRandom', a.cells.n || ''));
    if (a.convert) list.push(F('m3aConvert', a.convert.n, '', S(a.convert.to)));
    if (a.curse) list.push(F('m3aCurse', a.curse));
    if (a.damage) list.push(a.pierce ? F('m3aDamagePierce', a.damage) : hits > 1 ? F('m3aDamageHits', a.damage, hits) : F('m3aDamage', a.damage));
    if (a.drain) list.push(hits > 1 ? F('m3aDrainHits', a.drain, hits) : F('m3aDrain', a.drain));
    if (a.shieldDamage) list.push(F('m3aShieldDamage'));
    if (a.revenge) list.push(F('m3aRevenge', a.revenge[0], a.revenge[1]));
    if (a.consume) list.push(F('m3aConsume'));
    if (a.executeBelow) list.push(F('m3aExecute', a.executeBelow));
    if (a.heal) list.push(F('m3aHeal', a.heal));
    if (a.missingHeal) list.push(F('m3aMissingHeal', a.missingHeal));
    if (a.rewind) list.push(F('m3aRewind'));
    if (a.shield) list.push(F('m3aShield', a.shield));
    if (a.burn) list.push(F('m3aBurn', a.burn));
    for (const id in a.burnStat || {}) list.push(F('m3aBurnStat', a.burnStat[id], '', S(id)));
    if (a.steal) list.push(F('m3aSteal', a.steal));
    for (const id in a.fill || {}) list.push(F('m3aFill', a.fill[id], '', S(id)));
    if (a.fillAll) list.push(F('m3aFillAll', a.fillAll));
    if (a.poison) list.push(F('m3aPoison', a.poison[0], a.poison[1]));
    if (a.summon) list.push(F('m3aSummon', a.summon[0], a.summon[1]));
    if (a.mark) list.push(rounds('m3aMark', a.mark));
    if (a.weaken) list.push(rounds('m3aWeaken', a.weaken));
    if (a.reflect) list.push(rounds('m3aReflect', a.reflect));
    if (a.ward) list.push(a.ward > 1 ? F('m3aWardN', a.ward) : F('m3aWard'));
    if (a.stun) list.push(F('m3aStun'));

    return Match3Duel.sentences(list);
  }

  // Каждый эффект — отдельное предложение с заглавной буквы
  static sentences(list) {
    return list.map((text) => `${Match3Duel.capitalize(text)}.`).join(' ');
  }

  static capitalize(text) {
    return text ? text[0].toUpperCase() + text.slice(1) : '';
  }

  // Запрос с учётом задержки: по половине круга поправляем часы, чтобы таймер не отставал
  static async request(method, data) {
    const sent = Date.now();
    const response = await App.api.request('match3', method, data);
    const got = Date.now();
    if (response?.state?.now) {
      Match3Duel.clockOffset = got - (response.state.now + (got - sent) / 2);
    }
    return response;
  }

  // Вкладка «Дуэль»: вступление и кнопка «В бой». Идущий бой открывается сразу.
  static async render(container, options = {}) {
    Match3Duel.destroy();

    Match3Duel.container = container;

    // два render подряд (вкладка, «Назад») не должны оба дописать вступление
    const renderId = (Match3Duel.renderId = (Match3Duel.renderId || 0) + 1);

    container.replaceChildren();

    // числа эффектов для легенды — из настроек сервера
    try {
      const settings = options.preview ? null : await App.api.request('match3', 'settings');
      const d = settings?.settings?.duel;
      if (d && d.chargeMax) {
        Match3Duel.introFx = { chargeMax: d.chargeMax, extraTurnCombo: d.extraTurnCombo ?? 5, strength: d.fxStrength, intelligence: d.fxIntelligence, intelligenceCharge: d.fxIntelligenceCharge, health: d.fxHealth, energyCharge: d.fxEnergyCharge, stamina: d.fxStamina, cunning: d.fxCunning, cursed: d.fxCursed };

        Match3Duel.introLoot = { crystalMax: d.crystalMax ?? 1, crystalVsBot: d.crystalVsBot ?? 0 };
      }
    } catch (e) {
      // старый бэкенд — числа по умолчанию
    }

    if (Match3Duel.container !== container || Match3Duel.renderId !== renderId) {
      return;
    }

    if (!options.preview) Match3Duel.listen();

    const start = DOM(
      { style: 'm3d-start-row' },
      DOM({ domaudio: domAudioPresets.bigButton, style: ['m3d-btn', 'm3d-start'], event: ['click', () => Match3Duel.search()] }, Lang.text('match3FindOpponent')),
      DOM({ domaudio: domAudioPresets.bigButton, style: ['m3d-btn', 'm3d-start', 'm3d-start-bot'], event: ['click', () => Match3Duel.start()] }, Lang.text('match3VsBot')),
    );

    // поиск уже идёт (окно открыли с плашки) — вместо кнопок «В бой» отмена поиска
    if (Match3Duel.searching) {
      start.replaceChildren(
        DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('match3Searching')),
        DOM({ domaudio: domAudioPresets.bigButton, style: ['m3d-btn', 'm3d-start'], event: ['click', () => Match3Duel.cancelSearch()] }, Lang.text('match3SearchCancel')),
      );
    }

    // свой рейтинг — догружается отдельно, вступление не ждёт; кнопка открывает таблицу рейтинга
    const ratingText = DOM({ tag: 'span' }),
      ratingLine = DOM({ style: ['m3d-rating-line', 'm3d-rating-empty'] }, ratingText, DOM({ domaudio: domAudioPresets.defaultButton, style: 'm3d-rating-btn', event: ['click', () => Match3Duel.renderRating(container)] }, Lang.text('m3rTableButton')));

    if (!options.preview) App.api
      .request('match3', 'duelRating')
      .then((data) => {
        // вкладку могут строить до вставки окна в документ — isConnected здесь не проверяем
        if (data?.me) {
          ratingText.innerText = Match3Duel.ratingSummary(data.me);

          ratingLine.classList.remove('m3d-rating-empty');
        }
      })
      .catch(() => {});

    container.append(
      DOM(
        { style: 'm3d-intro' },
        DOM({ tag: 'h1' }, Lang.text('match3DuelTitle')),
        ratingLine,
        DOM({ tag: 'p' }, Lang.text('match3DuelIntro')),
        DOM({ tag: 'p', style: 'm3d-hint' }, Match3Duel.fmt('match3ChargeHint', Match3Duel.fx().chargeMax)),
        Match3Duel.legend(),
        DOM({ tag: 'p', style: 'm3d-hint' }, Match3Duel.fmt('match3ComboHint', Match3Duel.fx().extraTurnCombo)),
        DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('match3HeroesHint')),
        Match3Duel.introLoot?.crystalMax ? DOM({ tag: 'p', style: 'm3d-hint' }, Match3Duel.fmt(Match3Duel.introLoot.crystalVsBot ? 'match3CrystalHint' : 'match3CrystalHintBot', Match3Duel.introLoot.crystalMax)) : DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('match3ShardsHint')),
        start,
      ),
    );

    // вернуться в идущий бой (например, окно закрывали)
    if (options.preview) return;
    try {
      const current = await Match3Duel.request('duelState');

      if (Match3Duel.container === container && current?.state && !current.state.finished) {
        Match3Duel.openFound(current);
      }
    } catch (e) {
      // старый бэкенд без дуэли — остаётся вступление
    }
  }

  // --- рейтинг PvP ---

  // «Ваш рейтинг: 1024 · 15-е место · 12 боёв, 7 побед · калибровка: ещё 3 боя»
  static ratingSummary(me) {
    const parts = [Match3Duel.fmt('m3rMine', me.rating)];

    if (me.games > 0) {
      if (me.place) parts.push(Match3Duel.fmt('m3rPlace', me.place));

      parts.push(Match3Duel.fmt('m3rRecord', me.games, me.wins));
    } else {
      parts.push(Lang.text('m3rNoGames'));
    }

    if (me.calibration > 0 && me.games > 0) parts.push(Match3Duel.fmt('m3rCalibration', me.calibration));

    return parts.join(' · ');
  }

  static signed(n) {
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
  }

  // Таблица рейтинга (из вступления дуэли): свой рейтинг, правила и лучшие игроки; «Назад» — к вступлению
  static async renderRating(container) {
    // недорисованное вступление не должно лечь поверх таблицы
    Match3Duel.renderId = (Match3Duel.renderId || 0) + 1;

    const back = () => DOM({ domaudio: domAudioPresets.bigButton, style: ['m3d-btn', 'm3d-start'], event: ['click', () => Match3Duel.render(container)] }, Lang.text('m3rBack'));

    const root = DOM({ style: ['m3d-intro', 'm3r'] }, DOM({ tag: 'h1' }, Lang.text('m3rTitle')), DOM({ style: 'm3r-loading' }, DOM({ style: 'm3d-search-spinner' })), back());

    container.replaceChildren(root);

    let data = null;

    try {
      data = await App.api.request('match3', 'duelRating');
    } catch (e) {
      // старый бэкенд или сеть
    }

    // пока грузилось, переключили вкладку
    if (root.parentNode !== container) {
      return;
    }

    if (!data?.me) {
      root.replaceChildren(DOM({ tag: 'h1' }, Lang.text('m3rTitle')), DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('m3rLoadError')), back());

      return;
    }

    const rules = [];

    if (data.newGames > 0) rules.push(Match3Duel.fmt('m3rRuleCalibration', data.newGames));

    rules.push(Lang.text('m3rRuleOwner'));

    if (data.pairDay > 0) rules.push(Match3Duel.fmt('m3rRulePair', data.pairDay));

    const row = (item, me = false) =>
      DOM(
        { style: ['m3r-row', me ? 'm3r-row-me' : 'm3r-row-other'] },
        DOM({ style: 'm3r-place' }, String(item.place || '—')),
        DOM({ style: 'm3r-login' }, item.login || ''),
        DOM({ style: 'm3r-rating' }, String(item.rating)),
        DOM({ style: 'm3r-num' }, String(item.games)),
        DOM({ style: 'm3r-num' }, String(item.wins)),
      );

    const top = data.top || [],
      table = DOM({ style: 'm3r-table' });

    if (top.length) {
      table.append(
        DOM(
          { style: ['m3r-row', 'm3r-head'] },
          DOM({ style: 'm3r-place' }, '#'),
          DOM({ style: 'm3r-login' }, Lang.text('m3rColPlayer')),
          DOM({ style: 'm3r-rating' }, Lang.text('m3rColRating')),
          DOM({ style: 'm3r-num' }, Lang.text('m3rColGames')),
          DOM({ style: 'm3r-num' }, Lang.text('m3rColWins')),
        ),
      );

      const myId = App.storage?.data?.id;

      for (const item of top) {
        table.append(row(item, item.userId == myId));
      }

      // меня нет в списке лучших — своя строка в конце
      if (data.me.games > 0 && !top.some((item) => item.userId == myId)) {
        table.append(DOM({ style: ['m3r-row', 'm3r-gap'] }, '…'), row(Object.assign({ login: App.storage?.data?.login || '' }, data.me), true));
      }
    } else {
      table.append(DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('m3rEmpty')));
    }

    root.replaceChildren(
      DOM({ tag: 'h1' }, Lang.text('m3rTitle')),
      DOM({ style: 'm3d-rating-line' }, Match3Duel.ratingSummary(data.me)),
      DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('m3rIntro')),
      DOM({ tag: 'p', style: 'm3d-hint' }, rules.join(' ')),
      table,
      back(),
    );
  }

  // Итог боя по рейтингу для окна результата
  static ratingResult() {
    const s = Match3Duel.state,
      op = s?.players?.[1 - s.me];

    if (op?.bot) {
      return DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text('m3rBotNote'));
    }

    const r = s?.rating,
      mine = r?.players?.[s.me];

    if (!mine) {
      return DOM();
    }

    if (r.unrated) {
      const key = { owner: 'm3rUnratedOwner', pair: 'm3rUnratedPair' }[r.unrated] || 'm3rUnratedError';

      return DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text(key));
    }

    let text = Match3Duel.fmt('m3rResult', mine.rating, '', Match3Duel.signed(mine.delta));

    if (mine.place) text += ` · ${Match3Duel.fmt('m3rPlace', mine.place)}`;

    return DOM({ tag: 'p', style: ['m3d-result-rating', mine.delta >= 0 ? 'm3d-rating-up' : 'm3d-rating-down'] }, text);
  }

  // short — короткие подписи для строки под полем во время боя
  static legend(short = false) {
    return DOM(
      { style: 'm3d-legend' },
      ...LEGEND.map(([id, name, fx]) =>
        DOM(
          { style: 'm3d-legend-item' },
          DOM({ tag: 'img', src: Match3Duel.chipImage(id), style: 'm3d-legend-icon' }),
          DOM({ style: 'm3d-legend-text' }, DOM({ tag: 'b' }, Lang.text(name)), DOM({ tag: 'span' }, Match3Duel.fxText(id, short ? `${fx}Short` : fx))),
        ),
      ),
    );
  }

  // --- PvP: поиск соперника ---

  static listen() {
    if (Match3Duel.listening) {
      return;
    }

    Match3Duel.listening = true;

    window.addEventListener('m3duel', (e) => Match3Duel.onPush(e.detail || {}));

    // нашёлся обычный бой (окно готовности, тамбур) — поиск дуэли отменяем, иначе соперник
    // найдётся, пока игрок в бою, и дуэль проиграется по пропущенным ходам
    window.addEventListener('pw:mm-show', () => Match3Duel.searching && Match3Duel.cancelSearch());
  }

  static async search() {
    if (Match3Duel.busy || Match3Duel.searching) {
      return;
    }

    Match3Duel.busy = true;

    try {
      const response = await Match3Duel.request('duelSearch');

      Match3Duel.busy = false;

      if (response?.state) {
        Match3Duel.open(response);
      } else if (response?.queued) {
        Match3Duel.showSearching(response);
      }
    } catch (e) {
      Match3Duel.busy = false;

      App.error(e);
    }
  }

  // Ожидание соперника: окно закрывается, в углу у счётчика кристаллов остаётся маленькая плашка
  // (время поиска, отмена) — можно заниматься другим. Плашка висит, пока поиск не отменят
  // или не найдётся соперник; клик по ней открывает окно дуэли.
  static showSearching(info) {
    Match3Duel.stopSearching();

    Match3Duel.foundNotice = null;

    const offset = Date.now() - (info.now || Date.now()),
      since = info.since + offset,
      time = DOM({ style: 'm3d-mini-time' }),
      hint = info.botFallback && info.wait > 0 ? Match3Duel.fmt('match3SearchHintBot', info.wait) : Lang.text('match3SearchHint');

    const widget = DOM(
      { style: 'm3d-mini' },
      DOM(
        { style: 'm3d-mini-body', data: { tooltip: hint }, event: ['click', () => Window.show('main', 'farm')] },
        DOM({ style: ['m3d-search-spinner', 'm3d-mini-spinner'] }),
        DOM({ style: 'm3d-mini-text' }, DOM({ style: 'm3d-mini-title' }, Lang.text('match3Searching')), DOM({ style: 'm3d-mini-sub' }, Lang.text('match3DuelTitle'))),
        time,
      ),
      DOM(
        { domaudio: domAudioPresets.bigButton, style: ['m3d-btn', 'm3d-mini-cancel'], data: { tooltip: Lang.text('match3SearchCancel') }, event: ['click', () => Match3Duel.cancelSearch()] },
        DOM({ tag: 'span', style: 'm3d-mini-cancel-text' }, Lang.text('match3SearchCancel')),
        DOM({ tag: 'span', style: 'm3d-mini-cancel-x' }, '✕'),
      ),
    );

    document.body.append(widget);

    Match3Duel.searchWidget = widget;

    if (Window.windows.main?.id === 'wgame') {
      Window.close('main');
    }

    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - since) / 1000));

      time.innerText = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

      Match3Duel.placeWidget(widget);
    };

    tick();

    // пуш «соперник найден» может потеряться — раз в 5 с спрашиваем сами
    let polls = 0;

    Match3Duel.searching = setInterval(async () => {
      tick();

      if (++polls % 5) {
        return;
      }

      try {
        const response = await Match3Duel.request('duelSearch');

        if (Match3Duel.searching && response?.state) {
          Match3Duel.onFound(!!response.state.players?.[1 - response.state.me]?.bot);
        }
      } catch (e) {
        // сеть — попробуем в следующий раз
      }
    }, 1000);
  }

  // Плашка — по центру промежутка между блоком «В бой» (с лобби группы) и углом ресурсов
  // (кошелёк фермы и кристаллы), на его высоте, и никуда из него не уходит, чтобы не лечь поверх окон. Не влезает — прячется
  // подпись, потом значок поиска (отмена становится крестиком), а дальше плашка уменьшается.
  // Без замка — в правом верхнем углу (CSS)
  static placeWidget(widget) {
    const crystal = (document.querySelector('.castle-banner-online') || document.querySelector('.crystal-container'))?.getBoundingClientRect();

    widget.style.removeProperty('scale');

    widget.classList.remove('m3d-mini-compact', 'm3d-mini-tiny');

    if (!crystal?.width) {
      for (const side of ['top', 'left', 'right']) {
        widget.style.removeProperty(side);
      }

      return;
    }

    const gap = window.innerHeight * 0.01;

    // правый край блока «В бой» и игроков лобби в верхнем ряду
    let from = -1;

    for (const el of document.querySelectorAll('.castle-button-play, .castle-play-lobby-player')) {
      const r = el.getBoundingClientRect();

      if (r.width && r.top < crystal.bottom && r.right <= crystal.left) {
        from = Math.max(from, r.right);
      }
    }

    let center = crystal.left - gap - widget.offsetWidth / 2;

    if (from >= 0) {
      const space = crystal.left - from - 2 * gap;

      for (const level of ['m3d-mini-compact', 'm3d-mini-tiny']) {
        if (widget.offsetWidth > space) {
          widget.classList.add(level);
        }
      }

      if (widget.offsetWidth > space) {
        widget.style.scale = String(Math.max(0.05, space / widget.offsetWidth));
      }

      center = (from + crystal.left) / 2;
    }

    widget.style.right = 'auto';

    widget.style.left = `${Math.round(center - widget.offsetWidth / 2)}px`;

    widget.style.top = `${Math.round(Math.max(gap, crystal.top + (crystal.height - widget.offsetHeight) / 2))}px`;
  }

  static stopSearching() {
    if (Match3Duel.searching) {
      clearInterval(Match3Duel.searching);
    }

    Match3Duel.searching = null;

    Match3Duel.searchWidget?.remove();

    Match3Duel.searchWidget = null;
  }

  static async cancelSearch() {
    Match3Duel.stopSearching();

    try {
      await Match3Duel.request('duelSearchCancel');
    } catch (e) {
      // не страшно: на сервере очередь сама почистится
    }

    if (Match3Duel.container?.isConnected && !Match3Duel.state) {
      Match3Duel.render(Match3Duel.container);
    }
  }

  // Соперник найден: плашка убирается, открывается окно с боем (render сам вернёт в идущий бой)
  static async onFound(bot) {
    Match3Duel.stopSearching();

    Match3Duel.foundNotice = bot ? 'match3FoundBot' : 'match3FoundPlayer';

    if (!Match3Duel.container?.isConnected) {
      await Window.show('main', 'farm');

      return;
    }

    try {
      const response = await Match3Duel.request('duelState');

      if (response?.state && Match3Duel.container?.isConnected) {
        Match3Duel.openFound(response);
      }
    } catch (e) {
      App.error(e);
    }
  }

  // Открыть бой; если его только что нашёл поиск — с заставкой героев и сообщением
  static openFound(response) {
    const notice = Match3Duel.foundNotice;

    Match3Duel.foundNotice = null;

    Match3Duel.open(notice ? Object.assign(response, { resumed: false }) : response);

    if (notice) {
      Match3Duel.say(Lang.text(notice));

      Match3Duel.sfx('MM_FOUND');
    }
  }

  // Пуш M3Duel: found — соперник найден (или бот по таймауту), timeout — никто не пришёл,
  // events — ход соперника в PvP
  static onPush(data) {
    if (data.type == 'found') {
      if (!Match3Duel.searching && ((Match3Duel.state && !Match3Duel.state.finished) || !Match3Duel.container?.isConnected)) {
        return;
      }

      Match3Duel.onFound(!!data.bot);
    } else if (data.type == 'timeout') {
      const widget = Match3Duel.searchWidget;

      Match3Duel.searchWidget = null;

      Match3Duel.stopSearching();

      if (widget) {
        widget.replaceChildren(DOM({ style: 'm3d-mini-note' }, Lang.text('match3SearchTimeout')));

        setTimeout(() => widget.remove(), 4000);
      }

      if (Match3Duel.container?.isConnected && !Match3Duel.state) {
        Match3Duel.render(Match3Duel.container);
      }
    } else if (data.type == 'events' && Match3Duel.container?.isConnected && Match3Duel.state && data.id == Match3Duel.roomId) {
      // по очереди и не поверх своей анимации
      Match3Duel.pushChain = Match3Duel.pushChain.then(async () => {
        for (let i = 0; i < 150 && Match3Duel.busy; i++) {
          await Match3Duel.wait(100);
        }

        if (!Match3Duel.state || data.id != Match3Duel.roomId) {
          return;
        }

        Match3Duel.busy = true;

        Game.blocked = true;

        try {
          await Match3Duel.playEvents(data.events || []);

          if (data.state) {
            await Match3Duel.sync(data.state);
          }
        } catch (e) {
          console.error('m3duel push', e);
        }

        Match3Duel.busy = false;

        Match3Duel.updateTurn();
      });
    }
  }

  static async start() {
    if (Match3Duel.busy) {
      return;
    }

    Match3Duel.stopSearching();

    Match3Duel.busy = true;

    try {
      // герои выбираются на сервере случайно
      const response = await Match3Duel.request('duelStart', {});

      Match3Duel.busy = false;

      Match3Duel.open(response);
    } catch (e) {
      Match3Duel.busy = false;

      App.error(e);
    }
  }

  static me() {
    return Match3Duel.state ? Match3Duel.state.me : 0;
  }

  static myTurn() {
    const s = Match3Duel.state;

    return !!s && !s.finished && s.turn == s.me;
  }

  static panel(index) {
    const nodes = { charges: {} },
      mine = index == Match3Duel.me();

    const charges = DOM({ style: 'm3d-charges' });

    for (const id of [1, 2, 3, 4, 5, 6, 7]) {
      const fill = DOM({ style: 'm3d-charge-fill' });
      const count = DOM({ style: 'm3d-charge-count' });
      const item = DOM(
        {
          style: ['m3d-charge', `m3d-charge-${STATS[id]}`],
          data: {
            tipIcon: Match3Duel.chipImage(id),
            tipTitle: Lang.text(LEGEND[id - 1][1]),
            tip: Match3Duel.fmt('m3tCharge', Match3Duel.fx().chargeMax, '', Match3Duel.fxText(id, LEGEND[id - 1][2])),
          },
        },
        DOM({ tag: 'img', src: Match3Duel.chipImage(id) }),
        DOM({ style: 'm3d-charge-bar' }, fill),
        count,
      );
      nodes.charges[id] = { item, fill, count };
      charges.append(item);
    }

    // герой: бонус и умение (иконка умения — главный пассивный талант героя)
    nodes.abilityIcon = DOM({ tag: 'img', style: 'm3d-ability-icon' });

    nodes.abilityMana = DOM({ style: 'm3d-ability-mana' });

    const buttonProps = { style: ['m3d-ability-btn', mine ? 'm3d-ability-mine' : 'm3d-ability-op'] };

    if (mine) {
      buttonProps.domaudio = domAudioPresets.bigButton;

      buttonProps.event = ['click', () => Match3Duel.useAbility()];
    }

    nodes.abilityButton = DOM(buttonProps, DOM({ style: 'm3d-ability-ring' }), nodes.abilityIcon, nodes.abilityMana);

    if (mine) {
      nodes.readyNote = DOM({ style: 'm3d-ability-note' }, Lang.text('m3hReadyBadge'));

      nodes.abilityButton.append(nodes.readyNote);
    }

    nodes.hero = DOM(
      { style: 'm3d-hero' },
      DOM({ style: 'm3d-hero-block' }, DOM({ style: 'm3d-hero-title' }, Lang.text('m3hBonus')), (nodes.bonusText = DOM({ style: 'm3d-hero-text' }))),
      DOM(
        { style: ['m3d-hero-block', 'm3d-hero-ability'] },
        DOM({ style: 'm3d-ability-head' }, nodes.abilityButton, DOM({ style: 'm3d-ability-meta' }, DOM({ style: 'm3d-hero-title' }, Lang.text('m3hAbility')), (nodes.abilityCost = DOM({ tag: 'span' })))),
        // название — отдельной строкой во всю ширину, чтобы длинные помещались целиком
        (nodes.abilityName = DOM({ style: 'm3d-ability-name' })),
        (nodes.abilityText = DOM({ style: 'm3d-hero-text' })),
      ),
    );

    nodes.root = DOM(
      { style: ['m3d-panel', mine ? 'm3d-panel-me' : 'm3d-panel-op'] },
      (nodes.portrait = DOM({ style: 'm3d-portrait' }, (nodes.statuses = DOM({ style: 'm3d-statuses' })))),
      (nodes.name = DOM({ style: 'm3d-name' })),
      (nodes.login = DOM({ style: 'm3d-login' })),
      DOM({ style: ['m3d-bar', 'm3d-bar-hp'] }, (nodes.hpFill = DOM({ style: 'm3d-bar-fill' })), (nodes.hpText = DOM({ style: 'm3d-bar-text' }))),
      (nodes.manaBar = DOM(
        { style: ['m3d-bar', 'm3d-bar-mana'] },
        (nodes.manaFill = DOM({ style: 'm3d-bar-fill' })),
        (nodes.manaText = DOM({ style: 'm3d-bar-text' })),
      )),
      DOM(
        { style: 'm3d-stats' },
        DOM(
          { style: 'm3d-stat', data: { tipIcon: Match3Duel.chipImage(5), tipTitle: Lang.text('match3Shield'), tip: Lang.text('m3tShield') } },
          DOM({ tag: 'img', src: Match3Duel.chipImage(5) }),
          (nodes.shield = DOM({ tag: 'span' })),
        ),
        (nodes.crystalStat = DOM(
          { style: ['m3d-stat', 'm3d-stat-crystal'], data: { tipIcon: 'content/talents/762.webp', tipTitle: Lang.text('m3hCrystals'), tip: Lang.text('m3tCrystal') } },
          DOM({ tag: 'img', src: 'content/talents/762.webp' }),
          (nodes.crystal = DOM({ tag: 'span' })),
        )),
        (nodes.shardsStat = DOM(
          { style: ['m3d-stat', 'm3d-stat-shards'], data: { tipTitle: Lang.text('m3hShardsTitle'), tip: Lang.text('m3hShards') } },
          DOM({ style: 'm3d-shard-icon' }),
          (nodes.shards = DOM({ tag: 'span' })),
        )),
      ),
      charges,
      nodes.hero,
      (nodes.float = DOM({ style: 'm3d-float-host' })),
    );

    return nodes;
  }

  // Описания героя — один раз при открытии боя
  static fillHero(index) {
    const p = Match3Duel.state.players[index],
      nodes = Match3Duel.panels[index],
      hero = p?.hero;

    if (!nodes) {
      return;
    }

    if (!hero) {
      // старый бэкенд без героев
      nodes.hero.style.display = 'none';

      return;
    }

    nodes.bonusText.innerText = Match3Duel.bonusText(hero.bonus);

    nodes.abilityIcon.src = Match3Duel.talentIcon(hero.passive);

    nodes.abilityName.innerText = Match3Duel.talentName(hero.passive);

    // язык — для переноса длинных названий по слогам
    nodes.abilityName.lang = Lang.target;

    nodes.abilityCost.innerText = Match3Duel.res(hero, 'Cost', hero.ability.cost);

    // цвет полоски и подсказки — по ресурсу героя
    nodes.root.classList.remove(...[...nodes.root.classList].filter((c) => c.startsWith('m3d-res-')));

    nodes.root.classList.add(`m3d-res-${hero.resource || 'mana'}`);

    nodes.manaBar.dataset.tipTitle = Match3Duel.capitalize(Match3Duel.res(hero, 'Name'));

    nodes.manaBar.dataset.tip = `${Match3Duel.res(hero, 'Gain')} ${Lang.text('m3hAbilityHint')}`;

    nodes.abilityText.innerText = Match3Duel.abilityText(hero.ability);

    // подсказка — как описание таланта в билде: иконка, название, что делает, цена
    nodes.abilityButton.dataset.tipIcon = Match3Duel.talentIcon(hero.passive);

    nodes.abilityButton.dataset.tipTitle = Match3Duel.talentName(hero.passive);

    nodes.abilityButton.dataset.tip = Match3Duel.abilityText(hero.ability);

    nodes.abilityButton.dataset.tipNote = `${Match3Duel.capitalize(Match3Duel.res(hero, 'Cost', hero.ability.cost))}. ${Lang.text('m3hAbilityHint')}`;

    // портрет — имя героя и его бонус
    nodes.portrait.dataset.tipTitle = Match3Duel.heroName(hero.id);

    nodes.portrait.dataset.tip = `${Lang.text('m3hBonus')}: ${Match3Duel.bonusText(hero.bonus)}`;
  }

  // Экран боя
  static open(response) {
    if (!Match3Duel.container || !response?.state) {
      return;
    }

    Match3Duel.stopTimer();

    const state = response.state;

    Match3Duel.state = state;

    Match3Duel.roomId = response.id;

    Match3Duel.stopSearching();

    Match3Duel.crystalPaid = state.players?.[state.me]?.crystalPaid || 0;

    const mine = state.players?.[state.me];

    Match3Duel.readyShown = !!mine?.hero && (mine.mana || 0) >= mine.hero.ability.cost;

    const container = Match3Duel.container;

    container.replaceChildren();

    const me = state.me,
      op = 1 - me;

    Match3Duel.panels = [];

    Match3Duel.panels[me] = Match3Duel.panel(me);

    Match3Duel.panels[op] = Match3Duel.panel(op);

    Match3Duel.turnLabel = DOM({ style: 'm3d-turn' });

    Match3Duel.timerLabel = DOM({ style: 'm3d-timer' });

    Match3Duel.toast = DOM({ style: 'm3d-toast' });

    Match3Duel.surrenderButton = DOM({ domaudio: domAudioPresets.bigButton, style: ['m3d-btn', 'm3d-surrender'], event: ['click', () => Match3Duel.surrender()] }, Lang.text('match3Surrender'));

    const fieldHost = DOM({ style: 'm3d-field' });

    container.append(
      DOM(
        { style: 'm3d-screen' },
        DOM({ style: 'm3d-top' }, Match3Duel.turnLabel, Match3Duel.timerLabel),
        DOM({ style: 'm3d-middle' }, Match3Duel.panels[me].root, DOM({ style: 'm3d-field-wrap' }, fieldHost, Match3Duel.toast), Match3Duel.panels[op].root),
        DOM({ style: 'm3d-bottom' }, Match3Duel.legend(true), Match3Duel.surrenderButton),
      ),
    );

    Game.init(
      fieldHost,
      { map: state.map, chips: state.chips, rarity: state.rarity || {}, sizeX: state.sizeX, sizeY: state.sizeY, back() {}, finish() {}, exit() {} },
      true,
      {
        mode: 'duel',
        crystalId: state.crystalId || 762,
        // абсолютный адрес: url() из CSS-переменной считается от файла стилей, а не от страницы
        chipImage: (id) => `url(${new URL(Match3Duel.chipImage(id), document.baseURI).href})`,
        requestMove: (coords) => Match3Duel.requestMove(coords),
        afterMove: (request) => Match3Duel.afterMove(request),
        isBlocked: () => !Match3Duel.myTurn() || Match3Duel.busy || Match3Duel.rolling,
      },
    );

    Match3Duel.fillHero(me);

    Match3Duel.fillHero(op);

    Match3Duel.applyPlayers(state.players, false);

    Match3Duel.updateTurn();

    if (state.finished) {
      Match3Duel.showResult();
    }

    Match3Duel.timer = setInterval(() => Match3Duel.tick(), 250);

    // новый бой — рулетка выбора героев
    if (response.resumed === false && state.players.every((p) => p.hero)) {
      Match3Duel.roulette();
    }
  }

  // Портреты перебирают случайных героев и останавливаются на выпавших
  static async roulette() {
    Match3Duel.rolling = true;

    Match3Duel.updateTurn();

    Match3Duel.say(Lang.text('m3hRoulette'));

    const panels = Match3Duel.panels,
      started = Date.now();

    panels.forEach((nodes) => nodes?.root.classList.add('m3d-rolling'));

    while (Date.now() - started < 1700 && panels[0]?.root.isConnected) {
      for (const nodes of panels) {
        const id = 1 + Math.floor(Math.random() * 65);

        nodes.portrait.style.backgroundImage = `url(content/hero/${id}/1.webp)`;

        nodes.name.innerText = Match3Duel.heroName(id);
      }

      await Match3Duel.wait(90 + (Date.now() - started) / 12);
    }

    panels.forEach((nodes) => nodes?.root.classList.remove('m3d-rolling'));

    Match3Duel.rolling = false;

    if (!Match3Duel.state || Match3Duel.panels !== panels) {
      return;
    }

    Match3Duel.applyPlayers(Match3Duel.state.players, false);

    panels.forEach((nodes) => nodes?.portrait.animate({ transform: ['scale(1.15)', 'scale(1)'], filter: ['brightness(1.8)', 'brightness(1)'] }, { duration: 500, easing: 'ease-out' }));

    const mine = Match3Duel.state.players[Match3Duel.me()];

    Match3Duel.say(Match3Duel.fmt('m3hYourHero', Match3Duel.heroName(mine.heroId)));

    Match3Duel.updateTurn();
  }

  static applyPlayers(players, animate = true) {
    const s = Match3Duel.state,
      max = Match3Duel.fx().chargeMax;

    players.forEach((p, i) => {
      const full = Object.assign(s.players[i], p),
        nodes = Match3Duel.panels[i];

      if (!nodes) {
        return;
      }

      if (!Match3Duel.rolling) {
        nodes.portrait.style.backgroundImage = `url(content/hero/${full.heroId || 1}/1.webp)`;

        nodes.name.innerText = full.hero ? Match3Duel.heroName(full.heroId) : full.bot ? Lang.text('match3Bot') : full.login || '';
      }

      // в PvP рядом с ником — рейтинг до боя
      const rating = !full.bot && full.rating != null ? ` · ${full.rating}` : '';

      nodes.login.innerText = full.hero ? (full.bot ? Lang.text('match3Bot') : `${full.login || ''}${rating}`) : '';

      nodes.manaBar.style.display = full.hero ? '' : 'none';

      nodes.hpFill.style.width = `${Math.max(0, (full.hp / full.maxHp) * 100)}%`;

      nodes.hpText.innerText = `${full.hp} / ${full.maxHp}`;

      nodes.shield.innerText = String(full.shield);

      // добыча за бой (старый бэкенд её не присылает — счётчики скрыты)
      nodes.crystalStat.style.display = full.crystal === undefined ? 'none' : '';

      nodes.shardsStat.style.display = full.shards === undefined ? 'none' : '';

      nodes.crystal.innerText = String(full.crystal || 0);

      nodes.shards.innerText = String(full.shards || 0);

      // зачисленный кристалл — сразу в счётчик замка
      if (i == s.me && full.crystalPaid > (Match3Duel.crystalPaid || 0)) {
        // число — во вложенном .quest-counter (как у ярмарки и квестов: View.castleTotalCrystal.firstChild)
        const counter = document.querySelector('.crystal-container .quest-counter');

        if (counter) {
          counter.innerText = String((Number(counter.innerText) || 0) + full.crystalPaid - (Match3Duel.crystalPaid || 0));
        }

        Match3Duel.crystalPaid = full.crystalPaid;
      }

      for (const id in nodes.charges) {
        const value = full.charge?.[id] || 0,
          c = nodes.charges[id];

        c.fill.style.height = `${Math.min(100, (value / max) * 100)}%`;

        c.count.innerText = String(value);
      }

      if (full.hero) {
        const cost = full.hero.ability.cost,
          mana = full.mana || 0;

        nodes.abilityButton.style.setProperty('--mana', String(Math.min(1, mana / cost)));

        nodes.abilityMana.innerText = mana >= cost ? '' : `${mana}/${cost}`;

        // готово — когда хватает маны и (если умение стоит здоровья) здоровья
        const usable = mana >= cost && !full.abilityUsed && (!full.hero.ability.hpCost || full.hp > full.hero.ability.hpCost);

        nodes.abilityButton.classList.toggle('m3d-ability-ready', usable);

        nodes.manaFill.style.width = `${Math.min(100, (mana / cost) * 100)}%`;

        nodes.manaText.innerText = Match3Duel.res(full.hero, 'Bar', Math.min(mana, cost), cost);

        nodes.manaBar.classList.toggle('m3d-bar-mana-full', mana >= cost);

        // своё умение только что набрало ману — сообщить один раз
        if (i == s.me) {
          if (usable && !Match3Duel.readyShown) {
            Match3Duel.readyShown = true;

            Match3Duel.notifyReady(nodes, full);
          } else if (mana < cost) {
            Match3Duel.readyShown = false;
          }
        }

        Match3Duel.applyStatuses(nodes, full.status || {});
      }

      if (animate) {
        nodes.hpFill.animate({ filter: ['brightness(1.8)', 'brightness(1)'] }, { duration: 400 });
      }
    });

    Match3Duel.updateAbilityButton();
  }

  // Уведомление «умение готово»: сообщение по центру поля и мигающая метка над иконкой
  static notifyReady(nodes, player) {
    Match3Duel.sfx('M3_READY');

    Match3Duel.say(Lang.text('m3hAbilityReady').replace('{s}', Match3Duel.talentName(player.hero.passive)));

    nodes.readyNote?.animate(
      [
        { opacity: 0, transform: 'translate(0, 0) scale(0.6)' },
        { opacity: 1, transform: 'translate(0, -20%) scale(1.15)', offset: 0.15 },
        { opacity: 1, transform: 'translate(0, -20%) scale(1)', offset: 0.3 },
        { opacity: 0.35, transform: 'translate(0, -20%) scale(1)', offset: 0.45 },
        { opacity: 1, transform: 'translate(0, -20%) scale(1)', offset: 0.6 },
        { opacity: 0.35, transform: 'translate(0, -20%) scale(1)', offset: 0.75 },
        { opacity: 1, transform: 'translate(0, -20%) scale(1)', offset: 0.9 },
        { opacity: 0, transform: 'translate(0, -20%) scale(1)' },
      ],
      { duration: 3200, easing: 'ease-out' },
    );

    nodes.abilityButton.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.3)', filter: 'brightness(2)', offset: 0.3 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 900, easing: 'ease-out' },
    );
  }

  static applyStatuses(nodes, status) {
    const items = [];

    for (const [key, icon, hint] of STATUS_ICONS) {
      const st = status[key];

      if (!st) {
        continue;
      }

      let text = icon;

      if (key == 'poison' || key == 'summon') text += `${st.dmg}×${st.turns}`;
      else if (key == 'ward' && st > 1) text += st;
      else if (st.pct) text += `${st.pct}%`;

      items.push(DOM({ style: ['m3d-status', `m3d-status-${key}`], data: { tip: Lang.text(hint) } }, text));
    }

    nodes.statuses.replaceChildren(...items);
  }

  // Кнопка умения на своей панели: доступна в свой ход при полной мане
  static updateAbilityButton() {
    const s = Match3Duel.state,
      nodes = Match3Duel.panels[Match3Duel.me()];

    if (!s || !nodes) {
      return;
    }

    nodes.abilityButton.classList.toggle('m3d-ability-active', Match3Duel.canUseAbility());
  }

  static canUseAbility() {
    const s = Match3Duel.state,
      p = s?.players?.[s.me];

    return !!p?.hero && Match3Duel.myTurn() && !Match3Duel.busy && !Match3Duel.rolling && !p.abilityUsed && p.mana >= p.hero.ability.cost && (!p.hero.ability.hpCost || p.hp > p.hero.ability.hpCost);
  }

  static async useAbility() {
    if (!Match3Duel.canUseAbility()) {
      const p = Match3Duel.state?.players?.[Match3Duel.me()];

      if (p?.hero && Match3Duel.myTurn() && !Match3Duel.busy && !Match3Duel.rolling) {
        const a = p.hero.ability;

        if (p.abilityUsed) {
          Match3Duel.say(Lang.text('m3hAbilityUsed'));
        } else if ((p.mana || 0) < a.cost) {
          Match3Duel.say(Match3Duel.res(p.hero, 'Lack', p.mana || 0, a.cost));
        } else if (a.hpCost && p.hp <= a.hpCost) {
          Match3Duel.say(Match3Duel.fmt('m3hNoHp', a.hpCost, p.hp));
        }
      }

      return;
    }

    Match3Duel.busy = true;

    Game.dragEnd();

    Match3Duel.updateTurn();

    try {
      const response = await Match3Duel.request('duelAbility');

      if (response?.error) {
        Match3Duel.say(Lang.text('m3hAbilityFail'));
      }

      if (response?.state) {
        await Match3Duel.playEvents(response.events || []);

        await Match3Duel.sync(response.state);
      }
    } catch (e) {
      App.error(e);
    }

    Match3Duel.busy = false;

    Match3Duel.updateTurn();
  }

  // Всплывающие числа над панелью игрока
  static float(index, text, kind) {
    const nodes = Match3Duel.panels[index];

    if (!nodes || !text) {
      return;
    }

    const item = DOM({ style: ['m3d-float', `m3d-float-${kind}`] }, text);

    nodes.float.append(item);

    item.animate(
      [
        { transform: 'translateY(0) scale(0.8)', opacity: 0 },
        { transform: 'translateY(-2cqh) scale(1.1)', opacity: 1, offset: 0.2 },
        { transform: 'translateY(-9cqh) scale(1)', opacity: 0 },
      ],
      { duration: 1400, easing: 'ease-out', fill: 'both' },
    ).onfinish = () => item.remove();
  }

  // Копилка сработала — вспышка значка
  static pulse(index, stat) {
    const c = Match3Duel.panels[index]?.charges?.[stat];

    c?.item.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.5)', filter: 'brightness(2)', offset: 0.3 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 700, easing: 'ease-out' },
    );
  }

  // Цифры события (floats с сервера): по одной с небольшой паузой
  static async showFloats(floats) {
    const shield = Lang.text('match3Shield').toLowerCase(),
      charge = (n) => Match3Duel.fmt('match3FloatCharge', n),
      F = Match3Duel.fmt;

    for (const f of floats || []) {
      const p = f.p;

      switch (f.k) {
        case 'dmg':
          if (f.n) Match3Duel.float(p, `-${f.n}`, 'damage');
          if (f.a) Match3Duel.float(p, `-${f.a} ${shield}`, 'absorbed');
          break;
        case 'poison':
          if (f.n) Match3Duel.float(p, F('m3fPoison', f.n), 'self');
          if (f.a) Match3Duel.float(p, `-${f.a} ${shield}`, 'absorbed');
          break;
        case 'heal':
          Match3Duel.float(p, `+${f.n}`, 'heal');
          break;
        case 'shield':
          Match3Duel.float(p, `+${f.n} ${shield}`, 'shield');
          break;
        case 'charge':
          Match3Duel.float(p, charge(`+${f.n}`), 'energy');
          if (f.s) Match3Duel.pulse(p, f.s);
          break;
        case 'steal':
          if (f.n) {
            Match3Duel.float(p, charge(`+${f.n}`), 'steal');
            Match3Duel.float(1 - p, charge(`-${f.n}`), 'steal');
            Match3Duel.pulse(1 - p, f.s);
          }
          break;
        case 'burn':
          Match3Duel.float(p, charge(`-${f.n}`), 'steal');
          if (f.s) Match3Duel.pulse(p, f.s);
          break;
        case 'maxHp':
          Match3Duel.float(p, F('m3fMaxHp', f.n), 'heal');
          break;
        case 'execute':
          Match3Duel.float(p, Lang.text('m3fExecute'), 'damage');
          break;
        case 'crystal':
          Match3Duel.float(p, F('m3fCrystal', f.n), 'crystal');
          Match3Duel.sfx('M3_CRYSTAL');
          Match3Duel.say(Lang.text(p == Match3Duel.me() ? 'm3hCrystalMe' : 'm3hCrystalEnemy'));
          break;
        default: {
          // статусы и события без чисел: уворот, блок, яд, оглушение…
          const key = { dodge: 'm3fDodge', ward: 'm3fWard', warded: 'm3fWarded', poisoned: 'm3fPoisoned', stun: 'm3fStun', cleanse: 'm3fCleanse', summon: 'm3fSummon', mark: 'm3fMark', weaken: 'm3fWeaken', reflect: 'm3fReflect' }[f.k];
          if (key) Match3Duel.float(p, F(key, f.n), 'status');
        }
      }

      await Match3Duel.wait(140);
    }
  }

  static async showEffects(event) {
    const who = event.who;

    const fireSound = { 1: 'M3_BLAST', 2: 'M3_BLAST', 3: 'M3_HEAL', 4: 'M3_CHARGE', 5: 'M3_SHIELD', 6: 'M3_STEAL', 7: 'M3_CURSED' };

    (event.fired || []).forEach((f, i) => {
      Match3Duel.pulse(who, f.stat);

      setTimeout(() => Match3Duel.sfx(fireSound[f.stat]), i * 180);
    });

    if (event.floats) {
      await Match3Duel.showFloats(event.floats);
    } else {
      // старый бэкенд: цифры из fired
      const other = 1 - who,
        shield = Lang.text('match3Shield').toLowerCase();

      for (const f of event.fired || []) {
        if (f.damage) Match3Duel.float(other, `-${f.damage}`, 'damage');
        if (f.absorbed) Match3Duel.float(other, `-${f.absorbed} ${shield}`, 'absorbed');
        if (f.heal) Match3Duel.float(who, `+${f.heal}`, 'heal');
        if (f.shield) Match3Duel.float(who, `+${f.shield} ${shield}`, 'shield');
        if (f.boost) Match3Duel.float(who, Match3Duel.fmt('match3FloatCharge', `+${f.boost}`), 'energy');
        if (f.self) Match3Duel.float(who, `-${f.self}`, 'self');

        await Match3Duel.wait(180);
      }
    }

    if (event.extraTurn && !Match3Duel.state.finished) {
      Match3Duel.say(Lang.text('match3ExtraTurn'));

      Match3Duel.sfx('M3_EXTRA');
    }
  }

  static say(text) {
    if (!Match3Duel.toast) {
      return;
    }

    Match3Duel.toast.innerText = text;

    Match3Duel.toast.getAnimations().forEach((a) => a.cancel());

    Match3Duel.toast.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.7)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.15 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
      ],
      { duration: 1600, fill: 'both' },
    );
  }

  static updateTurn() {
    const s = Match3Duel.state;

    if (!s || !Match3Duel.turnLabel) {
      return;
    }

    Match3Duel.turnLabel.innerText = s.finished ? '' : Match3Duel.myTurn() ? Lang.text('match3YourTurn') : Lang.text('match3EnemyTurn');

    Match3Duel.turnLabel.classList.toggle('m3d-turn-me', Match3Duel.myTurn());

    Match3Duel.panels.forEach((nodes, i) => nodes?.root.classList.toggle('m3d-panel-active', !s.finished && s.turn == i));

    Game.blocked = !Match3Duel.myTurn() || Match3Duel.busy || Match3Duel.rolling;

    Match3Duel.updateAbilityButton();
  }

  static tick() {
    const s = Match3Duel.state;

    if (!s || !Match3Duel.timerLabel?.isConnected) {
      if (Match3Duel.timerLabel && !Match3Duel.timerLabel.isConnected) {
        Match3Duel.destroy();
      }

      return;
    }

    if (s.finished) {
      Match3Duel.timerLabel.innerText = '';

      return;
    }

    // ход сделан, но ещё не завершён (ответ сервера, анимации, ход соперника) — время не идёт
    Match3Duel.timerLabel.classList.toggle('m3d-timer-paused', Match3Duel.busy);

    if (Match3Duel.busy) {
      Match3Duel.lastBeep = 0;

      return;
    }

    const left = Math.max(0, Math.ceil((s.turnEndsAt - (Date.now() - Match3Duel.clockOffset)) / 1000));

    Match3Duel.timerLabel.innerText = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

    Match3Duel.timerLabel.classList.toggle('m3d-timer-low', left <= 5);

    if (Match3Duel.myTurn() && !Match3Duel.rolling && left > 0 && left <= 8) {
      if (left != Match3Duel.lastBeep) {
        Match3Duel.lastBeep = left;

        Match3Duel.sfx('SINGLE_TIMER');
      }
    } else {
      Match3Duel.lastBeep = 0;
    }

    // срок вышел — спрашиваем сервер (пропуск хода, ход бота); у сервера есть запас на сеть
    if (left <= 0 && !Match3Duel.busy && !Match3Duel.polling) {
      Match3Duel.poll();
    }
  }

  static async poll() {
    Match3Duel.polling = true;

    try {
      const response = await Match3Duel.request('duelState');

      if (response?.state) {
        Match3Duel.busy = true;

        Game.blocked = true;

        await Match3Duel.playEvents(response.events || []);

        await Match3Duel.sync(response.state);
      }
    } catch (e) {
      App.error(e);
    }

    Match3Duel.busy = false;

    Match3Duel.updateTurn();

    // не дёргать сервер чаще раза в секунду, пока срок не обновился
    setTimeout(() => (Match3Duel.polling = false), 1000);
  }

  // Свой ход: отдаём game.js render первого события, остальное — в afterMove
  static async requestMove(coords) {
    Match3Duel.busy = true;

    Match3Duel.updateAbilityButton();

    try {
      const response = await Match3Duel.request('duelMove', coords);

      Match3Duel.pending = response;

      const first = (response.events || [])[0];

      if (!response.error && first?.type == 'move' && first.who == Match3Duel.me()) {
        Match3Duel.moveSound(first);

        return { render: first.render };
      }

      if (response.error == 'badMove') {
        Match3Duel.sfx('M3_MISS');
      }

      return { render: [] };
    } catch (e) {
      Match3Duel.pending = null;

      App.error(e);

      return { render: [] };
    }
  }

  static async afterMove() {
    const response = Match3Duel.pending;

    Match3Duel.pending = null;

    if (response?.state) {
      let events = response.events || [];

      const first = events[0];

      if (!response.error && first?.type == 'move' && first.who == Match3Duel.me()) {
        // своё поле уже проиграно game.js — показываем только копилки и эффекты
        Match3Duel.applyPlayers(first.players);

        await Match3Duel.showEffects(first);

        events = events.slice(1);
      }

      await Match3Duel.playEvents(events);

      await Match3Duel.sync(response.state);
    }

    Match3Duel.busy = false;

    Match3Duel.updateTurn();
  }

  static wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Умение: вспышка иконки, название, поле (если умение сжигает или перекрашивает), цифры
  static async playAbility(event) {
    Match3Duel.sfx('M3_ABILITY');

    const me = Match3Duel.me(),
      nodes = Match3Duel.panels[event.who],
      p = Match3Duel.state.players[event.who];

    if (event.who != me) {
      Match3Duel.state.turn = event.who;

      Match3Duel.updateTurn();

      await Match3Duel.wait(Math.round((Match3Duel.state.botDelayMs || 900) * 0.6));
    }

    Match3Duel.say(`${Match3Duel.heroName(p?.heroId || event.heroId)}: ${Match3Duel.talentName(event.passive || p?.hero?.passive)}`);

    nodes?.abilityButton.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.35)', filter: 'brightness(2.2)', offset: 0.35 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 800, easing: 'ease-out' },
    );

    await Match3Duel.wait(450);

    if (event.render?.length) {
      await Game.playRender(event.render);
    }

    for (const c of event.convert || []) {
      Game.setChip(c.x, c.y, c.chip);
    }

    if (event.players) Match3Duel.applyPlayers(event.players);

    await Match3Duel.showEffects(event);

    await Match3Duel.wait(300);
  }

  static async playEvents(events) {
    const me = Match3Duel.me();

    for (const event of events) {
      if (!Match3Duel.container?.isConnected) {
        return;
      }

      if (event.type == 'move') {
        if (event.who != me) {
          Match3Duel.state.turn = event.who;

          Match3Duel.updateTurn();

          await Match3Duel.wait(Match3Duel.state.players?.[event.who]?.bot ? Match3Duel.state.botDelayMs || 900 : 150);

          setTimeout(() => Match3Duel.moveSound(event), 200);

          await Game.playRemoteMove(event.x1, event.y1, event.x2, event.y2, event.render);
        }

        if (event.players) Match3Duel.applyPlayers(event.players);

        await Match3Duel.showEffects(event);

        await Match3Duel.wait(350);
      } else if (event.type == 'ability') {
        await Match3Duel.playAbility(event);
      } else if (event.type == 'turn') {
        // начало хода: яд, помощники, лечение; оглушённый пропускает ход
        if (event.players) Match3Duel.applyPlayers(event.players);

        if (event.stunned) {
          Match3Duel.say(Lang.text(event.who == me ? 'm3hStunnedMe' : 'm3hStunnedEnemy'));

          Match3Duel.sfx('M3_SHIELD');
        }

        await Match3Duel.showFloats(event.floats);

        await Match3Duel.wait(event.stunned ? 900 : 300);
      } else if (event.type == 'skip') {
        if (event.players) Match3Duel.applyPlayers(event.players);

        Match3Duel.say(event.who == me ? Lang.text('match3SkipMe') : Lang.text('match3SkipEnemy'));

        await Match3Duel.wait(900);
      } else if (event.type == 'shuffle') {
        Match3Duel.say(Lang.text('match3Shuffle'));

        Match3Duel.sfx('M3_SHUFFLE');

        await Game.rebuild(event.map, event.chips);
      } else if (event.type == 'finish') {
        if (event.players) Match3Duel.applyPlayers(event.players);
      }

      if (event.turn !== undefined) {
        Match3Duel.state.turn = event.turn;

        Match3Duel.state.turnEndsAt = event.turnEndsAt;
      }
    }
  }

  // Контрольная сумма поля на экране — как Match3Duel.hash на сервере
  static localHash(state) {
    let h = 2166136261;

    for (let x = 0; x < state.sizeX; x++) {
      for (let y = 0; y < state.sizeY; y++) {
        const unit = document.getElementById(`${x}:${y}`);

        h = Math.imul(h ^ (Number(unit?.dataset.talent) | 0), 16777619) >>> 0;

        h = Math.imul(h ^ (Number(unit?.dataset.chip) | 0), 16777619) >>> 0;
      }
    }

    return h.toString(16);
  }

  // Итоговое состояние сервера; если поле разошлось — взять полное и перерисовать
  static async sync(state) {
    const wasFinished = Match3Duel.state?.finished;

    Match3Duel.state = Object.assign({}, Match3Duel.state, state);

    Match3Duel.applyPlayers(state.players, false);

    if (state.hash && Match3Duel.localHash(state) != state.hash) {
      let map = state.map,
        chips = state.chips;

      if (!map) {
        const full = await Match3Duel.request('duelState').catch(() => null);

        map = full?.state?.map;

        chips = full?.state?.chips;
      }

      if (map) {
        await Game.rebuild(map, chips);
      }
    }

    Match3Duel.updateTurn();

    if (Match3Duel.state.finished && !wasFinished) {
      Match3Duel.showResult();
    }
  }

  static async surrender() {
    const button = Match3Duel.surrenderButton;

    if (!button || Match3Duel.state?.finished) {
      return;
    }

    // первое нажатие — подтверждение
    if (!button.classList.contains('m3d-confirm')) {
      button.classList.add('m3d-confirm');

      button.innerText = Lang.text('match3SurrenderConfirm');

      setTimeout(() => {
        if (button.isConnected) {
          button.classList.remove('m3d-confirm');

          button.innerText = Lang.text('match3Surrender');
        }
      }, 3000);

      return;
    }

    try {
      const response = await Match3Duel.request('duelSurrender');

      if (response?.state) {
        await Match3Duel.sync(response.state);
      }
    } catch (e) {
      App.error(e);
    }
  }

  static showResult() {
    const s = Match3Duel.state;

    if (!s || !Match3Duel.container) {
      return;
    }

    Match3Duel.container.querySelector('.m3d-result')?.remove();

    Game.blocked = true;

    const win = s.winner == s.me;

    Match3Duel.sfx(win ? 'M3_WIN' : 'M3_LOSE');

    const reason = { hp: 'match3ReasonHp', timeout: win ? 'match3ReasonTimeoutWin' : 'match3ReasonTimeoutLose', surrender: win ? 'match3ReasonSurrenderWin' : 'match3ReasonSurrenderLose' }[s.reason];

    if (Match3Duel.surrenderButton) {
      Match3Duel.surrenderButton.style.visibility = 'hidden';
    }

    Match3Duel.container.querySelector('.m3d-screen')?.append(
      DOM(
        { style: ['m3d-result', win ? 'm3d-result-win' : 'm3d-result-lose'] },
        DOM(
          { style: 'm3d-result-box' },
          DOM({ tag: 'h1' }, Lang.text(win ? 'match3Win' : 'match3Lose')),
          reason ? DOM({ tag: 'p' }, Lang.text(reason)) : DOM(),
          Match3Duel.ratingResult(),
          Match3Duel.lootSummary(),
          DOM(
            { style: 'm3d-result-buttons' },
            DOM({ domaudio: domAudioPresets.bigButton, style: 'm3d-btn', event: ['click', () => Match3Duel.render(Match3Duel.container).then(() => Match3Duel.search())] }, Lang.text('match3FindOpponent')),
            DOM({ domaudio: domAudioPresets.bigButton, style: 'm3d-btn', event: ['click', () => Match3Duel.start()] }, Lang.text('match3VsBot')),
            DOM({ domaudio: domAudioPresets.bigButton, style: 'm3d-btn', event: ['click', () => Match3Duel.render(Match3Duel.container)] }, Lang.text('match3Exit')),
          ),
        ),
      ),
    );
  }

  // Что игрок добыл за бой: осколки и кристалл (и зачислен ли он на счёт)
  static lootSummary() {
    const s = Match3Duel.state,
      p = s?.players?.[s.me],
      op = s?.players?.[1 - s.me];

    if (!p || p.shards === undefined) {
      return DOM();
    }

    const lines = [DOM({ tag: 'p', style: 'm3d-result-loot' }, Match3Duel.fmt('m3hLoot', p.shards || 0, p.crystal || 0))];

    if (p.crystal > 0) {
      lines.push(DOM({ tag: 'p', style: 'm3d-hint' }, Lang.text(p.crystalPaid > 0 ? 'm3hCrystalPaid' : op?.bot ? 'm3hCrystalBotNote' : 'm3hCrystalLater')));
    }

    return DOM({}, ...lines);
  }

  static stopTimer() {
    if (Match3Duel.timer) {
      clearInterval(Match3Duel.timer);
    }

    Match3Duel.timer = 0;
  }

  // Окно закрыли или вкладку сменили: бой на сервере идёт дальше, вернуться можно позже
  static destroy() {
    Match3Duel.stopTimer();

    Match3Duel.stopSounds();

    Match3Duel.roomId = 0;

    Game.dragEnd();

    Match3Duel.state = null;

    Match3Duel.busy = false;

    Match3Duel.polling = false;

    Match3Duel.rolling = false;

    Match3Duel.readyShown = false;

    Match3Duel.pending = null;

    Match3Duel.panels = [];

    Match3Duel.turnLabel = null;

    Match3Duel.timerLabel = null;

    Match3Duel.toast = null;

    Match3Duel.surrenderButton = null;
  }
}
