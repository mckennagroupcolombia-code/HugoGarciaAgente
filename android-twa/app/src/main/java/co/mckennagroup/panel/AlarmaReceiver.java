package co.mckennagroup.panel;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * Receptor de alarma nativa Android.
 * Dispara una notificación con sonido del sistema incluso con pantalla bloqueada,
 * Chrome suspendido o la app en segundo plano.
 * Se auto-reprograma en cada disparo para mantener el ciclo.
 */
public class AlarmaReceiver extends BroadcastReceiver {

    static final String CHANNEL_ID     = "mckenna_tareas_v2";
    static final int    NOTIF_ID       = 2001;
    static final String PREFS_NAME     = "mckenna_alarma";
    static final String KEY_INTERVAL   = "intervalo_ms";
    static final String KEY_ACTIVA     = "activa";
    static final long   DEFAULT_INTERVAL_MS = 5 * 60_000L; // 5 minutos

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean activa = prefs.getBoolean(KEY_ACTIVA, true);
        long intervalMs = prefs.getLong(KEY_INTERVAL, DEFAULT_INTERVAL_MS);

        if (activa) {
            mostrarNotificacion(context);
            // Auto-reprogramar para el siguiente disparo
            programar(context, intervalMs, true);
        }
    }

    /** Muestra la notificación de recordatorio de tarea. */
    static void mostrarNotificacion(Context context) {
        NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        crearCanal(nm);

        // Intento abrir la app al tocar la notificación
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

    /** Crea el canal de notificación (solo necesario en Android 8+). */
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

    /**
     * Programa (o cancela) la alarma periódica.
     * Usa setAndAllowWhileIdle para disparar incluso en modo Doze, sin
     * requerir el permiso especial SCHEDULE_EXACT_ALARM.
     */
    static void programar(Context ctx, long intervalMs, boolean activa) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        Intent i = new Intent(ctx, AlarmaReceiver.class);
        PendingIntent pi = PendingIntent.getBroadcast(
                ctx, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Guardar configuración para que el receptor pueda releer tras reinicio
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
           .edit()
           .putLong(KEY_INTERVAL, intervalMs)
           .putBoolean(KEY_ACTIVA, activa)
           .apply();

        am.cancel(pi); // cancelar alarma anterior si existe

        if (!activa || intervalMs <= 0) return;

        long triggerAt = System.currentTimeMillis() + intervalMs;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Disponible desde API 23 — no requiere permiso especial
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }
}
