package com.signallm.app;

import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
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
    private static final String TAG = "LmStudioBridge";
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
    public void triggerModelFilePicker() {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.launchModelPicker();
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
        Log.d(TAG, "triggerHttpRequest called with requestId: " + requestId);
        if (activity != null) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        final String result = httpRequest(payloadJson);
                        activity.runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                activity.resolveHttpRequest(requestId, result);
                            }
                        });
                    } catch (Exception e) {
                        Log.e(TAG, "Error in triggerHttpRequest thread", e);
                    }
                }
            }).start();
        } else {
            Log.e(TAG, "Activity is null in triggerHttpRequest");
        }
    }

    /**
     * JavaScript-visible inference bridge.
     *
     * Preferred path:
     *   JavaScript -> chatCompletion(payload) -> NativeInferenceRuntime -> JNI/native backend.
     *
     * Fallback path while the real Android model backend is not linked:
     *   JavaScript -> chatCompletion(payload) -> native HTTP bridge -> PC LM Studio server.
     */
    @JavascriptInterface
    public String chatCompletion(String payloadJson) {
        try {
            if (NativeInferenceRuntime.isAvailable()) {
                return NativeInferenceRuntime.chatCompletion(payloadJson, null);
            }
        } catch (Throwable nativeError) {
            Log.w(TAG, "Native inference unavailable, using HTTP fallback: " + nativeError.getMessage());
        }
        return chatCompletionViaHttp(payloadJson);
    }

    @JavascriptInterface
    public void chatCompletionAsync(final String payloadJson, final String requestId) {
        if (activity != null) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        final String result;
                        if (NativeInferenceRuntime.isAvailable()) {
                            NativeInferenceCallback callback = new NativeInferenceCallback() {
                                @Override
                                public void onToken(final String token) {
                                    String tokenJson = JSONObject.quote(token == null ? "" : token);
                                    activity.evaluateJavascript("if(window['__httpChunk_" + requestId + "']) { window['__httpChunk_" + requestId + "'](" + tokenJson + "); }");
                                }
                            };
                            result = NativeInferenceRuntime.chatCompletion(payloadJson, callback);
                        } else {
                            result = chatCompletionViaHttp(payloadJson);
                        }
                        activity.runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                activity.resolveHttpRequest(requestId, result);
                            }
                        });
                    } catch (Exception e) {
                        Log.e(TAG, "Error in chatCompletionAsync", e);
                        try {
                            final JSONObject out = new JSONObject();
                            out.put("content", "Native inference async error: " + e.getMessage());
                            activity.runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    activity.resolveHttpRequest(requestId, out.toString());
                                }
                            });
                        } catch (Exception ignored) {}
                    }
                }
            }).start();
        }
    }

    @JavascriptInterface
    public void cancelGeneration() {
        NativeInferenceRuntime.cancelGeneration();
    }

    @JavascriptInterface
    public String generate(String payloadJson) {
        return chatCompletion(payloadJson);
    }

    @JavascriptInterface
    public String getHardwareStatus() {
        return NativeInferenceRuntime.statusJson();
    }

    private String chatCompletionViaHttp(String payloadJson) {
        try {
            JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
            JSONObject requestBody = buildChatCompletionsBody(payload);
            String url = chatCompletionsUrl(payload);

            JSONObject headers = new JSONObject();
            headers.put("Content-Type", "application/json");
            String apiKey = payload.optString("apiKey", payload.optString("api_key", ""));
            if (apiKey != null && !apiKey.trim().isEmpty()) {
                headers.put("Authorization", "Bearer " + apiKey.trim());
            }

            JSONObject request = new JSONObject();
            request.put("url", url);
            request.put("method", "POST");
            request.put("headers", headers);
            request.put("body", requestBody.toString());

            String raw = httpRequest(request.toString());
            JSONObject response = new JSONObject(raw == null ? "{}" : raw);
            int status = response.optInt("status", 0);
            String body = response.optString("body", "");

            if (status >= 200 && status < 300 && body != null && !body.isEmpty()) {
                return body;
            }

            JSONObject fallback = new JSONObject();
            fallback.put("content", "Android inference HTTP fallback error " + status + ": " + response.optString("error", body));
            fallback.put("nativeAvailable", false);
            return fallback.toString();
        } catch (Exception error) {
            Log.e(TAG, "chatCompletion HTTP fallback error: " + error.getMessage(), error);
            try {
                JSONObject fallback = new JSONObject();
                fallback.put("content", "Android inference failed: " + (error.getMessage() == null ? error.toString() : error.getMessage()));
                fallback.put("nativeAvailable", false);
                return fallback.toString();
            } catch (Exception ignored) {
                return "{\"content\":\"Android inference failed\",\"nativeAvailable\":false}";
            }
        }
    }

    @JavascriptInterface
    public String httpRequest(String payloadJson) {
        HttpURLConnection connection = null;
        try {
            JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
            String urlText = payload.optString("url", "");
            String method = payload.optString("method", "GET").toUpperCase();
            Log.d(TAG, "httpRequest: " + method + " " + urlText);

            String body = payload.isNull("body") ? null : payload.optString("body", null);
            JSONObject headers = payload.optJSONObject("headers");

            URL url = new URL(urlText);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(120000);
            connection.setUseCaches(false);
            connection.setDoInput(true);

            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.optString(key, "");
                    if (key != null && !key.isEmpty() && value != null) {
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
            Log.d(TAG, "HTTP Response Code: " + status);
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
            Log.e(TAG, "httpRequest error: " + error.getMessage(), error);
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

    @JavascriptInterface
    public String request(String payloadJson) {
        return httpRequest(payloadJson);
    }

    @JavascriptInterface
    public String fetchJson(String payloadJson) {
        return httpRequest(payloadJson);
    }

    private JSONObject buildChatCompletionsBody(JSONObject payload) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", payload.optString("model", "auto-detect"));

        JSONArray messages = payload.optJSONArray("messages");
        if (messages == null || messages.length() == 0) {
            messages = new JSONArray();
            JSONObject user = new JSONObject();
            user.put("role", "user");
            user.put("content", payload.optString("prompt", payload.optString("input", "")));
            messages.put(user);
        }
        body.put("messages", messages);
        body.put("temperature", payload.optDouble("temperature", 0.7));
        body.put("top_p", payload.optDouble("top_p", payload.optDouble("topP", 1.0)));
        body.put("max_tokens", payload.optInt("max_tokens", payload.optInt("max_output_tokens", 500)));
        body.put("stream", false);
        return body;
    }

    private String chatCompletionsUrl(JSONObject payload) {
        String explicitUrl = payload.optString("url", "").trim();
        if (!explicitUrl.isEmpty()) return explicitUrl;

        String base = payload.optString("baseUrl", payload.optString("base_url", "http://127.0.0.1:1234/v1")).trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        String lower = base.toLowerCase();
        if (lower.endsWith("/chat/completions")) return base;
        if (lower.endsWith("/v1")) return base + "/chat/completions";
        if (lower.endsWith("/api/v1")) return base.substring(0, base.length() - "/api/v1".length()) + "/v1/chat/completions";
        return base + "/v1/chat/completions";
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
