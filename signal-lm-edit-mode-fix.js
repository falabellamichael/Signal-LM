// Signal-LM edit-mode format helper.
(function () {
  if (window.__signalLmEditModeFix) return;
  window.__signalLmEditModeFix = true;

  function install() {
    if (typeof window.buildWorkspaceEditInstruction === 'function' && !window.__signalLmStrictInstructionPatched) {
      const previous = window.buildWorkspaceEditInstruction;
      window.buildWorkspaceEditInstruction = function () {
        return previous() + '\n\nFor workspace file changes, answer with one fenced JSON object using the files array schema expected by the Apply panel. Include complete replacement content for each changed file.';
      };
      window.__signalLmStrictInstructionPatched = true;
    }
  }

  const timer = setInterval(install, 200);
  setTimeout(function () { clearInterval(timer); }, 5000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
