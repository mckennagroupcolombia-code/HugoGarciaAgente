package co.mckennagroup.panel;

/**
 * El permiso de micrófono (RECORD_AUDIO) está declarado en AndroidManifest.xml.
 * Chrome en el TWA detecta ese permiso y muestra el diálogo de Android cuando
 * la web llama a navigator.mediaDevices.getUserMedia({ audio: true }).
 * Esta clase solo activa el servicio de delegación de notificaciones si se necesita.
 */
public class DelegationService extends
        com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
    }
}
