package co.mckennagroup.colaboradores;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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

    private WebView web;

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
