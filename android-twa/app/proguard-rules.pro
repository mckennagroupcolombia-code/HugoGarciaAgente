# Clases propias
-keep class co.mckennagroup.panel.** { *; }
-keepclassmembers class co.mckennagroup.panel.McKennaJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# TWA / Custom Tabs (necesario si se vuelve a activar minifyEnabled)
-keep class com.google.androidbrowserhelper.** { *; }
-keep class androidx.browser.customtabs.** { *; }
