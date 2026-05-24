package com.example.lmstudiolite

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Register with:
 *   webView.settings.javaScriptEnabled = true
 *   webView.addJavascriptInterface(WebAppBridge(context, llamaEngine), "lmStudioLiteNative")
 *
 * Android WebView JavaScript interfaces should pass JSON strings rather than JS objects.
 */
class WebAppBridge(
    private val context: Context,
    private val engine: LlamaEngine
) {

    @JavascriptInterface
    fun httpRequest(payloadJson: String): String {
        val payload = JSONObject(payloadJson)
        val targetUrl = payload.getString("url")
        val method = payload.optString("method", "GET").uppercase(Locale.US)
        val timeoutMs = payload.optInt("timeoutMs", 120000)
        val body = payload.optString("body", null)
        val headers = payload.optJSONObject("headers") ?: JSONObject()

        val connection = (URL(targetUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            doInput = true
            for (key in headers.keys()) {
                val value = headers.optString(key, "")
                if (value.isNotEmpty()) setRequestProperty(key, value)
            }
            if (!headers.has("Content-Type") && body != null) setRequestProperty("Content-Type", "application/json")
            if (body != null && method !in setOf("GET", "HEAD")) {
                doOutput = true
                OutputStreamWriter(outputStream, Charsets.UTF_8).use { it.write(body) }
            }
        }

        return try {
            val status = connection.responseCode
            val responseBody = try {
                val stream = if (status in 200..399) connection.inputStream else connection.errorStream
                stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            } catch (_: Exception) { "" }
            JSONObject()
                .put("ok", status in 200..299)
                .put("status", status)
                .put("statusText", connection.responseMessage ?: "")
                .put("body", responseBody)
                .toString()
        } catch (error: Exception) {
            JSONObject()
                .put("ok", false)
                .put("status", 0)
                .put("statusText", error.message ?: "Network error")
                .put("body", error.message ?: "Network error")
                .toString()
        } finally {
            connection.disconnect()
        }
    }

    @JavascriptInterface
    fun fetchJson(payloadJson: String): String = httpRequest(payloadJson)

    @JavascriptInterface
    fun request(payloadJson: String): String = httpRequest(payloadJson)

    @JavascriptInterface
    fun getHardwareStatus(): String {
        return JSONObject()
            .put("backend", "vulkan")
            .put("gpu", engine.gpuName())
            .put("ram", engine.memorySummary())
            .put("ready", engine.isReady())
            .toString()
    }

    @JavascriptInterface
    fun listModels(): String {
        val models = JSONArray()
        engine.availableModels().forEach { model -> models.put(model) }
        return models.toString()
    }

    @JavascriptInterface
    fun chatCompletion(payloadJson: String): String {
        val payload = JSONObject(payloadJson)
        val prompt = payload.optString("prompt")
        val model = payload.optString("model")
        val runtime = payload.optJSONObject("runtime") ?: JSONObject()

        val result = engine.generate(
            model = model,
            prompt = prompt,
            backend = runtime.optString("backend", "vulkan"),
            gpuLayers = runtime.optInt("gpu_layers", 99),
            threads = runtime.optInt("threads", 4),
            contextLength = runtime.optInt("context_length", 4096),
            batchSize = runtime.optInt("batch_size", 512),
            maxTokens = payload.optInt("max_tokens", 500),
            temperature = payload.optDouble("temperature", 0.7).toFloat(),
            topP = payload.optDouble("top_p", 1.0).toFloat()
        )

        return JSONObject().put("content", result).toString()
    }

    @JavascriptInterface
    fun generate(payloadJson: String): String = chatCompletion(payloadJson)

    @JavascriptInterface
    fun cancelGeneration() {
        engine.cancel()
    }

    // File/workspace bridge stubs. Wire these to Android Storage Access Framework or app sandbox paths.
    @JavascriptInterface
    fun selectFolder(): String = JSONObject().put("files", JSONArray()).put("writable", false).toString()

    @JavascriptInterface
    fun readFile(path: String): String = engine.readWorkspaceFile(path)

    @JavascriptInterface
    fun writeFile(path: String, content: String) {
        engine.writeWorkspaceFile(path, content)
    }

    @JavascriptInterface
    fun writeFiles(payloadJson: String) {
        val payload = JSONObject(payloadJson)
        val files = payload.optJSONArray("files") ?: JSONArray()
        for (i in 0 until files.length()) {
            val file = files.getJSONObject(i)
            engine.writeWorkspaceFile(file.getString("path"), file.getString("content"))
        }
    }
}

interface LlamaEngine {
    fun isReady(): Boolean
    fun gpuName(): String
    fun memorySummary(): String
    fun availableModels(): List<String>
    fun generate(
        model: String,
        prompt: String,
        backend: String,
        gpuLayers: Int,
        threads: Int,
        contextLength: Int,
        batchSize: Int,
        maxTokens: Int,
        temperature: Float,
        topP: Float
    ): String
    fun cancel()
    fun readWorkspaceFile(path: String): String
    fun writeWorkspaceFile(path: String, content: String)
}
