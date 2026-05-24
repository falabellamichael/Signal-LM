# LM Studio Lite Android Vulkan + Hybrid Phone Boost Runtime

The app now supports three runtime modes from the Chat and Settings pages:

1. `server` — use the configured LM Studio-compatible PC/server endpoint only.
2. `android-vulkan` — use the Android native bridge only, backed by a Vulkan-enabled mobile inference runtime.
3. `hybrid` — use the PC/server as the primary runtime and use the Android phone as support.

Hybrid mode does **not** merge PC VRAM and phone GPU memory into one shared model. The practical architecture is worker-based:

- **Fallback strategy:** try the PC server first. If it fails or is slower than the configured timeout, run the same request on the phone.
- **Race strategy:** send the same request to the PC and phone at the same time, then use the first completed answer and cancel the slower worker when possible.

This gives the app extra available compute without pretending the phone GPU can become part of the PC GPU.

## JavaScript bridge names

Expose one of these objects before loading `index.html`:

```js
window.lmStudioLiteNative
window.NativeInferenceBridge
window.AndroidInferenceBridge
```

Recommended for Android WebView: accept JSON strings and return JSON strings. The web UI also supports object-style bridges when the bridge sets:

```js
window.lmStudioLiteNative.acceptsObjects = true
// or
window.lmStudioLiteNative.objectBridge = true
```

## Required inference methods

```ts
getHardwareStatus(): string
listModels(): string
chatCompletion(payloadJson: string): string
generate(payloadJson: string): string // optional fallback
cancelGeneration(): void // optional but recommended for hybrid race mode
```

`chatCompletion` receives:

```json
{
  "model": "model.gguf",
  "messages": [{ "role": "user", "content": "hello" }],
  "prompt": "USER: hello\n\nASSISTANT:",
  "temperature": 0.7,
  "top_p": 1,
  "max_tokens": 500,
  "stream": false,
  "mode": "hybrid-helper",
  "runtime": {
    "backend": "vulkan",
    "gpu_layers": 99,
    "threads": 4,
    "context_length": 4096,
    "batch_size": 512,
    "use_mmap": true,
    "use_mlock": false
  }
}
```

Return one of:

```json
{ "content": "assistant reply" }
{ "text": "assistant reply" }
{ "choices": [{ "message": { "content": "assistant reply" } }] }
```

## Required file/workspace methods

These are used by workspace/folder editing and Apply:

```ts
selectFolder(): string
readFile(path: string): string
writeFile(path: string, content: string): void
writeFiles(payloadJson: string): void
```

`writeFiles` receives:

```json
{
  "workspace": { "name": "project", "source": "android-saf" },
  "files": [
    { "path": "index.html", "content": "..." }
  ]
}
```

## Runtime tuning starting points

Small or older devices:

```json
{ "gpu_layers": 20, "threads": 4, "context_length": 2048, "batch_size": 128 }
```

Modern Snapdragon/Dimensity/Exynos devices:

```json
{ "gpu_layers": 99, "threads": 6, "context_length": 4096, "batch_size": 512 }
```

If the phone heats up, stalls, or Android kills the app, reduce `gpu_layers`, `batch_size`, and `context_length` first.

## Native backend shape

Use an Android native library that links a mobile LLM runtime such as llama.cpp/ggml with Vulkan enabled. Keep the model loaded between requests so hybrid fallback/race does not pay a full reload penalty each prompt.

Recommended app behavior:

- Load the phone GGUF model once during app startup or first use.
- Keep a queue so only one native generation runs at a time.
- Implement `cancelGeneration()` so hybrid race mode can stop the slower phone worker.
- Surface GPU name, free/total RAM estimate, current model, and thermal/ready status through `getHardwareStatus()`.
