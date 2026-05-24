package com.signallm.app;

import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public class LmStudioLiteHttpBridge {
    private MainActivity activity;

    public LmStudioLiteHttpBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void triggerSelectFolder() {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.launchFolderPicker();
                }
            });
        }
    }

    @JavascriptInterface
    public void triggerGetPersistedWorkspace() {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.loadPersistedWorkspace();
                }
            });
        }
    }

    @JavascriptInterface
    public void triggerWriteFiles(final String jsonEdits) {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.writeFilesToWorkspace(jsonEdits);
                }
            });
        }
    }

    @JavascriptInterface
    public void triggerWriteFile(final String path, final String content) {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.writeFileToWorkspace(path, content);
                }
            });
        }
    }

    @JavascriptInterface
    public void triggerReadFile(final String path) {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.readFileFromWorkspace(path);
                }
            });
        }
    }

    @JavascriptInterface
    public void triggerClearPersistedWorkspace() {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.clearPersistedWorkspace();
                }
            });
        }
    }

    @JavascriptInterface
    public void triggerHttpRequest(final String payloadJson, final String requestId) {
        if (activity != null) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    final String result = httpRequest(payloadJson);
                    activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            activity.resolveHttpRequest(requestId, result);
                        }
                    });
                }
            }).start();
        }
    }

    public String httpRequest(String payloadJson) {
        HttpURLConnection connection = null;
        try {
            JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
            String urlText = payload.optString("url", "");
            String method = payload.optString("method", "GET").toUpperCase();
            String body = payload.isNull("body") ? null : payload.optString("body", null);
            JSONObject headers = payload.optJSONObject("headers");

            URL url = new URL(urlText);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(0);
            connection.setUseCaches(false);
            connection.setDoInput(true);

            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.optString(key, "");
                    if (key != null && key.length() > 0 && value != null) {
                        connection.setRequestProperty(key, value);
                    }
                }
            }

            if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
                connection.setDoOutput(true);
                OutputStream stream = connection.getOutputStream();
                BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(stream, "UTF-8"));
                writer.write(body);
                writer.flush();
                writer.close();
                stream.close();
            }

            int status = connection.getResponseCode();
            InputStream responseStream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String responseBody = readStream(responseStream);

            JSONObject out = new JSONObject();
            out.put("status", status);
            out.put("statusText", connection.getResponseMessage() == null ? "" : connection.getResponseMessage());
            out.put("body", responseBody == null ? "" : responseBody);
            String contentType = connection.getContentType();
            if (contentType != null) out.put("contentType", contentType);

            JSONObject outHeaders = new JSONObject();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                    outHeaders.put(entry.getKey(), entry.getValue().get(0));
                }
            }
            out.put("headers", outHeaders);
            return out.toString();
        } catch (Exception error) {
            try {
                JSONObject out = new JSONObject();
                out.put("status", 0);
                out.put("error", error.getMessage() == null ? error.toString() : error.getMessage());
                out.put("body", "");
                return out.toString();
            } catch (Exception ignored) {
                return "{\"status\":0,\"error\":\"Native HTTP bridge failed\",\"body\":\"\"}";
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public String request(String payloadJson) {
        return httpRequest(payloadJson);
    }

    public String fetchJson(String payloadJson) {
        return httpRequest(payloadJson);
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
        char[] buffer = new char[8192];
        int read;
        while ((read = reader.read(buffer)) != -1) {
            builder.append(buffer, 0, read);
        }
        reader.close();
        return builder.toString();
    }
}
