// Use the real TEST launcher with its existing local-only castle fixture.
import { App } from './app.js';
import { CastleFarm } from './castleFarm.js';
import { Castle } from './castle.js';
import { View } from './view.js';

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
