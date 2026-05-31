(function () {
  if (window.__signalLmNativeFallbackLabel) return;
  window.__signalLmNativeFallbackLabel = true;

  function getBridge() {
    return window.SignalLMNativeBridge || window.lmStudioLiteNative || window.NativeInferenceBridge || window.AndroidBridge || window.AndroidInferenceBridge || null;
  }

  function readStatus(bridge) {
    if (!bridge || typeof bridge.getHardwareStatus !== 'function') return null;
    try {
      var raw = bridge.getHardwareStatus();
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      return null;
    }
  }

  function payloadLooksNativeRoute(payloadJson) {
    try {
      var payload = typeof payloadJson === 'string' ? JSON.parse(payloadJson || '{}') : payloadJson || {};
      var mode = String(payload.mode || '').toLowerCase();
      return mode.indexOf('hybrid') !== -1 || mode.indexOf('native') !== -1 || Boolean(payload.runtime);
    } catch (error) {
      return false;
    }
  }

  function addLabel(raw) {
    var label = '\n\n[Runtime route: PC server fallback. Android native runtime is not available yet.]';
    if (typeof raw !== 'string' || raw.indexOf(label) !== -1) return raw;
    try {
      var data = JSON.parse(raw);
      if (data && typeof data.content === 'string') {
        data.content += label;
        data.route = data.route || 'pc-server-fallback';
        data.nativeAvailable = false;
        return JSON.stringify(data);
      }
      if (data && data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === 'string') {
        data.choices[0].message.content += label;
        data.route = data.route || 'pc-server-fallback';
        data.nativeAvailable = false;
        return JSON.stringify(data);
      }
      if (data && typeof data.text === 'string') {
        data.text += label;
        data.route = data.route || 'pc-server-fallback';
        data.nativeAvailable = false;
        return JSON.stringify(data);
      }
    } catch (error) {
      return raw + label;
    }
    return raw;
  }

  function wrapMethod(bridge, name) {
    if (!bridge || typeof bridge[name] !== 'function' || bridge[name].__signalLmNativeFallbackLabel) return;
    var original = bridge[name].bind(bridge);
    bridge[name] = function (payloadJson) {
      var status = readStatus(bridge);
      var shouldLabel = payloadLooksNativeRoute(payloadJson) && status && status.available !== true;
      var result = original(payloadJson);
      if (result && typeof result.then === 'function') {
        return result.then(function (value) { return shouldLabel ? addLabel(value) : value; });
      }
      return shouldLabel ? addLabel(result) : result;
    };
    bridge[name].__signalLmNativeFallbackLabel = true;
  }

  function install() {
    var bridge = getBridge();
    if (!bridge) return false;
    wrapMethod(bridge, 'chatCompletion');
    wrapMethod(bridge, 'generate');
    return true;
  }

  window.SignalLMNativeFallbackLabel = { install: install };
  var timer = setInterval(function () { if (install()) clearInterval(timer); }, 250);
  setTimeout(function () { clearInterval(timer); }, 10000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();