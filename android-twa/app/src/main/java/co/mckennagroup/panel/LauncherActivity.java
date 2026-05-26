package co.mckennagroup.panel;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    private static final String TAG               = "McKennaLauncher";
    private static final int    PERM_REQUEST_CODE = 1001;
    private static final String SCHEME            = "mckennaapp";
    private static final String HOST_ALARMA       = "alarma";
    private static final String HOST_TOKEN        = "token";

    private boolean _postLaunchRan = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        procesarDeepLink(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();

        if (!_postLaunchRan) {
            _postLaunchRan = true;
            new Handler(Looper.getMainLooper()).postDelayed(this::postLaunchSetup, 2000);
        }
    }

    private void postLaunchSetup() {
        try {
            long intervaloMs = getSharedPreferences(AlarmaReceiver.PREFS_NAME, MODE_PRIVATE)
                    .getLong(AlarmaReceiver.KEY_INTERVAL, AlarmaReceiver.DEFAULT_INTERVAL_MS);
            boolean activa = getSharedPreferences(AlarmaReceiver.PREFS_NAME, MODE_PRIVATE)
                    .getBoolean(AlarmaReceiver.KEY_ACTIVA, true);
            AlarmaReceiver.programar(this, intervaloMs, activa);
        } catch (Exception e) {
            Log.e(TAG, "Error programando alarma", e);
        }

        try {
            List<String> faltantes = calcularPermisosFaltantes();
            if (!faltantes.isEmpty()) {
                ActivityCompat.requestPermissions(
                        this,
                        faltantes.toArray(new String[0]),
                        PERM_REQUEST_CODE
                );
            }
        } catch (Exception e) {
            Log.e(TAG, "Error solicitando permisos", e);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try {
            procesarDeepLink(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error en onNewIntent", e);
        }
    }

    private void procesarDeepLink(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null || !SCHEME.equals(data.getScheme())) return;

        String host = data.getHost();
        if (HOST_TOKEN.equals(host)) {
            String token = data.getQueryParameter("t");
            if (token != null && !token.isEmpty()) {
                AlarmAudioCache.saveApiToken(this, token);
                Log.i(TAG, "API token sincronizado para WAV nativo");
            }
            return;
        }

        if (HOST_ALARMA.equals(host)) {
            aplicarIntentAlarma(data);
        }
    }

    private void aplicarIntentAlarma(Uri data) {
        String activaStr     = data.getQueryParameter("activa");
        String intervaloStr  = data.getQueryParameter("intervalo");
        String hayTareaStr   = data.getQueryParameter("hay_tarea");
        String precacheStr   = data.getQueryParameter("precache");

        boolean activa = !"false".equalsIgnoreCase(activaStr);
        long intervaloMs = AlarmaReceiver.DEFAULT_INTERVAL_MS;
        try {
            int min = Integer.parseInt(intervaloStr != null ? intervaloStr : "5");
            intervaloMs = Math.max(1, Math.min(60, min)) * 60_000L;
        } catch (NumberFormatException ignored) {}

        boolean hayTarea = !"false".equalsIgnoreCase(hayTareaStr);
        boolean precache = "1".equals(precacheStr) || "true".equalsIgnoreCase(precacheStr);

        AlarmaReceiver.aplicarConfig(this, intervaloMs, activa, hayTarea);

        if (precache) {
            if (AlarmAudioCache.isCacheValid(this)) {
                Log.i(TAG, "WAV alarma ya en caché");
            } else {
                AlarmAudioCache.downloadAsync(this, null);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private List<String> calcularPermisosFaltantes() {
        List<String> faltantes = new ArrayList<>();
        agregarSiFalta(faltantes, Manifest.permission.RECORD_AUDIO);
        agregarSiFalta(faltantes, Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            agregarSiFalta(faltantes, Manifest.permission.POST_NOTIFICATIONS);
            agregarSiFalta(faltantes, Manifest.permission.READ_MEDIA_AUDIO);
        } else {
            agregarSiFalta(faltantes, Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        return faltantes;
    }

    private void agregarSiFalta(List<String> lista, String permiso) {
        if (ContextCompat.checkSelfPermission(this, permiso)
                != PackageManager.PERMISSION_GRANTED) {
            lista.add(permiso);
        }
    }

    @Override
    protected Uri getLaunchingUrl() {
        return super.getLaunchingUrl();
    }
}
