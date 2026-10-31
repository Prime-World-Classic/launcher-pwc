// Use the real TEST launcher with its existing local-only castle fixture.
import { App } from './app.js';
import { CastleFarm } from './castleFarm.js';
import { Castle } from './castle.js';
import { View } from './view.js';
import { Window } from './window.js';

const url = new URL(window.location.href);
url.searchParams.set('previewCastle', '1');
history.replaceState(null, '', url);

if (url.searchParams.get('previewConstruction') === 'unowned') {
  const startPreview = CastleFarm.startPreview.bind(CastleFarm);
  CastleFarm.startPreview = () => {
    startPreview();
    CastleFarm.previewBought = new Set();
    CastleFarm.previewBuildings = {};
    CastleFarm.apply(CastleFarm.previewState());
  };
  const showCastle = App.showCastlePreview.bind(App);
  App.showCastlePreview = async () => {
    await showCastle();
    Castle.placedBuildings = Castle.placedBuildings.filter((building) => Castle.getBuildingCategory(Castle.buildings[building.id]) !== 'production');
    Castle.UpdateAllowedToBuildGrid();
    View.castleBuildingCategory = 'production';
    View.bodyCastleBuildings();
    Castle.buildMode = true;
  };
}

if (url.searchParams.get('previewWindow') === 'quest') {
  const showCastle = App.showCastlePreview.bind(App);
  App.showCastlePreview = async () => {
    await showCastle();
    const status = { new: 0, active: 1, ready: 2 }[url.searchParams.get('previewQuestState')] ?? 0;
    const selectedHero = url.searchParams.get('previewQuest') === 'laguna' ? 66 : 67;
    const heroes = structuredClone(View.castleHeroAll);
    const quests = [
      ...[67, 66].map((heroId) => ({
        id: -heroId, heroId, day: 0, status: heroId === selectedHero ? status : 0, timer: 0,
        reward: { crystal: 20, hero: heroId }, rewardHeroId: heroId,
        title: `Зов ${heroId === 67 ? 'Тауруса' : 'Лагуны'}`,
        description: heroId === 67
          ? 'Мой лорд! Из Пограничья доносится топот — земля дрожит, будто стадо быков рвётся в бой. Я, Таурус, не служу тем, кто прячется за чужими спинами. Сила уважает только силу. Ступай в Пограничье, ломай вражеский строй, стой плечом к плечу с союзниками и побеждай. Покажи, что твой напор крепче моих рогов, — и я пойду за тобой.'
          : 'Выполните условия квеста, чтобы герой появился на панели Героев. Это локальный пример окна; реальные квесты и покупки не меняются.',
        target: 'В режиме Пограничье (любым героем): победить 1 раз, сыграть 4 боя, совершить 20 убийств и оказать 20 поддержек. Условия засчитываются одновременно и суммируются за все бои.',
        total: 45, score: heroId === selectedHero && status === 2 ? 45 : 0,
      })),
      { id: -101, heroId: 20, day: 1, status: 1, timer: 86355000, reward: { crystal: 20 },
        title: 'Ежедневное задание', description: 'Помогите союзникам в Пограничье.', target: 'Сыграйте четыре боя.', total: 4, score: 2 },
      { id: -102, heroId: 1, day: 7, status: 1, timer: 604755000, reward: { crystal: 40 },
        title: 'Недельное задание', description: 'Проверьте свои силы в бою.', target: 'Сыграйте десять боёв.', total: 10, score: 4 },
    ];
    // Isolated fixture: all actions stay in memory, including the simulated server grant.
    const request = async (module, method, data) => {
      if (module === 'quest' && method === 'list') return structuredClone({ crystal: 126, quests: quests.filter((quest) => quest.status !== 4) });
      if (module === 'quest') {
        const quest = quests.find((item) => item.id === Number(data?.id));
        if (!quest) throw new Error('Preview quest not found');
        if (method === 'get') return structuredClone({ ...quest, status: String(quest.status) });
        if (method === 'start' && quest.status === 0) { quest.status = 1; return {}; }
        if (method === 'finish' && quest.status === 2) { quest.status = 4; return {}; }
      }
      if (module === 'build' && method === 'heroAll') {
        const unlocked = quests.filter((quest) => quest.rewardHeroId && [2, 4].includes(quest.status));
        return structuredClone([...heroes, ...unlocked.map((quest) => ({ id: quest.rewardHeroId, skin: 1, rating: 1000, favourite: 0 }))]);
      }
      throw new Error(`Preview API is not enabled: ${module}/${method}`);
    };
    App.api = { request, silent: async (callback, ...args) => callback(await request(...args)) };
    View.active.append(View.castleQuestBody);
    await View.castleQuestUpdate();
    const selected = url.searchParams.get('previewQuest') === 'ordinary' ? quests[2]
      : url.searchParams.get('previewQuest') === 'weekly' ? quests[3] : quests.find((quest) => quest.heroId === selectedHero);
    await Window.show('main', 'quest', selected);
  };
}

if (url.searchParams.get('previewWindow') === 'news') {
  const showCastle = App.showCastlePreview.bind(App);
  App.showCastlePreview = async () => {
    await showCastle();
    App.notificationsNews = [
      { id: -301, title: 'Обновление 3.0.0', message: 'Новое в замке и подготовке к бою.' },
      { id: -302, title: 'Обновление 2.16.2', message: 'Исправления и улучшения интерфейса.', is_read: true },
      { id: -303, title: 'Обновление 4.0.0', message: 'Следующее крупное обновление.', is_read: true },
    ].map((item) => App.normalizeNotificationNews({ ...item, is_external: true }));
    App.notificationsNewsSelectedId = -301;
    App.notificationsNewsUnreadCount = 1;
    App.notificationsActiveTab = 'news';
    // Only this isolated fixture replaces network/persistent read actions.
    App.loadNotificationNews = async () => App.renderNotificationsPanel();
    App.refreshNotifications = async () => App.renderNotificationsPanel();
    App.markNotificationNewsRead = async (id) => {
      const item = App.notificationsNews.find((current) => current.id === id);
      if (item) item.is_read = true;
      App.notificationsNewsUnreadCount = App.notificationsNews.filter((current) => !current.is_read).length;
    };
    App.markAllNotificationNewsRead = async () => {
      for (const item of App.notificationsNews) await App.markNotificationNewsRead(item.id);
      App.renderNotificationsPanel();
    };
    App.openNotificationsPanel();
    App.notificationsTabs.notifications.style.display = 'none';
  };
}

import('./_modules.js');
