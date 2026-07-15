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
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Panel en WebView con OAuth Google vía Chrome Custom Tab y retorno por mckennaapp://auth.
 */
public class McKennaWebViewActivity extends Activity {

    private static final String TAG = "McKennaWebView";
    public static final String EXTRA_URL = "panel_url";
    private static final String UA_SUFFIX = " McKennaPanelAndroid/1.3.3";
    private static final int REQ_AUDIO = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private ValueCallback<Uri[]> pendingFileCallback;
    private Uri cameraPhotoUri;

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
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
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

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = filePathCallback;
                cameraPhotoUri = null;

                String mimeType = "image/*";
                boolean captureEnabled = false;
                if (fileChooserParams != null) {
                    captureEnabled = fileChooserParams.isCaptureEnabled();
                    String[] accept = fileChooserParams.getAcceptTypes();
                    if (accept != null && accept.length > 0 && accept[0] != null && !accept[0].isEmpty()) {
                        mimeType = accept[0];
                    }
                }

                Intent takePictureIntent = null;
                boolean wantsImage = mimeType.startsWith("image/") || "*/*".equals(mimeType);
                if (wantsImage || captureEnabled) {
                    if (ContextCompat.checkSelfPermission(McKennaWebViewActivity.this, Manifest.permission.CAMERA)
                            != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(
                                McKennaWebViewActivity.this,
                                new String[]{Manifest.permission.CAMERA},
                                REQ_AUDIO + 1
                        );
                    }
                    Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    if (cameraIntent.resolveActivity(getPackageManager()) != null) {
                        File photoFile = createCameraImageFile();
                        if (photoFile != null) {
                            cameraPhotoUri = FileProvider.getUriForFile(
                                    McKennaWebViewActivity.this,
                                    getString(R.string.providerAuthority),
                                    photoFile
                            );
                            cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
                            cameraIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                                    | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            takePictureIntent = cameraIntent;
                        }
                    }
                }

                Intent contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
                contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
                contentIntent.setType(mimeType);

                Intent chooserIntent = Intent.createChooser(contentIntent, "Seleccionar archivo");
                if (takePictureIntent != null) {
                    chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{takePictureIntent});
                }

                try {
                    startActivityForResult(chooserIntent, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    Log.e(TAG, "onShowFileChooser: no se pudo abrir selector", e);
                    if (pendingFileCallback != null) {
                        pendingFileCallback.onReceiveValue(null);
                        pendingFileCallback = null;
                    }
                    return false;
                }
                return true;
            }
        });
        webView.setWebViewClient(new PanelWebViewClient());

        String bootstrapUrl = getIntent().getStringExtra(EXTRA_URL);
        if (bootstrapUrl == null || bootstrapUrl.isEmpty()) {
            if (getIntent().getData() != null) {
                bootstrapUrl = getIntent().getData().toString();
            } else {
                bootstrapUrl = getString(R.string.launchUrl);
            }
        }
        Uri bootstrapUri = Uri.parse(bootstrapUrl);
        String resolved = resolveAuthBootstrapUrl(bootstrapUri);
        if (resolved != null) {
            Log.i(TAG, "Sesión OAuth desde Intent → " + resolved);
            bootstrapUrl = resolved;
        }
        Log.i(TAG, "Cargando " + bootstrapUrl);
        webView.loadUrl(bootstrapUrl);
    }

    /**
     * Si el Intent trae android-return / ?_token= / mckennaapp://auth, devolver URL del panel
     * con sesión. null = cargar la URL tal cual.
     */
    private String resolveAuthBootstrapUrl(Uri uri) {
        if (uri == null) return null;
        if ("mckennaapp".equals(uri.getScheme()) && "auth".equals(uri.getHost())) {
            String token = uri.getQueryParameter("token");
            if (token != null && !token.isEmpty()) {
                return McKennaBridge.panelBaseUrl(this) + "/app?_token=" + Uri.encode(token);
            }
            return null;
        }
        if (!isPanelHost(uri)) return null;
        String path = uri.getPath() != null ? uri.getPath() : "";
        String token = null;
        if ("/app/auth/android-return".equals(path)) {
            token = uri.getQueryParameter("token");
        } else if ("/app".equals(path) || "/app/".equals(path)) {
            token = uri.getQueryParameter("_token");
        }
        if (token == null || token.isEmpty()) return null;
        return McKennaBridge.panelBaseUrl(this) + "/app?_token=" + Uri.encode(token);
    }

    private File createCameraImageFile() {
        try {
            String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
            return File.createTempFile("MCK_" + timeStamp + "_", ".jpg", getCacheDir());
        } catch (IOException e) {
            Log.e(TAG, "createCameraImageFile", e);
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (pendingFileCallback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK) {
                    if (data != null && data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        List<Uri> uris = new ArrayList<>();
                        for (int i = 0; i < count; i++) {
                            uris.add(data.getClipData().getItemAt(i).getUri());
                        }
                        results = uris.toArray(new Uri[0]);
                    } else if (data != null && data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    } else if (cameraPhotoUri != null) {
                        results = new Uri[]{cameraPhotoUri};
                    }
                }
                pendingFileCallback.onReceiveValue(results);
                pendingFileCallback = null;
            }
            cameraPhotoUri = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.evaluateJavascript(
                    "(function(){try{window.dispatchEvent(new Event('mckenna-panel-resume'));}catch(e){}})();",
                    null);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null) return;

        Uri data = intent.getData();
        if (data != null && McKennaBridge.handleHttpsAuthReturn(this, data)) {
            return;
        }
        if (data != null && "mckennaapp".equals(data.getScheme())) {
            McKennaBridge.handleUri(this, data);
            return;
        }

        String url = intent.getStringExtra(EXTRA_URL);
        if (url != null && !url.isEmpty()) {
            Uri u = Uri.parse(url);
            if (McKennaBridge.handleHttpsAuthReturn(this, u)) return;
            if (webView != null) {
                Log.i(TAG, "Recargando tras deep link: " + url);
                webView.loadUrl(url);
            }
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
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    void loadUrl(String url) {
        if (webView != null && url != null && !url.isEmpty()) {
            webView.loadUrl(url);
        }
    }

    void clearWebHistory() {
        if (webView == null) return;
        webView.clearHistory();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.__mckennaHandleBack&&window.__mckennaHandleBack()?1:0;}catch(e){return 0;}})()",
                value -> {
                    if ("1".equals(value) || "\"1\"".equals(value)) {
                        return;
                    }
                    // En la pantalla raíz minimizar la app; no webView.goBack() (evita volver al login).
                    moveTaskToBack(true);
                }
        );
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

    private boolean handlePanelAuthReturn(Uri uri) {
        if (uri == null) return false;
        String resolved = resolveAuthBootstrapUrl(uri);
        if (resolved != null) {
            Log.i(TAG, "OAuth HTTPS return → " + resolved);
            loadUrl(resolved);
            return true;
        }
        return false;
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
