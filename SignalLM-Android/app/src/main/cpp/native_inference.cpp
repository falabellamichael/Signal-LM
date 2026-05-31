#include <jni.h>
#include <string>

namespace {
std::string json_escape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 16);
    for (char ch : value) {
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += ch; break;
        }
    }
    return out;
}

jstring make_json(JNIEnv* env, const std::string& content, bool available) {
    std::string json = "{\"content\":\"" + json_escape(content) + "\",\"nativeAvailable\":" + (available ? "true" : "false") + "}";
    return env->NewStringUTF(json.c_str());
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_signallm_app_NativeInferenceRuntime_nativeIsAvailable(JNIEnv*, jclass) {
    return JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_signallm_app_NativeInferenceRuntime_nativeChatCompletion(JNIEnv* env, jclass, jstring payloadJson) {
    return make_json(env,
        "Native inference scaffold is present, but no Android model backend is linked yet. Add llama.cpp/ggml or another backend to app/src/main/cpp and replace native_inference.cpp generation logic.",
        false);
}
