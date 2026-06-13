package co.mckennagroup.panel;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.util.Calendar;
import java.util.TimeZone;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Alarma nativa: notificación + WAV de Voicebox (cacheado) o TTS de respaldo.
 */
public class AlarmaReceiver extends BroadcastReceiver {

    private static final String TAG = "AlarmaReceiver";

    static final String CHANNEL_ID          = "mckenna_tareas_v2";
    static final int    NOTIF_ID            = 2001;
    static final String PREFS_NAME          = "mckenna_alarma";
    static final String KEY_INTERVAL        = "intervalo_ms";
    static final String KEY_ACTIVA          = "activa";
    static final String KEY_HAY_TAREA       = "hay_tarea";
    static final long   DEFAULT_INTERVAL_MS = 5 * 60_000L;

    /** Horario de descanso 22:00–07:00 (America/Bogota). */
    static boolean enHorarioSilencio() {
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("America/Bogota"));
        int hora = cal.get(Calendar.HOUR_OF_DAY);
        return hora >= 22 || hora < 7;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String action = intent != null ? intent.getAction() : null;
            boolean bootOrUpdate = Intent.ACTION_BOOT_COMPLETED.equals(action)
                    || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);

            SharedPreferences prefs =
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean activa     = prefs.getBoolean(KEY_ACTIVA, false);
            boolean hayTarea   = prefs.getBoolean(KEY_HAY_TAREA, false);
            long    intervalMs = prefs.getLong(KEY_INTERVAL, DEFAULT_INTERVAL_MS);

            // Tras instalar/actualizar o reinicio: solo reprogramar si hay tarea real
            if (bootOrUpdate) {
                if (activa && hayTarea && intervalMs > 0) {
                    programar(context, intervalMs, true);
                } else {
                    programar(context, intervalMs, false);
                }
                return;
            }

            if (!activa || intervalMs <= 0) return;

            if (hayTarea && !enHorarioSilencio()) {
                mostrarNotificacion(context);
                if (!AlarmAudioCache.playCached(context)) {
                    Log.i(TAG, "WAV no disponible — TTS de respaldo");
                    hablarTexto(context, AlarmAudioCache.ALARM_TEXT);
                }
            }

            programar(context, intervalMs, activa && hayTarea);
        } catch (Exception e) {
            Log.e(TAG, "Error en onReceive", e);
        }
    }

    static void mostrarNotificacion(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        crearCanal(nm);

        Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                context, 0,
                launchIntent != null ? launchIntent : new Intent(),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Uri sonido = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        Notification notif = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("McKenna ⏱  Acción activa")
                .setContentText("Tienes una tarea en progreso. Toca para ver el avance.")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("Tienes una tarea en progreso. Toca para ver el avance."))
                .setSound(sonido)
                .setVibrate(new long[]{0, 250, 100, 250, 100, 500})
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();

        nm.notify(NOTIF_ID, notif);
    }

    @SuppressWarnings("deprecation")
    static void hablarTexto(final Context context, final String texto) {
        final android.speech.tts.TextToSpeech[] holder = {null};
        holder[0] = new android.speech.tts.TextToSpeech(context.getApplicationContext(), status -> {
            if (status != android.speech.tts.TextToSpeech.SUCCESS || holder[0] == null) return;

            int langResult = holder[0].setLanguage(new java.util.Locale("es", "CO"));
            if (langResult == android.speech.tts.TextToSpeech.LANG_MISSING_DATA
                    || langResult == android.speech.tts.TextToSpeech.LANG_NOT_SUPPORTED) {
                holder[0].setLanguage(new java.util.Locale("es"));
            }

            holder[0].setOnUtteranceProgressListener(
                    new android.speech.tts.UtteranceProgressListener() {
                        @Override public void onStart(String id) {}
                        @Override public void onDone(String id)  { holder[0].shutdown(); }
                        @Override public void onError(String id) { holder[0].shutdown(); }
                    });

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                android.os.Bundle params = new android.os.Bundle();
                params.putInt(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_STREAM,
                        android.media.AudioManager.STREAM_ALARM);
                params.putFloat(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                holder[0].speak(texto, android.speech.tts.TextToSpeech.QUEUE_FLUSH, params, "mckenna_tts");
            } else {
                java.util.HashMap<String, String> params = new java.util.HashMap<>();
                params.put(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_STREAM,
                        String.valueOf(android.media.AudioManager.STREAM_ALARM));
                params.put(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "mckenna_tts");
                holder[0].speak(texto, android.speech.tts.TextToSpeech.QUEUE_FLUSH, params);
            }
        });
    }

    private static void crearCanal(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Recordatorios de tareas", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alertas periódicas cuando hay una acción en progreso");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 250, 100, 250, 100, 500});

        Uri sonido = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        ch.setSound(sonido, audioAttrs);
        nm.createNotificationChannel(ch);
    }

    static void aplicarConfig(Context ctx, long intervalMs, boolean activa, boolean hayTarea) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_INTERVAL, intervalMs)
                .putBoolean(KEY_ACTIVA, activa)
                .putBoolean(KEY_HAY_TAREA, hayTarea)
                .apply();
        programar(ctx, intervalMs, activa);
    }

    static void programar(Context ctx, long intervalMs, boolean activa) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent i = new Intent(ctx, AlarmaReceiver.class);
        PendingIntent pi = PendingIntent.getBroadcast(
                ctx, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_INTERVAL, intervalMs)
                .putBoolean(KEY_ACTIVA, activa)
                .apply();

        am.cancel(pi);

        if (!activa || intervalMs <= 0) return;

        long triggerAt = System.currentTimeMillis() + intervalMs;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }
}
