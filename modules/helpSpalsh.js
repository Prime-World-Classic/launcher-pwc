import { DOM } from './dom.js';
import { Splash } from './splash.js';
import { Lang } from './lang.js';
import { domAudioPresets } from './domAudioPresets.js';

/**
 * Shows a splash with a given content.
 * @param {string} title - The title of the splash.
 * @param {string} contentInnerHTML - The HTML content to be displayed in the splash.
 * @returns {void} - Nothing.
 */
export function HelpSplash(contentInnerHTML) {
  /**
   * Sanitizes HTML content by removing script, iframe, object, embed, and form tags.
   * This function is used to prevent XSS attacks.
   * @param {string} html - The HTML content to be sanitized.
   * @returns {string} - The sanitized HTML content.
   */
  function sanitizeContent(html) {
    // Удаляем script, iframe, object, embed, form
    return html.replace(/<(script|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  }
  /**
   * Renders the content of the help splash.
   * This function takes the content as JSON and renders it as HTML.
   * The content is rendered as a series of paragraphs, unordered lists and horizontal rules.
   * If the content contains an unknown block type, a warning is logged to the console.
   * only 'img', 'p', 'ul', and 'hr' block types are supported to avoid security issues.
   */
  function renderContent() {
    let html = '';
    const content = DOM({ tag: 'div', id: 'help-content', style: 'splash-help-content' });
    contentInnerHTML.forEach((jsonTag) => {
      switch (jsonTag.type) {
        case 'p':
          html += `<p>${sanitizeContent(jsonTag.content)}</p>`;
          break;
        case 'img':
          html += `<img src="${sanitizeContent(jsonTag.content)}" class="splash-help-img" loading="lazy" decoding="async"/>`;
          break;
        case 'ul':
          html += '<ul>';
          html += jsonTag.content.map((item) => `<li>${sanitizeContent(item)}</li>`).join('');
          html += '</ul>';
          break;
        case 'hr':
          html += '<hr>';
          break;
        case 'h1':
          html += `<h1>${sanitizeContent(jsonTag.content)}</h1>`;
          break;
        case 'h2':
          html += `<h2>${sanitizeContent(jsonTag.content)}</h2>`;
          break;
        case 'h3':
          html += `<h3>${sanitizeContent(jsonTag.content)}</h3>`;
          break;
        case 'h4':
          html += `<h4>${sanitizeContent(jsonTag.content)}</h4>`;
          break;
        case 'h5':
          html += `<h5>${sanitizeContent(jsonTag.content)}</h5>`;
          break;
        case 'h6':
          html += `<h6>${sanitizeContent(jsonTag.content)}</h6>`;
          break;
        case 'center':
          html += `<center>${sanitizeContent(jsonTag.content)}</center>`;
          break;
        default:
          console.warn('Unknown block type', jsonTag.type);
          break;
      }
    });
    content.innerHTML = html;
    return content;
  }
  return Splash.show(
    DOM(
      { tag: 'article', style: 'splash-help' },
      DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('helpWindow'))),
      DOM({ style: 'splash-help-container' }, renderContent()),
      DOM(
        {
          style: 'splash-content-button',
          domaudio: domAudioPresets.closeButton,
          event: [
            'click',
            () => {
              Splash.hide();
            },
          ],
        },
        Lang.text('help_btn_close'),
      ),
    ),
  );
}
