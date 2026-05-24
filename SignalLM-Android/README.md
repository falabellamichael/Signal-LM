# Signal LM Android WebView App

This project packages the LM Studio Lite web app as a local Android WebView APK.

The WebView loads:

```text
file:///android_asset/index.html
```

Use this Base URL inside Settings:

```text
http://192.168.2.11:1234/v1
```

LM Studio must be running on the PC and serving on the LAN, not only localhost.

## Build

Open this folder in Android Studio or AndroidIDE and build the `app` module.

## Notes

- Cleartext LAN HTTP is enabled in `AndroidManifest.xml` and `network_security_config.xml`.
- A JavaScript bridge named `window.lmStudioLiteNative` is exposed.
- The bundled HTML patches `fetch()` to use the native HTTP bridge for HTTP/HTTPS requests when available, avoiding file-origin/CORS issues in WebView.
