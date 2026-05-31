package com.signallm.app;

import org.json.JSONObject;

/**
 * Java facade for the Android native inference backend.
 *
 * The JNI surface is intentionally stable:
 * - chatCompletion(payloadJson) returns an OpenAI-like JSON response or {"content":"..."}.
 * - isAvailable() reports whether a real native backend is linked and ready.
 *
 * The current native C++ file is a scaffold. It must be connected to llama.cpp/ggml or another
 * Android inference backend before it performs real phone CPU/GPU/Vulkan generation.
 */
public final class NativeInferenceRuntime {
    private static volatile boolean libraryLoaded = false;
    private static volatile boolean loadAttempted = false;

    private NativeInferenceRuntime() {}

    public static boolean isLibraryLoaded() {
        ensureLoaded();
        return libraryLoaded;
    }

    public static boolean isAvailable() {
        if (!ensureLoaded()) return false;
        try {
            return nativeIsAvailable();
        } catch (Throwable error) {
            return false;
        }
    }

    public static String chatCompletion(String payloadJson) {
        if (!ensureLoaded()) return errorJson("Native inference library is not loaded.");
        try {
            return nativeChatCompletion(payloadJson == null ? "{}" : payloadJson);
        } catch (Throwable error) {
            return errorJson("Native inference call failed: " + safeMessage(error));
        }
    }

    public static String generate(String payloadJson) {
        return chatCompletion(payloadJson);
    }

    public static String statusJson() {
        try {
            JSONObject out = new JSONObject();
            out.put("libraryLoaded", isLibraryLoaded());
            out.put("available", isAvailable());
            out.put("backend", "android-native-scaffold");
            out.put("note", isAvailable()
                    ? "Native inference backend is available."
                    : "Native inference scaffold is present, but no real inference backend is linked yet.");
            return out.toString();
        } catch (Exception error) {
            return "{\"libraryLoaded\":false,\"available\":false}";
        }
    }

    private static synchronized boolean ensureLoaded() {
        if (loadAttempted) return libraryLoaded;
        loadAttempted = true;
        try {
            System.loadLibrary("signallm_native");
            libraryLoaded = true;
        } catch (Throwable error) {
            libraryLoaded = false;
        }
        return libraryLoaded;
    }

    private static String errorJson(String message) {
        try {
            JSONObject out = new JSONObject();
            out.put("content", message == null ? "Native inference unavailable." : message);
            out.put("nativeAvailable", false);
            return out.toString();
        } catch (Exception ignored) {
            return "{\"content\":\"Native inference unavailable.\",\"nativeAvailable\":false}";
        }
    }

    private static String safeMessage(Throwable error) {
        if (error == null) return "unknown error";
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.toString() : message;
    }

    private static native boolean nativeIsAvailable();
    private static native String nativeChatCompletion(String payloadJson);
}
