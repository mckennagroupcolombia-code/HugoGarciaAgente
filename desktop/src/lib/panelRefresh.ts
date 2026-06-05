/** Eventos de reanudación del panel (WebView Android + navegador). */
export function onPanelResume(callback: () => void): () => void {
  const run = () => {
    if (document.visibilityState !== "hidden") callback();
  };

  document.addEventListener("visibilitychange", run);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted || document.visibilityState !== "hidden") callback();
  });
  window.addEventListener("focus", run);
  window.addEventListener("mckenna-panel-resume", run);

  return () => {
    document.removeEventListener("visibilitychange", run);
    window.removeEventListener("focus", run);
    window.removeEventListener("mckenna-panel-resume", run);
  };
}
