package co.mckennagroup.panel;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

/**
 * Activity transparente solo para deep links mckennaapp://.
 * Evita que el TWA reciba un Intent sin URL https (causa cierre inmediato).
 */
public class DeepLinkActivity extends Activity {

    private static final String TAG = "McKennaDeepLink";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Uri data = getIntent() != null ? getIntent().getData() : null;
            McKennaBridge.handleUri(this, data);
        } catch (Exception e) {
            Log.e(TAG, "Error procesando deep link", e);
        }
        finish();
    }
}
