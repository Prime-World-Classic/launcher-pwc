import { App } from './app.js';

export function DOM(properties) {
  let parent = document.createElement(typeof properties == 'object' && 'tag' in properties ? properties.tag : 'div');

  if (typeof properties == 'string') {
    parent.append(properties);
  } else {
    for (let property in properties) {
      if (property == 'tag') continue;

      switch (property) {
        case 'domaudio':
          if (properties.domaudio.constructor.name == 'DomAudio') {
            parent.addEventListener('mouseover', (e) => properties.domaudio?.eventMouseOverCallback(e));

            parent.addEventListener('mousedown', (e) => properties.domaudio?.eventMouseDownCallback());

            parent.addEventListener('mouseup', (e) => properties.domaudio?.eventMouseUpCallback(e));

            parent.addEventListener('input', (e) => properties.domaudio?.eventInputCallback(e));

            parent.addEventListener('change', (e) => properties.domaudio?.eventChangeCallback(e));
          } else {
            App.error('Передан некорректный объект. Ожидается DomAudio');
          }

          break;

        case 'style':
          if (typeof properties.style === 'string') {
            parent.classList.add(properties.style);
          } else {
            parent.classList.add(...properties.style);
          }

          break;

        case 'data':
          for (let key in properties.data) {
            parent.dataset[key] = properties.data[key];
          }

          break;

        case 'event':
          parent.addEventListener(properties.event[0], properties.event[1]);

          break;

        default:
          parent[property] = properties[property];

          break;
      }
    }
  }

  if (arguments.length > 1) {
    let i,
      fragment = document.createDocumentFragment();

    for (i = 1; i < arguments.length; i++) {
      fragment.append(arguments[i]);
    }

    parent.append(fragment);
  }

  return parent;
}
