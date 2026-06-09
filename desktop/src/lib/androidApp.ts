/** APK McKenna (WebView) añade este sufijo al User-Agent. */
export function isMcKennaAndroidApp(): boolean {
  return /McKennaPanelAndroid/i.test(navigator.userAgent);
}

/**
 * Chrome u otro navegador en teléfono Android (no el APK).
 * Ahí sí tiene sentido intent:// para abrir co.mckennagroup.panel si está instalada.
 */
export function isAndroidMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && !/McKennaPanelAndroid/i.test(ua);
}

/** Web Push / Notification API (no disponible en WebView Android). */
export function webNotificationsAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "Notification" in globalThis &&
    typeof (globalThis as { Notification?: typeof Notification }).Notification !== "undefined"
  );
}

export function googleAuthStartUrl(): string {
  return isMcKennaAndroidApp()
    ? "/app/auth/google/start?app=android"
    : "/app/auth/google/start";
}

type McKennaAndroidBridge = {
  saveApiToken?: (token: string) => void;
  syncAlarma?: (activa: boolean, intervaloMin: number, hayTarea: boolean, precache: boolean) => void;
  hasAudioPermission?: () => boolean;
  requestAudioPermission?: () => void;
  /** Evita que webView.goBack() regrese al login OAuth. */
  clearWebHistory?: () => void;
};

export function mckennaAndroidBridge(): McKennaAndroidBridge | null {
  const w = window as Window & { McKennaAndroid?: McKennaAndroidBridge };
  return w.McKennaAndroid ?? null;
}
