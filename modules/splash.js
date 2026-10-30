export class Splash {
  static body = null;

  static init() {
    if (Splash.body) return;

    Splash.body = document.createElement('div');
    Splash.body.classList.add('splash');
    Splash.body.style.display = 'none';
    Splash.body.style.zIndex = '9999';

    document.body.append(Splash.body);
  }

  static showMenu(titleModal, ...items) {
    if (!Splash.body) Splash.init();

    Splash.body.innerHTML = '';
    Splash.body.style.background = '';
    Splash.body.classList.remove('splash--blur');

    const menu = DOM(
      { id: 'wcastle-menu' },
      DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, titleModal)),
      DOM({ style: 'castle-menu-items' }, ...items)
    );

    Splash.body.append(menu);
    Splash.body.style.display = 'flex';
  }

  static show(element, content = true) {
    if (!Splash.body) Splash.init();

    Splash.body.style.background = '';
    Splash.body.classList.remove('splash--blur');

    if (Splash.body.firstChild) {
      while (Splash.body.firstChild) {
        Splash.body.firstChild.remove();
      }
    }

    if (content) {
      let body = document.createElement('div');
      body.classList.add('splash-content');
      body.append(element);
      if (body.querySelector('.title-modal')) {
        body.classList.add('splash-content--titled');
      }
      if (body.querySelector('.splash-help')) {
        body.classList.add('splash-content--help-titled');
      }
      Splash.body.append(body);
    } else {
      Splash.body.append(element);
    }

    Splash.body.style.display = 'flex';
  }

  static hide() {
    if (Splash.body) {
      Splash.body.style.display = 'none';
      Splash.body.style.background = '';
      Splash.body.classList.remove('splash--blur');
    }
  }
}
