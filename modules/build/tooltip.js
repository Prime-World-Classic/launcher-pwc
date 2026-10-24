// Панель описания таланта и сета. Есть данные игры — подсказка как в клиенте (BuildClientTooltip),
// нет — прежняя из lang/talent_data с подстановкой чисел от статов героя. В обеих откат
// (<cd>) пересчитывается по снижению отката героя и бонусам сетов.

import { Lang } from '../lang.js';
import { BuildClientTooltip } from '../buildClientTooltip.js';
import { uiIcon } from '../uiIcon.js';
import { Sets } from './sets.js';
import { REFINE_BY_RARITY, refineBonus, statWithRefine, isConditionalStatKey } from './talents.js';
import { TALENT_COOLDOWN_PCT_MAX } from './stats.js';

const RARITY_RGB = { 1: '17,105,237', 2: '205,0,205', 3: '237,129,5', 4: '170,20,44' };

// составные «от статов» в params старых описаний
const PARAM_MAX = { sr_max: ['sila', 'razum'], sv_max: ['stoikost', 'volia'], ph_max: ['provorstvo', 'hitrost'], hr_max: ['hitrost', 'razum'], hpmp_max: ['hp', 'mp'] };
const PARAM_SUM = { sr_sum: ['sila', 'razum'], ph_sum: ['provorstvo', 'hitrost'], sv_sum: ['stoikost', 'volia'], hpmp_sum: ['hp', 'mp'] };
const STAT_ROWS = new Set(['hp', 'mp', 'speed', 'regenhp', 'regenmp', 'krajahp', 'krajamp', 'talentCdPct', 'sila', 'razum', 'provorstvo', 'hitrost', 'stoikost', 'volia', 'damage', 'critProb', 'attackSpeed', 'punching', 'protectionBody', 'protectionSpirit']);

const formatNumber = (value) => {
  const text = value.toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
};

export class Tooltip {
  constructor(ed) {
    this.ed = ed;
    this.view = document.createElement('div');
    this.view.className = 'build-description';
    this.view.style.display = 'none';
    this.view.onmouseover = () => this.hide();
    this.token = 0;
    this.anchor = null; // талант, чья подсказка показана
    this.pinnedSet = null; // элемент сета, чья подсказка показана
    document.body.append(this.view);
  }

  get shown() {
    return this.view.style.display !== 'none';
  }

  hide() {
    this.token++;
    this.anchor = null;
    this.pinnedSet = null;
    this.view.style.display = 'none';
  }

  destroy() {
    this.hide();
    this.view.remove();
  }

  render(html, rect, { talent = null, client = false } = {}) {
    this.view.innerHTML = html || '';
    this.view.classList.toggle('build-description--client', client);
    this.view.style.display = 'block';
    if (talent && !client) this.applyParams(talent);
    this.applyCooldown(talent);
    this.place(rect);
    requestAnimationFrame(() => this.place(rect));
    for (const img of this.view.querySelectorAll('img')) {
      if (!img.complete) img.addEventListener('load', () => this.place(rect), { once: true });
    }
  }

  place(rect) {
    if (!this.view.isConnected || !rect) return;
    Object.assign(this.view.style, { zIndex: 9999, position: 'fixed' });
    let top = rect.top;
    const over = top + this.view.offsetHeight - window.innerHeight;
    if (over > 0) top -= over;
    this.view.style.left = `${rect.left + rect.width + 8}px`;
    this.view.style.top = `${Math.max(0, top)}px`;
  }

  // Подсказка таланта под элементом
  showTalent(element, talent) {
    const rect = element.getBoundingClientRect();
    const token = ++this.token;
    this.anchor = element;
    this.pinnedSet = null;
    if (BuildClientTooltip.available(talent.id)) {
      const initToken = this.ed.token;
      BuildClientTooltip.render(this.ed.clientHost, talent)
        .catch((error) => {
          console.warn(`Подсказка таланта ${talent.id} из данных игры не построена`, error);
          return null;
        })
        .then((html) => {
          // пока строилась: увели курсор, сменили героя/билд или иконка ушла со страницы
          if (token !== this.token || initToken !== this.ed.token || !element.isConnected) return;
          if (html) this.render(html, rect, { talent: { id: talent.id }, client: true });
          else this.render(this.legacyTalentHtml(talent), rect, { talent });
        });
      return;
    }
    this.render(this.legacyTalentHtml(talent), rect, { talent });
  }

  legacyTalentHtml(talent) {
    const prefix = talent.id < 0 ? 'htalent_' : 'talent_';
    const nameKey = `${prefix}${Math.abs(talent.id)}_name`;
    const descriptionKey = `${prefix}${Math.abs(talent.id)}_description`;
    const name = Lang.text(nameKey);
    const description = Lang.text(descriptionKey);
    if (name === nameKey || description === descriptionKey) {
      return `<b>Талант #${talent.id}</b><div>Информация отсутствует. Сообщите пожалуйста об этом в отдельную тему Telegram сообщества Prime World Classic.</div><span>+1000 Уважение</span>`;
    }
    const rarity = [1, 2, 3, 4].includes(talent.rarity) ? talent.rarity : 0;
    let stats = '';
    for (const key in talent.stats || {}) {
      if (isConditionalStatKey(key)) continue;
      const value = Math.floor(statWithRefine(talent, key) * 10.0) / 10.0;
      if (key.startsWith('speedtal')) stats += Math.abs(value) < 1e-9 ? `0 ${Lang.text(key)}<br>` : `-${Math.abs(value)} ${Lang.text(key)}<br>`;
      else stats += `+${value} ${Lang.text(key)}<br>`;
    }
    // звёзды заточки: по пять, чередуя золотые и оранжевые
    const refine = REFINE_BY_RARITY[rarity || 4];
    const size = window.innerHeight * 0.015;
    const star = (i) => `<img src="content/icons/${Math.floor(i / 5) % 2 ? 'starOrange27' : 'starGold'}.webp" width=${size} height=${size}>`;
    const stars = refine > 15 ? `${refine}${star(5)}` : Array.from({ length: refine }, (_, i) => star(i)).join('');
    const classTalent = rarity ? '' : `${Lang.text('classTalent')}<br>`;
    return `<b style="color:rgb(${RARITY_RGB[rarity] || ''})">${name}</b><div><b>${classTalent}</b>${stars} <br><br> ${description} </div><span>${stats}</span>`;
  }

  // Подсказка сета у его иконки: набор игры с главным талантом или описание главного таланта
  showSet(set, element, mode) {
    const token = ++this.token;
    this.anchor = null;
    this.pinnedSet = element;
    const rect = element.getBoundingClientRect();
    const icons = set.ids
      .map((id) => `<img class="build-set-desc-icon${this.ed.inBuild(id) ? ' is-in-build' : ''}" src="content/talents/${id}.webp">`)
      .join('');
    const lmb = Lang.text(mode === 2 ? 'setHintLmbMode2' : mode === 3 ? 'setHintLmbMode3' : 'setHintLmb');
    const rmb = Lang.text(mode === 3 ? 'setHintRmbMode3' : 'setHintRmb');
    const footer = `<div class="build-set-desc-icons">${icons}</div><div class="build-set-desc-hints"><div>${lmb}</div><div>${rmb}</div></div>`;
    const main = set.mainId != null ? this.ed.talents.get(Number(set.mainId)) || { id: set.mainId } : null;
    const legacy = () => {
      const absId = Math.abs(set.mainId);
      const desc = set.mainId != null
        ? `<div class="build-set-main-desc"><b>${Lang.text(`talent_${absId}_name`)}</b><br><br>${Lang.text(`talent_${absId}_description`)}</div>`
        : '';
      this.render(desc + footer, rect, { talent: this.ed.talents.get(Number(set.mainId)) || null });
    };
    if (!main || !BuildClientTooltip.available(main.id)) return legacy();
    const initToken = this.ed.token;
    BuildClientTooltip.renderSet(this.ed.clientHost, main)
      .then((html) => html || BuildClientTooltip.render(this.ed.clientHost, main, { frame: false }))
      .catch(() => null)
      .then((html) => {
        if (token !== this.token || initToken !== this.ed.token || !element.isConnected) return;
        if (!html) return legacy();
        this.render(`<div class="pw-tt pw-tt-frame pw-tt-set">${html}${BuildClientTooltip.separatorHtml()}${footer}</div>`, rect, {
          talent: { id: main.id },
          client: true,
        });
      });
  }

  // показанную подсказку таланта — заново (статы билда поменялись)
  refresh() {
    const element = this.anchor;
    if (!this.shown || !element?.isConnected) return;
    const talent = this.ed.talents.get(Number(element.dataset.id));
    if (talent) this.showTalent(element, talent);
  }

  // Старые описания: «%s» по очереди заменяются числами из params таланта —
  // «min,max,стат» (заточка) или «?,min,max,?,стат» (от стата героя)
  applyParams(talent) {
    const params = String(talent.params || '').split(';').filter(Boolean);
    if (!params.length) return;
    const engine = this.ed.engine;
    let index = 0;
    for (const outer of this.view.querySelectorAll('*')) {
      for (const node of outer.childNodes) {
        const source = node.innerHTML ? node.innerHTML : node.data;
        if (!source || !source.includes('%s')) continue;
        if (index >= params.length) return;
        const values = params[index].split(',').map((value) => value.trim());
        let min;
        let max;
        let stat;
        let byStat = false;
        let options = [];
        if (values.length >= 5) {
          [, min, max, , stat, ...options] = values;
          byStat = true;
        } else if (values.length >= 3) [min, max, stat, ...options] = values;
        else continue;
        min = parseFloat(min);
        max = parseFloat(max);
        index++;
        if (!Number.isFinite(min) || !Number.isFinite(max) || !stat) continue;
        let value;
        const lerp = (total, hpLike) => min + ((total - (hpLike ? 600 : 50)) / (hpLike ? 6250 : 250)) * (max - min);
        if (PARAM_SUM[stat]) {
          const [a, b] = PARAM_SUM[stat];
          value = lerp(engine.total(a) + engine.total(b), ['hp', 'mp'].includes(a) || ['hp', 'mp'].includes(b));
        } else {
          const resolved = PARAM_MAX[stat] ? engine.pick(PARAM_MAX[stat]) : stat;
          value = STAT_ROWS.has(resolved) && byStat ? lerp(engine.total(resolved), resolved === 'hp' || resolved === 'mp') : min + max * refineBonus(talent.rarity);
        }
        if (!Number.isFinite(value)) continue;
        // min:/max: в params — ограничения (так сложилось: min — сверху, max — снизу)
        const limit = (name) => {
          const m = options.map((option) => new RegExp(`^${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)$`, 'i').exec(option)).filter(Boolean).pop();
          return m ? Number(m[1]) : null;
        };
        if (limit('min') !== null) value = Math.min(value, limit('min'));
        if (limit('max') !== null) value = Math.max(value, limit('max'));
        if (node.innerHTML) node.innerHTML = source.replace('%s', formatNumber(value));
        else outer.innerHTML = source.replace('%s', formatNumber(value));
      }
    }
  }

  // <cd>N</cd> -> «N ⟶ M», M — с учётом снижения отката героя и бонусов сетов (в скобках — без сетов)
  applyCooldown(talent) {
    const nodes = this.view.querySelectorAll('cd');
    if (!nodes.length) return;
    const delta = Number.isFinite(Number(talent?.id)) ? Sets.cooldownDelta(talent.id, this.ed.effectiveBody()) : 0;
    const pct = Math.max(0, Math.min(TALENT_COOLDOWN_PCT_MAX, Number(this.ed.engine.total('speedtal')) || 0));
    if (pct <= 0 && delta === 0) return;
    const format = (value) => {
      const rounded = Math.round(Number(value) * 10) / 10;
      return Number.isFinite(rounded) ? String(rounded) : null;
    };
    for (const node of nodes) {
      const text = String(node.textContent || '').trim();
      let base = NaN;
      if (/^\d+(?:[.,]\d+)?$/.test(text)) base = Number(text.replace(',', '.'));
      else if (!text && node.parentElement) {
        // число стоит рядом с пустым <cd>
        const siblings = [...node.parentElement.childNodes].filter((n) => n !== node && n.nodeType === 3);
        const near = siblings.map((n) => n.textContent).join('').trim();
        if (/^\d+(?:[.,]\d+)?$/.test(near)) {
          base = Number(near.replace(',', '.'));
          for (const n of siblings) n.textContent = '';
        }
      }
      if (!(base > 0)) continue;
      const plain = format(base * (1 - pct / 100));
      const withSets = format(Math.max(0, base + delta) * (1 - pct / 100));
      const baseText = format(base);
      if (!plain || !withSets || !baseText) continue;
      const right = withSets !== plain && plain !== baseText ? `${withSets}(${plain})` : withSets;
      node.replaceChildren(`${baseText} `, uiIcon('send'), ` ${right}`);
    }
  }
}
