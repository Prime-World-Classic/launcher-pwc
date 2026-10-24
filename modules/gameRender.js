// Рендер-бэкенд игры, который лончер передаёт протоколом запуска.
//
// Значение по умолчанию — 'd3d9': старый пайплайн, токен в протокол НЕ
// добавляется, поэтому строка протокола остаётся ровно той, что понимает любой
// клиент. Для 'vulkan' добавляется именованный токен «render=vulkan» — его
// читает клиент (pw/branches/r1117/Src/PW_Client/Game.cpp) и поднимает
// NVRHI/Vulkan; «render=d3d9» — явный отказ, он перебивает dev-переменную
// окружения PW_VK_BACKEND. Клиент, который таких токенов не знает, молча их
// игнорирует, поэтому токен безопасен для старых сборок.
//
// Модуль без зависимостей намеренно: протокол проверяется тестом
// (tests/gameRender.test.js) без графа модулей лончера.

export const RENDER_BACKENDS = ['d3d9', 'vulkan'];

export function normalizeRenderBackend(value) {
  return RENDER_BACKENDS.includes(value) ? value : 'd3d9';
}

export function renderBackendToken(backend) {
  const normalized = normalizeRenderBackend(backend);
  return normalized === 'd3d9' ? '' : `/render=${normalized}`;
}
