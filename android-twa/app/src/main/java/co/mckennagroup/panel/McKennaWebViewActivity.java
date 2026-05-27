package co.mckennagroup.panel;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Panel en WebView con OAuth Google vía Chrome Custom Tab y retorno por mckennaapp://auth.
 */
public class McKennaWebViewActivity extends Activity {

    private static final String TAG = "McKennaWebView";
    public static final String EXTRA_URL = "panel_url";
    private static final String UA_SUFFIX = " McKennaPanelAndroid/1.2.8";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0f1117"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        String ua = settings.getUserAgentString();
        if (ua == null || !ua.contains("McKennaPanelAndroid")) {
            settings.setUserAgentString(ua + UA_SUFFIX);
        }

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(webView, true);
        }

        webView.addJavascriptInterface(new McKennaJsBridge(this), "McKennaAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new PanelWebViewClient());

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) {
            url = getString(R.string.launchUrl);
        }
        Log.i(TAG, "Cargando " + url);
        webView.loadUrl(url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent.getStringExtra(EXTRA_URL);
        if (url != null && !url.isEmpty() && webView != null) {
            Log.i(TAG, "Recargando tras deep link: " + url);
            webView.loadUrl(url);
        }
    }

    void loadUrl(String url) {
        if (webView != null && url != null && !url.isEmpty()) {
            webView.loadUrl(url);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private boolean shouldOpenExternally(Uri uri) {
        if (uri == null) return false;
        String host = uri.getHost();
        String path = uri.getPath() != null ? uri.getPath() : "";
        if (host != null && host.contains("accounts.google.com")) return true;
        if (host != null && host.contains("google.com") && path.contains("oauth")) return true;
        return path.startsWith("/app/auth/google");
    }

    private void openCustomTab(Uri uri) {
        try {
            CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
            builder.setShowTitle(true);
            CustomTabsIntent tabs = builder.build();
            // Sin NEW_TASK: OAuth queda en la misma tarea que el WebView (evita que MIUI
            // deje Chrome como app visible y parezca que "sacó" del panel).
            tabs.launchUrl(this, uri);
        } catch (Exception e) {
            Log.e(TAG, "Custom Tab falló, cargando en WebView", e);
            if (webView != null) webView.loadUrl(uri.toString());
        }
    }

    private boolean isPanelHost(Uri uri) {
        if (uri == null || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase();
        return host.contains("mckennagroup.co") || host.contains("bot.mckennagroup.co");
    }

    /** Retorno OAuth por HTTPS (Custom Tab o WebView). */
    private boolean handlePanelAuthReturn(Uri uri) {
        if (!isPanelHost(uri)) return false;
        String path = uri.getPath() != null ? uri.getPath() : "";
        if (!"/app/auth/android-return".equals(path)) return false;
        String token = uri.getQueryParameter("token");
        if (token == null || token.isEmpty()) return false;
        String panelUrl = McKennaBridge.panelBaseUrl(this) + "/app?_token=" + Uri.encode(token);
        Log.i(TAG, "OAuth HTTPS return → " + panelUrl);
        loadUrl(panelUrl);
        return true;
    }

    private class PanelWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        private boolean handleUrl(Uri uri) {
            if (uri == null) return false;
            if ("mckennaapp".equals(uri.getScheme())) {
                McKennaBridge.handleUri(McKennaWebViewActivity.this, uri);
                return true;
            }
            if (handlePanelAuthReturn(uri)) return true;
            if (shouldOpenExternally(uri)) {
                openCustomTab(uri);
                return true;
            }
            return false;
        }
    }
}
