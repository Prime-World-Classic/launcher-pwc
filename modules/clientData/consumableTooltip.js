// Подсказка расходника как в игре (Items/Consumables/<имя>.ARCT): тот же разбор разметки и формул,
// что у таланта, но имена значений — из карты расходника игры (PFConsumable + PFAbilityData):
// abilityName/name, manaCost, cooldown, rank, moneyCost, const.<имя>, if.<условие>, unit.<стат>.
// Панель действий в бою показывает shortDescription, магазин — description (с ценой).

import { ClientData } from './clientData.js';
import { TalentTooltip } from './talentTooltip.js';
import { precompileMarkup, renderUiMarkup, formatValue } from './tooltipMarkup.js';

export class ConsumableTooltip extends TalentTooltip {
  static async create(name, hero, lang) {
    const consumable = await ClientData.consumable(name);
    if (!consumable) return null;
    const tooltip = new ConsumableTooltip(consumable, hero, { refineRate: 0, level: 0, bought: true, inBuild: false }, lang);
    await tooltip.preload();
    return tooltip;
  }

  // расходник не входит в наборы талантов
  kit() {
    return null;
  }

  cond(path) {
    if (path.startsWith('if.')) {
      const name = path.slice(3);
      const value = this.condition(name);
      if (value !== null) return value;
      return this.typeCondition(name);
    }
    return super.cond(path);
  }

  // условия вида способности из подсказок талантов (у расходников своих нет)
  typeCondition(name) {
    const type = this.talent.type;
    switch (name) {
      case 'TalentActive':
        return type === 'Active' || type === 'MultiActive';
      case 'TalentPassive':
        return type === 'Passive';
      case 'TalentToggle':
        return type === 'Switchable';
      case 'TalentChannelling':
        return type === 'Channelling';
      case 'NoTypeTalant':
        return type === 'Simple' || type === 'AutoCastable';
      case 'manaCost_e0':
        return !this.evaluate(this.talent, 0, this.talent.manaCost);
      case 'CooldownZero':
        return !!this.evaluate(this.talent, 0, this.talent.cooldown);
      default:
        return null;
    }
  }

  value(path, params) {
    const t = this.talent;
    if (path.startsWith('const.')) return this.constant(t, 0, path.slice(6));
    switch (path) {
      case 'abilityName':
      case 'name':
        return this.name();
      case 'manaCost':
        return this.evaluate(t, 0, t.manaCost);
      case 'cooldown':
        return formatValue(this.evaluate(t, 0, t.cooldown), params?.format);
      case 'rank':
        return 1;
      case 'moneyCost':
        return Math.max(0, t.naftaCost);
      default:
        return super.value(path, params);
    }
  }

  // short: как на панели действий в бою (без цены), иначе — как в магазине
  async html({ short = false } = {}) {
    const texts = this.talent.texts[this.lang] || this.talent.texts.ru;
    const source = (short && texts.shortDescription) || texts.description || texts.commonDescription || '';
    const env = this.env();
    const ui = precompileMarkup(source, env, this.macros());
    await TalentTooltip.preloadImages(ui);
    return renderUiMarkup(ui, env);
  }
}
