package co.mckennagroup.panel;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Abre el panel en WebView integrado (sin TWA/Chrome).
 * Los Digital Asset Links de bot.mckennagroup.co no verifican en este APK;
 * el TWA/Custom Tab se cerraba ~1 s tras el splash (visto en logcat).
 */
public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    private static final String TAG = "McKennaLauncher";
    private static final int PERM_REQUEST_CODE = 1001;

    private boolean _aguardandoPermisos = false;
    private boolean _webviewLaunched = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);

        List<String> faltantes = permisosAlArranque();
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
     * No llamar super.onStart(): evita TWA + Custom Tab que MIUI/Chrome cierran
     * cuando falla la verificación de asset links.
     */
    @Override
    protected void onStart() {
        abrirWebViewSiListo();
    }

    private void abrirWebViewSiListo() {
        if (_aguardandoPermisos || _webviewLaunched) return;
        _webviewLaunched = true;
        try {
            Uri url = getLaunchingUrl();
            if (url == null) {
                url = Uri.parse(getString(R.string.launchUrl));
            }
            Log.i(TAG, "Abriendo panel en WebView: " + url);
            Intent intent = new Intent(this, McKennaWebViewActivity.class);
            intent.putExtra(McKennaWebViewActivity.EXTRA_URL, url.toString());
            startActivity(intent);
            finish();
        } catch (Exception e) {
            Log.e(TAG, "No se pudo abrir WebView", e);
            _webviewLaunched = false;
            finish();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_REQUEST_CODE) {
            _aguardandoPermisos = false;
            abrirWebViewSiListo();
        }
    }

    private List<String> permisosAlArranque() {
        List<String> faltantes = new ArrayList<>();
        agregarSiFalta(faltantes, Manifest.permission.RECORD_AUDIO);
        agregarSiFalta(faltantes, Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            agregarSiFalta(faltantes, Manifest.permission.POST_NOTIFICATIONS);
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
