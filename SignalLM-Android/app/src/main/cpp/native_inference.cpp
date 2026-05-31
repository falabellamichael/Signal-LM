#include <jni.h>
#include <string>
#include <vector>
#include <mutex>
#include <android/log.h>
#include <algorithm>

#ifdef SIGNAL_LM_HAS_LLAMA
#include "llama.h"
#endif

#define LOG_TAG "NativeInferenceRuntime"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

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

#ifdef SIGNAL_LM_HAS_LLAMA
std::mutex g_mutex;
std::string g_model_path;
llama_model* g_model = nullptr;
bool g_backend_initialized = false;
#endif
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_signallm_app_NativeInferenceRuntime_nativeIsAvailable(JNIEnv*, jclass) {
#ifdef SIGNAL_LM_HAS_LLAMA
    return JNI_TRUE;
#else
    return JNI_FALSE;
#endif
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_signallm_app_NativeInferenceRuntime_nativeChatCompletion(JNIEnv* env, jclass, 
    jstring jmodelPath, jstring jprompt, jfloat temperature, jfloat topP, jint maxTokens) {

#ifndef SIGNAL_LM_HAS_LLAMA
    return make_json(env, "Native inference scaffold is present, but no Android model backend is linked yet.", false);
#else
    std::lock_guard<std::mutex> lock(g_mutex);

    const char* c_modelPath = env->GetStringUTFChars(jmodelPath, nullptr);
    std::string modelPath = c_modelPath ? c_modelPath : "";
    if (c_modelPath) env->ReleaseStringUTFChars(jmodelPath, c_modelPath);

    const char* c_prompt = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt = c_prompt ? c_prompt : "";
    if (c_prompt) env->ReleaseStringUTFChars(jprompt, c_prompt);

    if (modelPath.empty()) {
        return make_json(env, "Error: Model path is empty.", true);
    }

    if (!g_backend_initialized) {
        llama_backend_init();
        g_backend_initialized = true;
    }

    if (g_model != nullptr && g_model_path != modelPath) {
        llama_model_free(g_model);
        g_model = nullptr;
        g_model_path = "";
    }

    if (g_model == nullptr) {
        LOGI("Loading model: %s", modelPath.c_str());
        llama_model_params model_params = llama_model_default_params();
        model_params.n_gpu_layers = 99; // Try to offload to GPU/Vulkan
        g_model = llama_model_load_from_file(modelPath.c_str(), model_params);
        if (g_model == nullptr) {
            LOGE("Failed to load model: %s", modelPath.c_str());
            return make_json(env, "Error: Failed to load model: " + modelPath, true);
        }
        g_model_path = modelPath;
    }

    const llama_vocab* vocab = llama_model_get_vocab(g_model);
    int n_prompt = -llama_tokenize(vocab, prompt.c_str(), prompt.size(), nullptr, 0, true, true);
    if (n_prompt < 0) {
        n_prompt = -n_prompt;
    }
    
    std::vector<llama_token> prompt_tokens(n_prompt);
    if (llama_tokenize(vocab, prompt.c_str(), prompt.size(), prompt_tokens.data(), prompt_tokens.size(), true, true) < 0) {
        return make_json(env, "Error: Failed to tokenize prompt.", true);
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = n_prompt + maxTokens + 32;
    ctx_params.n_batch = n_prompt;
    ctx_params.no_perf = true;

    llama_context* ctx = llama_init_from_model(g_model, ctx_params);
    if (ctx == nullptr) {
        return make_json(env, "Error: Failed to create context. Too little memory?", true);
    }

    auto sparams = llama_sampler_chain_default_params();
    sparams.no_perf = true;
    llama_sampler* smpl = llama_sampler_chain_init(sparams);
    
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(topP, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(0));

    llama_batch batch = llama_batch_get_one(prompt_tokens.data(), prompt_tokens.size());
    if (llama_model_has_encoder(g_model)) {
        if (llama_encode(ctx, batch)) {
            llama_sampler_free(smpl);
            llama_free(ctx);
            return make_json(env, "Error: Failed to encode prompt.", true);
        }
        llama_token decoder_start_token_id = llama_model_decoder_start_token(g_model);
        if (decoder_start_token_id == LLAMA_TOKEN_NULL) {
            decoder_start_token_id = llama_vocab_bos(vocab);
        }
        batch = llama_batch_get_one(&decoder_start_token_id, 1);
    }

    std::string response = "";
    int n_decode = 0;
    llama_token new_token_id;

    for (int n_pos = 0; n_pos + batch.n_tokens < n_prompt + maxTokens; ) {
        if (llama_decode(ctx, batch)) {
            LOGE("llama_decode failed");
            break;
        }

        n_pos += batch.n_tokens;

        new_token_id = llama_sampler_sample(smpl, ctx, -1);

        if (llama_vocab_is_eog(vocab, new_token_id)) {
            break;
        }

        char buf[128];
        int n = llama_token_to_piece(vocab, new_token_id, buf, sizeof(buf), 0, true);
        if (n >= 0) {
            response += std::string(buf, n);
        }

        batch = llama_batch_get_one(&new_token_id, 1);
        n_decode++;
    }

    llama_sampler_free(smpl);
    llama_free(ctx);

    return make_json(env, response, true);
#endif
}
