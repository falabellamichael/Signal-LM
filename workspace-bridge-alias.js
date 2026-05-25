(function () {
  const bridge = window.lmStudioLiteNative
    || window.NativeFileBridge
    || window.AndroidBridge
    || window.AndroidFileBridge
    || window.AndroidWorkspaceBridge
    || null;

  if (!bridge) return;

  if (!window.lmStudioLiteNative) window.lmStudioLiteNative = bridge;
  if (!window.NativeFileBridge) window.NativeFileBridge = bridge;
  if (!window.AndroidBridge) window.AndroidBridge = bridge;
})();
