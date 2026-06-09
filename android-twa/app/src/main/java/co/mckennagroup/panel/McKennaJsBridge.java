package co.mckennagroup.panel;

import android.Manifest;
import android.content.pm.PackageManager;
import android.util.Log;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Puente JS ↔ nativo (sin intents que reinician la actividad en MIUI).
 */
public class McKennaJsBridge {

    private static final String TAG = "McKennaJsBridge";
    private final McKennaWebViewActivity activity;

    McKennaJsBridge(McKennaWebViewActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void saveApiToken(String token) {
        if (token == null || token.isEmpty()) return;
        AlarmAudioCache.saveApiToken(activity.getApplicationContext(), token);
        Log.i(TAG, "API token guardado vía JS");
    }

    @JavascriptInterface
    public void syncAlarma(boolean activa, int intervaloMin, boolean hayTarea, boolean precache) {
        long ms = Math.max(1, Math.min(60, intervaloMin)) * 60_000L;
        AlarmaReceiver.aplicarConfig(activity.getApplicationContext(), ms, activa, hayTarea);
        if (precache) {
            if (AlarmAudioCache.isCacheValid(activity)) {
                Log.i(TAG, "WAV ya en caché");
            } else {
                AlarmAudioCache.downloadAsync(activity.getApplicationContext(), null);
            }
        }
        Log.i(TAG, "Alarma sync JS activa=" + activa + " min=" + intervaloMin);
    }

    @JavascriptInterface
    public boolean hasAudioPermission() {
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void clearWebHistory() {
        activity.runOnUiThread(() -> activity.clearWebHistory());
        Log.i(TAG, "clearWebHistory vía JS");
    }

    @JavascriptInterface
    public void requestAudioPermission() {
        if (!hasAudioPermission()) {
            ActivityCompat.requestPermissions(
                    activity,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    1001
            );
            Log.i(TAG, "requestAudioPermission: solicitando RECORD_AUDIO al SO");
        } else {
            Log.i(TAG, "requestAudioPermission: RECORD_AUDIO ya concedido");
        }
    }
}
