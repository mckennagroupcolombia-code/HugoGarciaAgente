package co.mckennagroup.panel;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Descarga y reproduce el WAV de alarma generado por /api/voz/sintetizar.
 * Permite audio personalizado (Voicebox) en segundo plano vía código nativo.
 */
public final class AlarmAudioCache {

    private static final String TAG = "AlarmAudioCache";
    /** v2: WAV con perfil Voicebox Hugo García (antes alarm_voice.wav genérico). */
    static final String FILE_NAME = "alarm_voice_hugo_v2.wav";
    static final String KEY_API_TOKEN = "api_token";
    static final String KEY_WAV_CACHED_AT = "wav_cached_at";
    static final long CACHE_TTL_MS = 12L * 60 * 60 * 1000;
    static final String ALARM_TEXT =
            "Recuerda: tienes una tarea en proceso.";
    /** Perfil Voicebox clonado Hugo García (mismo que app/data/voz_config.json). */
    static final String VOICEBOX_PROFILE_HUGO =
            "3762e0ae-ae88-4f5e-8d77-af4f8eb7cc23";

    private AlarmAudioCache() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(AlarmaReceiver.PREFS_NAME, Context.MODE_PRIVATE);
    }

    static File wavFile(Context ctx) {
        return new File(ctx.getFilesDir(), FILE_NAME);
    }

    static void saveApiToken(Context ctx, String token) {
        if (token == null || token.isEmpty()) return;
        prefs(ctx).edit().putString(KEY_API_TOKEN, token).apply();
    }

    static String getApiToken(Context ctx) {
        return prefs(ctx).getString(KEY_API_TOKEN, "");
    }

    static boolean isCacheValid(Context ctx) {
        long ts = prefs(ctx).getLong(KEY_WAV_CACHED_AT, 0L);
        if (ts <= 0 || System.currentTimeMillis() - ts > CACHE_TTL_MS) return false;
        File f = wavFile(ctx);
        return f.isFile() && f.length() > 256;
    }

    static String apiBaseUrl(Context ctx) {
        try {
            String launch = ctx.getString(R.string.launchUrl);
            URI uri = URI.create(launch);
            return uri.getScheme() + "://" + uri.getHost();
        } catch (Exception e) {
            return "https://bot.mckennagroup.co";
        }
    }

    /** Descarga el WAV al almacenamiento interno. Devuelve true si quedó cacheado. */
    static boolean downloadSync(Context ctx) {
        String token = getApiToken(ctx);
        if (token.isEmpty()) {
            Log.w(TAG, "Sin api_token — omitiendo descarga WAV");
            return false;
        }
        HttpURLConnection conn = null;
        File tmp = new File(ctx.getFilesDir(), FILE_NAME + ".tmp");
        try {
            URL url = new URL(apiBaseUrl(ctx) + "/api/voz/sintetizar");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(120_000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Authorization", "Bearer " + token);

            JSONObject body = new JSONObject();
            body.put("texto", ALARM_TEXT);
            body.put("motor", "voicebox");
            body.put("voicebox_engine", "qwen3");
            body.put("voicebox_profile", VOICEBOX_PROFILE_HUGO);
            body.put("language", "Spanish");
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, "sintetizar HTTP " + code);
                return false;
            }

            String contentType = conn.getContentType();
            if (contentType != null && contentType.contains("json")) {
                Log.w(TAG, "sintetizar devolvió JSON (error TTS)");
                return false;
            }

            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
            }

            if (!tmp.isFile() || tmp.length() < 256) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return false;
            }

            File dest = wavFile(ctx);
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            if (!tmp.renameTo(dest)) {
                try (InputStream in = new java.io.FileInputStream(tmp);
                     FileOutputStream out = new FileOutputStream(dest)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                }
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }

            prefs(ctx).edit()
                    .putLong(KEY_WAV_CACHED_AT, System.currentTimeMillis())
                    .apply();
            Log.i(TAG, "WAV alarma cacheado (" + dest.length() + " bytes)");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Error descargando WAV", e);
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static void downloadAsync(Context ctx, Runnable onComplete) {
        Context app = ctx.getApplicationContext();
        new Thread(() -> {
            boolean ok = downloadSync(app);
            if (onComplete != null) onComplete.run();
            if (!ok) Log.w(TAG, "Descarga async falló");
        }, "alarm-wav-download").start();
    }

    /**
     * Reproduce el WAV cacheado con USAGE_ALARM (audible con pantalla bloqueada).
     * Devuelve true si empezó la reproducción.
     */
    static boolean playCached(Context ctx) {
        if (!isCacheValid(ctx)) return false;
        Context app = ctx.getApplicationContext();
        PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = null;
        if (pm != null) {
            wl = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "mckenna:alarm-playback");
            wl.acquire(60_000L);
        }
        final PowerManager.WakeLock wakeLock = wl;
        try {
            MediaPlayer mp = new MediaPlayer();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
            } else {
                mp.setAudioStreamType(AudioManager.STREAM_ALARM);
            }
            mp.setDataSource(app, Uri.fromFile(wavFile(app)));
            mp.setOnPreparedListener(player -> player.start());
            mp.setOnCompletionListener(player -> {
                try { player.release(); } catch (Exception ignored) {}
                releaseWake(wakeLock);
            });
            mp.setOnErrorListener((player, what, extra) -> {
                try { player.release(); } catch (Exception ignored) {}
                releaseWake(wakeLock);
                return true;
            });
            mp.prepareAsync();
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Error reproduciendo WAV", e);
            releaseWake(wakeLock);
            return false;
        }
    }

    private static void releaseWake(PowerManager.WakeLock wl) {
        if (wl != null && wl.isHeld()) {
            try { wl.release(); } catch (Exception ignored) {}
        }
    }
}
