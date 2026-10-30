try {
  if (nw) {
    NativeAPI = 1; // Защита работы fallback скрипта
  }
} catch (e) {}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    script.type = 'module';
    document.head.appendChild(script);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await loadScript('content/modules/_modules.js?v=20261027-bootstrap-splash-1').catch(console.error);
});
