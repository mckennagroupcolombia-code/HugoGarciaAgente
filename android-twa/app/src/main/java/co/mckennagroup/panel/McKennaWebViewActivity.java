package co.mckennagroup.panel;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Panel en WebView con OAuth Google vía Chrome Custom Tab y retorno por mckennaapp://auth.
 */
public class McKennaWebViewActivity extends Activity {

    private static final String TAG = "McKennaWebView";
    public static final String EXTRA_URL = "panel_url";
    private static final String UA_SUFFIX = " McKennaPanelAndroid/1.3.0";
    private static final int REQ_AUDIO = 1001;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;

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
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String origin = request.getOrigin() != null ? request.getOrigin().toString() : "";
                boolean trusted = origin.contains("mckennagroup.co")
                        || origin.startsWith("http://localhost")
                        || origin.startsWith("https://localhost");
                if (!trusted) {
                    Log.w(TAG, "onPermissionRequest: origen no confiable: " + origin);
                    request.deny();
                    return;
                }
                if (ContextCompat.checkSelfPermission(McKennaWebViewActivity.this, Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
                    Log.i(TAG, "onPermissionRequest: RECORD_AUDIO concedido → grant");
                    request.grant(request.getResources());
                } else {
                    Log.i(TAG, "onPermissionRequest: pidiendo RECORD_AUDIO al SO");
                    pendingPermissionRequest = request;
                    ActivityCompat.requestPermissions(
                            McKennaWebViewActivity.this,
                            new String[]{Manifest.permission.RECORD_AUDIO},
                            REQ_AUDIO
                    );
                }
            }
        });
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

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_AUDIO) {
            if (pendingPermissionRequest != null) {
                if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    Log.i(TAG, "RECORD_AUDIO concedido por usuario → grant web permission");
                    pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                } else {
                    Log.w(TAG, "RECORD_AUDIO denegado por usuario → deny web permission");
                    pendingPermissionRequest.deny();
                }
                pendingPermissionRequest = null;
            }
        } else {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
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
