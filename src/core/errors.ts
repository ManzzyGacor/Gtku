/** Shows uncaught errors on screen so they can be read on a phone without devtools. */
export function installErrorOverlay(): void {
  const el = document.getElementById('err');
  if (!el) return;
  const show = (msg: string): void => {
    el.style.display = 'block';
    el.textContent = `${msg}\n${el.textContent ?? ''}`.slice(0, 1800);
    el.onclick = () => {
      el.style.display = 'none';
      el.textContent = '';
    };
  };
  window.addEventListener('error', (e) => show(`${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => show(`Promise: ${String(e.reason?.stack ?? e.reason)}`));
}
