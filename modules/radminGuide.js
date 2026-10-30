import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { NativeAPI } from './nativeApi.js';

export class RadminGuide {
  static enabled = false;

  static DOWNLOAD_URL = 'https://www.radmin-vpn.com/';

  static VK_URL = 'https://vk.com/primeworld';

  static TELEGRAM_URL = 'https://t.me/primeworldclassic';

  static CHECK_INTERVAL_MS = 4000;

  static CONNECTION_TIMEOUT_MS = 5000;

  static root = null;

  static dismissed = false;

  static status = null;

  static createInstructionItem(number, content) {
    return DOM(
      { tag: 'li', style: 'radmin-guide__step' },
      DOM({ style: 'radmin-guide__step-number' }, `${number}`),
      DOM({ style: 'radmin-guide__step-text' }, content),
    );
  }

  static createDownloadLink() {
    return DOM(
      {
        tag: 'a',
        style: 'radmin-guide__link',
        href: RadminGuide.DOWNLOAD_URL,
        target: '_blank',
        rel: 'noopener noreferrer',
        event: ['click', (event) => NativeAPI.linkHandler(event)],
      },
      'radmin-vpn.com',
    );
  }

  static createSupportLink(url, icon, label) {
    return DOM(
      {
        tag: 'a',
        style: 'radmin-guide__support-link',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        event: ['click', (event) => NativeAPI.linkHandler(event)],
      },
      DOM({ tag: 'img', src: icon, alt: '', ariaHidden: 'true' }),
      DOM({ tag: 'span' }, label),
    );
  }

  static dismiss() {
    RadminGuide.dismissed = true;
    RadminGuide.hide();
  }

  static show() {
    if (!RadminGuide.enabled || RadminGuide.dismissed || RadminGuide.root?.isConnected) {
      return;
    }

    const downloadStep = document.createDocumentFragment();
    downloadStep.append(Lang.text('radminGuideStepDownload'), ' ', RadminGuide.createDownloadLink(), '.');
    RadminGuide.status = DOM(
      { style: 'radmin-guide__status', role: 'status', ariaLive: 'polite' },
      DOM({ style: 'radmin-guide__spinner', ariaHidden: 'true' }),
      DOM({ style: 'radmin-guide__status-text' }, Lang.text('radminGuideWaiting')),
    );

    const root = DOM(
      { id: 'radmin-connection-guide', style: 'radmin-guide-overlay' },
      DOM(
        { style: ['splash-content', 'splash-content--titled', 'radmin-guide'] },
        DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('radminGuideTitle'))),
        DOM(
          {
            tag: 'button',
            style: 'close-button',
            type: 'button',
            title: Lang.text('titleClose'),
            ariaLabel: Lang.text('titleClose'),
            event: ['click', () => RadminGuide.dismiss()],
          },
          DOM({ tag: 'img', src: 'content/icons/close-cropped.svg', alt: '', style: 'close-image-style' }),
        ),
        DOM(
          { tag: 'div', style: 'radmin-guide__content' },
          RadminGuide.status,
          DOM({ tag: 'p', style: 'radmin-guide__description' }, Lang.text('radminGuideDescription')),
          DOM({ tag: 'p', style: 'radmin-guide__intro' }, Lang.text('radminGuideIntro')),
          DOM(
            { tag: 'ol', style: 'radmin-guide__steps' },
            RadminGuide.createInstructionItem(1, downloadStep),
            RadminGuide.createInstructionItem(2, Lang.text('radminGuideStepNetwork')),
            RadminGuide.createInstructionItem(3, Lang.text('radminGuideStepVpn')),
            RadminGuide.createInstructionItem(4, Lang.text('radminGuideStepSettings')),
            RadminGuide.createInstructionItem(5, Lang.text('radminGuideStepTest')),
          ),
          DOM(
            { style: 'radmin-guide__support' },
            DOM({ tag: 'p', style: 'radmin-guide__support-text' }, Lang.text('radminGuideSupport')),
            DOM(
              { style: 'radmin-guide__support-links' },
              RadminGuide.createSupportLink(
                RadminGuide.VK_URL,
                'content/icons/vk.webp',
                Lang.text('radminGuideVk'),
              ),
              RadminGuide.createSupportLink(
                RadminGuide.TELEGRAM_URL,
                'content/icons/telegram.webp',
                Lang.text('radminGuideTelegram'),
              ),
            ),
          ),
        ),
      ),
    );

    document.body.append(root);
    RadminGuide.root = root;
  }

  static hide() {
    RadminGuide.root?.remove();
    RadminGuide.root = null;
    RadminGuide.status = null;
  }

  static setStatus(message, isError = false) {
    RadminGuide.show();
    if (!RadminGuide.status) return;
    RadminGuide.status.classList.toggle('radmin-guide__status--error', isError);
    RadminGuide.status.querySelector('.radmin-guide__status-text').textContent = message;
  }

  static connectAnyHost(hosts) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(hosts) || hosts.length === 0) {
        reject(new Error(Lang.text('radminGuideNoHosts')));
        return;
      }

      let settled = false;
      let pending = hosts.length;
      const failures = [];
      const cleanups = [];

      hosts.forEach((host, index) => {
        let socket = null;
        let finished = false;
        const cleanup = (close = true) => {
          clearTimeout(timer);
          if (!socket) return;
          socket.onopen = null;
          socket.onerror = null;
          socket.onclose = null;
          if (close && socket.readyState < WebSocket.CLOSING) {
            try {
              socket.close();
            } catch {}
          }
        };
        const fail = (message) => {
          if (settled || finished) return;
          finished = true;
          cleanup();
          // Метка хоста без токена: токен сессии в текст ошибки не попадает.
          const label = String(host).replace(/^[a-z]+:\/\//i, '').split('/')[0];
          failures[index] = `${label}: ${message || Lang.text('radminGuideApiUnavailable').replace('{number}', index + 1)}`;
          pending -= 1;
          if (pending === 0) {
            settled = true;
            reject(new Error(failures.join('\n')));
          }
        };
        const timer = setTimeout(() => fail(Lang.text('radminGuideTimeout')), RadminGuide.CONNECTION_TIMEOUT_MS);
        cleanups[index] = cleanup;

        try {
          socket = new WebSocket(host);
          socket.onopen = () => {
            if (settled || finished) return;
            settled = true;
            cleanups.forEach((dispose, otherIndex) => dispose(otherIndex !== index));
            resolve({ socket, index });
          };
          socket.onerror = () => fail(Lang.text('radminGuideConnectionError'));
          socket.onclose = (event) => fail(Lang.text('radminGuideClosed').replace('{code}', event.code));
        } catch (error) {
          fail(`${Lang.text('radminGuideConnectionError')} (${error.name || 'Error'})`);
        }
      });
    });
  }

  static async waitForConnection(hosts) {
    RadminGuide.dismissed = false;

    while (true) {
      RadminGuide.setStatus(Lang.text('radminGuideWaiting'));
      try {
        return await RadminGuide.connectAnyHost(hosts);
      } catch (error) {
        RadminGuide.setStatus(`${error.message}\n${Lang.text('radminGuideRetrying')}`, true);
        await new Promise((resolve) => setTimeout(resolve, RadminGuide.CHECK_INTERVAL_MS));
      }
    }
  }
}
