package co.mckennagroup.colaboradores;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * App de colaboradores: un WebView sobre el panel. El servidor reconoce al
 * usuario y le entrega solo su apartado (desktop/dist-colab/).
 *
 * El login con Google no puede ir dentro de un WebView (Google lo bloquea): se
 * abre en el navegador y vuelve por mckennacolab://auth?token=…
 */
public class MainActivity extends Activity {
    private static final String BASE = "https://bot.mckennagroup.co";
    private static final String HOST = "bot.mckennagroup.co";
    /** La pantalla de ingreso lo busca para mandar el login de Google a esta app. */
    private static final String UA_SUFIJO = " McKennaColabAndroid/1.0";
    private static final int PEDIR_ARCHIVOS = 1;

    private WebView web;
    /** Respuesta pendiente al <input type="file"> de la página (📎 de la solicitud). */
    private ValueCallback<Uri[]> archivosPendientes;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#E8FAFB"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSafeBrowsingEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + UA_SUFIJO);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return manejar(req.getUrl());
            }
        });
        // Sin esto el WebView ignora los <input type="file">: el 📎 no abría nada
        // en el celular (TKT-2026-1617). El selector del sistema no pide permisos.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (archivosPendientes != null) archivosPendientes.onReceiveValue(null);
                archivosPendientes = callback;
                Intent pedir = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    pedir.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(pedir, PEDIR_ARCHIVOS);
                } catch (ActivityNotFoundException e) {
                    archivosPendientes = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        // Sin esto tocar un adjunto que no es imagen (PDF, APK…) no hacía nada.
        web.setDownloadListener((url, ua, disposicion, mime, largo) -> descargar(url, ua, disposicion, mime));

        if (estado != null) {
            web.restoreState(estado);
        } else {
            web.loadUrl(urlDeInicio(getIntent()));
        }
    }

    /** El panel, o el panel con la sesión si llegamos desde el login de Google. */
    private String urlDeInicio(Intent intent) {
        Uri datos = intent != null ? intent.getData() : null;
        if (datos != null && "mckennacolab".equals(datos.getScheme())) {
            String token = datos.getQueryParameter("token");
            if (token != null && !token.isEmpty()) return BASE + "/app?_token=" + Uri.encode(token);
            String error = datos.getQueryParameter("error");
            if (error != null) return BASE + "/app?auth_error=" + Uri.encode(error);
        }
        return BASE + "/app";
    }

    private boolean manejar(Uri uri) {
        if (uri == null) return false;
        if ("mckennacolab".equals(uri.getScheme())) {
            web.loadUrl(urlDeInicio(new Intent(Intent.ACTION_VIEW, uri)));
            return true;
        }
        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
        String ruta = uri.getPath() != null ? uri.getPath() : "";
        // Dentro del WebView solo el panel; el login de Google y cualquier otro
        // sitio van al navegador.
        if (HOST.equals(host) && !ruta.startsWith("/app/auth/google")) return false;
        abrirAfuera(uri);
        return true;
    }

    private void abrirAfuera(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignorado) {
            // Sin navegador no hay cómo entrar con Google; queda el usuario y contraseña.
        }
    }

    /**
     * Descarga a «Descargas» con la sesión del WebView (cookie y user agent), y
     * Android avisa con una notificación al terminar. En Android 9 o anterior
     * escribir ahí pide un permiso que esta app no tiene: se le pasa al navegador
     * (los adjuntos de solicitudes llevan el token en la URL).
     */
    private void descargar(String url, String ua, String disposicion, String mime) {
        Uri uri = Uri.parse(url);
        String esquema = uri.getScheme() != null ? uri.getScheme() : "";
        if (!esquema.equals("https") && !esquema.equals("http")) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            abrirAfuera(uri);
            return;
        }
        try {
            String nombre = URLUtil.guessFileName(url, disposicion, mime);
            DownloadManager.Request pedido = new DownloadManager.Request(uri)
                    .setMimeType(mime)
                    .addRequestHeader("User-Agent", ua)
                    .setTitle(nombre)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombre);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) pedido.addRequestHeader("Cookie", cookies);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(pedido);
            Toast.makeText(this, "Descargando " + nombre + "…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            abrirAfuera(uri);
        }
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        super.onActivityResult(pedido, resultado, datos);
        if (pedido != PEDIR_ARCHIVOS || archivosPendientes == null) return;
        Uri[] elegidos = null;
        if (resultado == RESULT_OK && datos != null) {
            if (datos.getClipData() != null) {
                int n = datos.getClipData().getItemCount();
                elegidos = new Uri[n];
                for (int i = 0; i < n; i++) elegidos[i] = datos.getClipData().getItemAt(i).getUri();
            } else if (datos.getData() != null) {
                elegidos = new Uri[]{datos.getData()};
            }
        }
        // Siempre se responde (aun cancelado), o el input queda colgado y no vuelve a abrir.
        archivosPendientes.onReceiveValue(elegidos);
        archivosPendientes = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getData() != null && web != null) {
            web.loadUrl(urlDeInicio(intent));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle salida) {
        super.onSaveInstanceState(salida);
        if (web != null) web.saveState(salida);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }
}
