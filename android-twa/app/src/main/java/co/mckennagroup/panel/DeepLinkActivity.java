package co.mckennagroup.panel;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Activity puente solo para mckennaapp:// (auth, token, alarma).
 * NO debe usar Theme.NoDisplay ni capturar https://…/app (en MIUI cierra la app al instante).
 */
public class DeepLinkActivity extends Activity {

    private static final String TAG = "McKennaDeepLink";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Uri data = getIntent() != null ? getIntent().getData() : null;
            // Solo esquemas custom. HTTPS lo maneja LauncherActivity → WebView.
            if (data != null && "mckennaapp".equalsIgnoreCase(data.getScheme())) {
                McKennaBridge.handleUri(this, data);
            } else {
                Log.w(TAG, "Ignorando URI no-custom: " + data);
                McKennaBridge.openPanel(this, McKennaBridge.panelBaseUrl(this) + "/app");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error procesando deep link", e);
        }
        // Dar tiempo a que WebView entre al frente antes de cerrar el puente (MIUI/HyperOS).
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!isFinishing()) finish();
        }, 250);
    }
}
