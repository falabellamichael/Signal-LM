#include <jni.h>
#include <string>

// Skeleton only: wire this to llama.cpp model/context lifecycle in your Android app.
// Keep one loaded model/context per active model to avoid reloading on every prompt.

extern "C" JNIEXPORT jstring JNICALL
Java_com_example_lmstudiolite_NativeLlamaBridge_gpuName(JNIEnv* env, jobject) {
    return env->NewStringUTF("Vulkan device name from ggml_vulkan logs/status");
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_example_lmstudiolite_NativeLlamaBridge_generate(
    JNIEnv* env,
    jobject,
    jstring modelPath,
    jstring prompt,
    jint gpuLayers,
    jint threads,
    jint contextLength,
    jint batchSize,
    jint maxTokens,
    jfloat temperature,
    jfloat topP
) {
    const char* promptChars = env->GetStringUTFChars(prompt, nullptr);

    // TODO:
    // 1. llama_backend_init()
    // 2. llama_model_default_params(); params.n_gpu_layers = gpuLayers;
    // 3. llama_model_load_from_file(modelPath, params)
    // 4. llama_context_default_params(); ctx.n_ctx = contextLength; ctx.n_batch = batchSize; ctx.n_threads = threads;
    // 5. tokenize prompt and sample tokens until maxTokens or EOS
    // 6. return generated UTF-8 text

    std::string result = "Native Vulkan runtime bridge is installed; llama.cpp generation is not wired yet.";
    env->ReleaseStringUTFChars(prompt, promptChars);
    return env->NewStringUTF(result.c_str());
}
