/** APK McKenna (WebView) añade este sufijo al User-Agent. */
export function isMcKennaAndroidApp(): boolean {
  return /McKennaPanelAndroid/i.test(navigator.userAgent);
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
};

export function mckennaAndroidBridge(): McKennaAndroidBridge | null {
  const w = window as Window & { McKennaAndroid?: McKennaAndroidBridge };
  return w.McKennaAndroid ?? null;
}
