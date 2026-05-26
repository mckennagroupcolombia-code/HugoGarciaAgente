package co.mckennagroup.panel;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Solicita todos los permisos necesarios al lanzar la app por primera vez.
 * Al arrancar también programa la alarma nativa periódica (sonido del sistema
 * incluso con pantalla bloqueada y Chrome suspendido).
 *
 * La alarma se puede configurar desde la web app mediante deep links:
 *   mckennaapp://alarma?activa=true&intervalo=5
 * Estos llegan como intents a onNewIntent() cuando la app ya está en foreground.
 */
public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    private static final int    PERM_REQUEST_CODE     = 1001;
    private static final String SCHEME_ALARMA         = "mckennaapp";
    private static final String HOST_ALARMA           = "alarma";

    // true mientras el diálogo de permisos está visible → bloquea onStart()
    private boolean _aguardandoPermisos = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);

        // Programar alarma nativa con la configuración guardada (o default 5 min)
        long intervaloMs = getSharedPreferences(AlarmaReceiver.PREFS_NAME, MODE_PRIVATE)
                .getLong(AlarmaReceiver.KEY_INTERVAL, AlarmaReceiver.DEFAULT_INTERVAL_MS);
        boolean activa = getSharedPreferences(AlarmaReceiver.PREFS_NAME, MODE_PRIVATE)
                .getBoolean(AlarmaReceiver.KEY_ACTIVA, true);
        AlarmaReceiver.programar(this, intervaloMs, activa);

        // Manejar posible deep link de configuración en el intent inicial
        procesarIntentAlarma(getIntent());

        List<String> faltantes = calcularPermisosFaltantes();
        if (!faltantes.isEmpty()) {
            _aguardandoPermisos = true;
            ActivityCompat.requestPermissions(
                    this,
                    faltantes.toArray(new String[0]),
                    PERM_REQUEST_CODE
            );
        }
    }

    /**
     * Recibe deep links mientras la app está en foreground.
     * La web app puede llamar: window.open('mckennaapp://alarma?activa=true&intervalo=5')
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        procesarIntentAlarma(intent);
    }

    /**
     * Interpreta mckennaapp://alarma?activa=true|false&intervalo=<minutos>
     * y re-programa la alarma nativa en consecuencia.
     */
    private void procesarIntentAlarma(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!SCHEME_ALARMA.equals(data.getScheme())) return;
        if (!HOST_ALARMA.equals(data.getHost())) return;

        String activaStr   = data.getQueryParameter("activa");
        String intervaloStr = data.getQueryParameter("intervalo");

        boolean activa = !"false".equalsIgnoreCase(activaStr);
        long intervaloMs = AlarmaReceiver.DEFAULT_INTERVAL_MS;
        try {
            int min = Integer.parseInt(intervaloStr != null ? intervaloStr : "5");
            intervaloMs = Math.max(1, Math.min(60, min)) * 60_000L;
        } catch (NumberFormatException ignored) {}

        AlarmaReceiver.programar(this, intervaloMs, activa);
    }

    /**
     * Bloquea el lanzamiento del TWA (Chrome) mientras el diálogo de permisos
     * esté activo. Una vez respondido el diálogo, onRequestPermissionsResult
     * llama a onStart() manualmente para disparar el lanzamiento.
     */
    @Override
    protected void onStart() {
        if (!_aguardandoPermisos) {
            super.onStart();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_REQUEST_CODE) {
            _aguardandoPermisos = false;
            // Lanzar el TWA ahora que el usuario respondió todos los permisos.
            onStart();
        }
    }

    private List<String> calcularPermisosFaltantes() {
        List<String> faltantes = new ArrayList<>();

        agregarSiFalta(faltantes, Manifest.permission.RECORD_AUDIO);
        agregarSiFalta(faltantes, Manifest.permission.MODIFY_AUDIO_SETTINGS);
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
