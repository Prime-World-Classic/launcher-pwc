// Канал сборки клиента — по NW.js-манифесту (package.json.name).
// Имя со словом «Dev» или «Tests» (слово целиком) = тестовая сборка; иначе — публичная.
// («Tests» — у части тестеров манифест без «Dev»: "Prime World Classic #1 Tests".)
// Единственный источник этого признака: его читают NativeAPI.updateBranch()
// (какую ветку передать апдейтеру) и App.CURRENT_MM (mm или mmtest).
// Модуль без зависимостей — можно читать на этапе инициализации классов.

export const TEST_MANIFEST_RE = /\b(?:Dev|Tests)\b/i;

export function readNwManifest() {
  try {
    if (typeof nw !== 'undefined' && nw.App && nw.App.manifest) {
      return nw.App.manifest;
    }
  } catch {}
  try {
    return require('nw.gui').App.manifest;
  } catch {}
  return null;
}

export function manifestName() {
  const manifest = readNwManifest();
  return String((manifest && (manifest.name || manifest.product_name || manifest.productName)) || '');
}

export function isTestManifest() {
  return TEST_MANIFEST_RE.test(manifestName());
}

// Матчмейкинг: тестовой сборке — mmtest, публичной — mm. Если манифеста нет
// (браузерный dev-сервер, тесты) — mm: публичный режим безопаснее как дефолт.
export function mmMode() {
  return isTestManifest() ? 'mmtest' : 'mm';
}
