# Silent Context Helper

The silent helper is an in-app preprocessing layer. It does not create visible chat messages. It runs before the model request and uses the app CPU/RAM path to reduce how much irrelevant workspace text reaches the model.

## What it does

- Builds search terms from the user request.
- Adds code-specific hints for common tasks such as chat UI, copy buttons, dark mode, folders, attachments, Android/Vulkan runtime, and apply/edit flows.
- Reads selected workspace files through the available path: app bridge, browser folder handle, or selected-file fallback.
- Scores files by path and content matches.
- Sends compact snippets from the highest-scoring files instead of dumping the whole workspace.
- For likely edit requests, includes the top relevant files in full when they are small enough, so the model can return complete replacement files.
- Leaves a trace in Debug Context so you can inspect exactly what was sent.

## Why this helps hardware

Large prompts and long context increase prefill time and KV-cache memory. The helper reduces unnecessary context before the GPU/CPU inference backend starts. This does not add VRAM or merge PC and phone memory; it reduces the amount of context the model has to process.

## Modes

- Smart snippets: default. Best for speed and lower context pressure.
- Full selected files: sends selected workspace files with the older full-context path. Best when a tiny set of files must be rewritten exactly.

## App bridge extension points

The helper reuses existing workspace access methods. Native app wrappers can improve it by exposing any of these optional methods:

```js
window.lmStudioLiteNative.selectFolder()
window.lmStudioLiteNative.readFile(path)
window.lmStudioLiteNative.writeFiles({ files, workspace })
```

Future native bridge methods could offload indexing/searching to Android Kotlin/C++:

```js
window.lmStudioLiteNative.searchWorkspace({ query, maxFiles, maxSnippets })
window.lmStudioLiteNative.indexWorkspace({ paths })
```
