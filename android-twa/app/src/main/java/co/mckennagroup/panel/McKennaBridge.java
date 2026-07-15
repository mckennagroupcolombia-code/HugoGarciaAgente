package co.mckennagroup.panel;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

/**
 * Puente web → nativo (alarma, token API, login Google).
 */
public final class McKennaBridge {

    private static final String TAG = "McKennaBridge";
    private static final String SCHEME = "mckennaapp";
    private static final String HOST_ALARMA = "alarma";
    private static final String HOST_TOKEN = "token";
    private static final String HOST_AUTH = "auth";

    private McKennaBridge() {}

    public static void handleUri(Context context, Uri data) {
        if (data == null) return;

        // HTTPS puente OAuth: /app/auth/android-return?token=… o /app?_token=…
        if ("https".equalsIgnoreCase(data.getScheme()) || "http".equalsIgnoreCase(data.getScheme())) {
            if (handleHttpsAuthReturn(context, data)) return;
        }

        if (!SCHEME.equals(data.getScheme())) return;

        String host = data.getHost();
        if (HOST_AUTH.equals(host)) {
            handleAuth(context, data);
            return;
        }
        if (HOST_TOKEN.equals(host)) {
            String token = data.getQueryParameter("t");
            if (token != null && !token.isEmpty()) {
                AlarmAudioCache.saveApiToken(context, token);
                Log.i(TAG, "API token sincronizado");
            }
            return;
        }
        if (HOST_ALARMA.equals(host)) {
            aplicarAlarma(context, data);
        }
    }

    /** Devuelve true si la URI era un retorno OAuth HTTPS y ya se abrió el panel. */
    static boolean handleHttpsAuthReturn(Context context, Uri data) {
        if (data == null || data.getHost() == null) return false;
        String host = data.getHost().toLowerCase();
        if (!host.contains("mckennagroup.co")) return false;

        String path = data.getPath() != null ? data.getPath() : "";
        String token = null;
        if ("/app/auth/android-return".equals(path)) {
            token = data.getQueryParameter("token");
        } else if ("/app".equals(path) || "/app/".equals(path)) {
            token = data.getQueryParameter("_token");
        }
        if (token == null || token.isEmpty()) return false;

        String url = panelBaseUrl(context) + "/app?_token=" + Uri.encode(token);
        Log.i(TAG, "OAuth HTTPS return → panel");
        openPanel(context, url);
        return true;
    }

    private static void handleAuth(Context context, Uri data) {
        String token = data.getQueryParameter("token");
        if (token == null || token.isEmpty()) {
            String err = data.getQueryParameter("error");
            String base = panelBaseUrl(context) + "/app";
            if (err != null && !err.isEmpty()) {
                openPanel(context, base + "?auth_error=" + Uri.encode(err));
            }
            return;
        }
        String url = panelBaseUrl(context) + "/app?_token=" + Uri.encode(token);
        Log.i(TAG, "OAuth OK → cargar panel con sesión");
        openPanel(context, url);
    }

    static void openPanel(Context context, String url) {
        if (context instanceof McKennaWebViewActivity) {
            ((McKennaWebViewActivity) context).loadUrl(url);
            return;
        }
        Intent i = new Intent(context, McKennaWebViewActivity.class);
        i.putExtra(McKennaWebViewActivity.EXTRA_URL, url);
        // CLEAR_TOP + SINGLE_TOP reutiliza el panel vivo.
        // NEW_TASK solo si no somos Activity (p. ej. Application); si no, misma tarea = no se cierra sola.
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        if (!(context instanceof Activity)) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        } else if (context instanceof DeepLinkActivity) {
            // Venimos de Custom Tab / intent externo: necesitamos task propio del panel.
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        context.startActivity(i);
        // No finish() aquí: DeepLinkActivity/LauncherActivity cierran cuando corresponde.
    }

    static String panelBaseUrl(Context ctx) {
        try {
            String launch = ctx.getString(R.string.launchUrl);
            Uri uri = Uri.parse(launch);
            return uri.getScheme() + "://" + uri.getHost();
        } catch (Exception e) {
            return "https://bot.mckennagroup.co";
        }
    }

    private static void aplicarAlarma(Context context, Uri data) {
        String activaStr    = data.getQueryParameter("activa");
        String intervaloStr = data.getQueryParameter("intervalo");
        String hayTareaStr  = data.getQueryParameter("hay_tarea");
        String precacheStr  = data.getQueryParameter("precache");

        boolean activa = !"false".equalsIgnoreCase(activaStr);
        long intervaloMs = AlarmaReceiver.DEFAULT_INTERVAL_MS;
        try {
            int min = Integer.parseInt(intervaloStr != null ? intervaloStr : "5");
            intervaloMs = Math.max(1, Math.min(60, min)) * 60_000L;
        } catch (NumberFormatException ignored) {}

        boolean hayTarea = !"false".equalsIgnoreCase(hayTareaStr);
        boolean precache = "1".equals(precacheStr) || "true".equalsIgnoreCase(precacheStr);

        AlarmaReceiver.aplicarConfig(context, intervaloMs, activa, hayTarea);

        if (precache) {
            if (AlarmAudioCache.isCacheValid(context)) {
                Log.i(TAG, "WAV alarma ya en caché");
            } else {
                AlarmAudioCache.downloadAsync(context, null);
            }
        }
    }
}
