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
        if (data == null || !SCHEME.equals(data.getScheme())) return;

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
        Intent i = new Intent(context, McKennaWebViewActivity.class);
        i.putExtra(McKennaWebViewActivity.EXTRA_URL, url);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!(context instanceof Activity)) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        context.startActivity(i);
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
