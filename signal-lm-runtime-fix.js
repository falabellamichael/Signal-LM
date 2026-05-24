// Signal-LM runtime restore patch.
(function(){
  if(window.__signalLmRuntimeFix)return;window.__signalLmRuntimeFix=true;
  var root=document.documentElement;
  function setVar(k,v){root.style.setProperty(k,v)}
  function syncViewport(){
    var vv=window.visualViewport,h=vv&&vv.height?vv.height:window.innerHeight,ot=vv&&typeof vv.offsetTop==='number'?vv.offsetTop:0,lh=window.innerHeight||h||0,ki=Math.max(0,Math.round(lh-h-ot));
    if(h)setVar('--app-height',Math.round(h)+'px');setVar('--viewport-offset-top',Math.round(ot)+'px');setVar('--keyboard-inset',ki+'px');if(document.body)document.body.classList.toggle('keyboard-open',ki>80);
  }
  function installCss(){
    if(document.getElementById('signal-lm-mobile-keyboard-fix'))return;
    var s=document.createElement('style');s.id='signal-lm-mobile-keyboard-fix';
    s.textContent=':root{--viewport-offset-top:0px;--keyboard-inset:0px}@media(max-width:768px){html,body{height:var(--app-height)!important;min-height:var(--app-height)!important;max-height:var(--app-height)!important;overflow:hidden!important;overscroll-behavior:none}body{position:fixed;inset:0;width:100%}.main-chat{position:fixed!important;top:var(--viewport-offset-top)!important;left:0!important;right:0!important;height:var(--app-height)!important;max-height:var(--app-height)!important;overflow:hidden!important;transform:translateZ(0)}#messages{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.composer-stack{flex:0 0 auto!important;position:relative;z-index:35;transform:translateZ(0);padding-bottom:calc(.75rem + var(--safe-bottom))!important}.keyboard-open .composer-stack{padding-bottom:.55rem!important}.keyboard-open #messages{scroll-padding-bottom:1rem}}';
    document.head.appendChild(s);
  }
  function scrollMessages(){var m=document.getElementById('messages');if(m)m.scrollTop=m.scrollHeight;}
  installCss();syncViewport();
  window.addEventListener('resize',syncViewport,{passive:true});
  window.addEventListener('orientationchange',function(){setTimeout(syncViewport,80)},{passive:true});
  window.addEventListener('focusin',function(){setTimeout(function(){syncViewport();scrollMessages()},60)},{passive:true});
  window.addEventListener('focusout',function(){setTimeout(syncViewport,160)},{passive:true});
  if(window.visualViewport){window.visualViewport.addEventListener('resize',function(){syncViewport();scrollMessages()},{passive:true});window.visualViewport.addEventListener('scroll',function(){syncViewport();scrollMessages()},{passive:true});}

  function parseMaybeJson(v){if(typeof v!=='string')return v;var t=v.trim();if(!t||!/^[{[]/.test(t))return v;try{return JSON.parse(t)}catch(e){return v}}
  function rawBridge(){return window.lmStudioLiteNative||window.NativeFileBridge||window.NativeInferenceBridge||window.AndroidInferenceBridge||null}
  function once(resolveName,rejectName,resolve,reject){window[resolveName]=function(v){cleanup();resolve(parseMaybeJson(v))};window[rejectName]=function(e){cleanup();reject(new Error(String(parseMaybeJson(e)||'Native bridge request failed.')))};function cleanup(){try{delete window[resolveName]}catch(e){window[resolveName]=undefined}try{delete window[rejectName]}catch(e){window[rejectName]=undefined}}}
  function wrap(trigger,resolveName,rejectName,buildArgs){return function(){var b=rawBridge(),args=Array.prototype.slice.call(arguments);if(!b||typeof b[trigger]!=='function')return Promise.reject(new Error('Native bridge method missing: '+trigger));return new Promise(function(resolve,reject){once(resolveName,rejectName,resolve,reject);b[trigger].apply(b,buildArgs?buildArgs(args):args)})}}
  function installBridge(){
    var b=rawBridge();if(!b)return null;var n=window.SignalLMNativeBridge||{};n.acceptsObjects=true;n.objectBridge=true;
    if(typeof b.triggerSelectFolder==='function')n.selectFolder=wrap('triggerSelectFolder','__selectFolderResolve','__selectFolderReject');else if(typeof b.selectFolder==='function')n.selectFolder=function(){return Promise.resolve(b.selectFolder()).then(parseMaybeJson)};
    if(typeof b.triggerGetPersistedWorkspace==='function')n.getPersistedWorkspace=wrap('triggerGetPersistedWorkspace','__getPersistedWorkspaceResolve','__getPersistedWorkspaceReject');else if(typeof b.getPersistedWorkspace==='function')n.getPersistedWorkspace=function(){return Promise.resolve(b.getPersistedWorkspace()).then(parseMaybeJson)};
    if(typeof b.triggerWriteFiles==='function')n.writeFiles=wrap('triggerWriteFiles','__writeFilesResolve','__writeFilesReject',function(args){return[typeof args[0]==='string'?args[0]:JSON.stringify(args[0]||{files:[]})]});else if(typeof b.writeFiles==='function')n.writeFiles=function(p){return Promise.resolve(b.writeFiles(typeof p==='string'?p:JSON.stringify(p))).then(parseMaybeJson)};
    if(typeof b.triggerWriteFile==='function')n.writeFile=wrap('triggerWriteFile','__writeFileResolve','__writeFileReject');else if(typeof b.writeFile==='function')n.writeFile=function(p,c){return Promise.resolve(b.writeFile(p,c)).then(parseMaybeJson)};
    if(typeof b.triggerReadFile==='function')n.readFile=wrap('triggerReadFile','__readFileResolve','__readFileReject');else if(typeof b.readFile==='function')n.readFile=function(p){return Promise.resolve(b.readFile(p)).then(parseMaybeJson)};
    if(typeof b.triggerClearPersistedWorkspace==='function')n.clearPersistedWorkspace=wrap('triggerClearPersistedWorkspace','__clearPersistedWorkspaceResolve','__clearPersistedWorkspaceReject');else if(typeof b.clearPersistedWorkspace==='function')n.clearPersistedWorkspace=function(){return Promise.resolve(b.clearPersistedWorkspace()).then(parseMaybeJson)};
    if(typeof b.triggerHttpRequest==='function'){
      n.httpRequest=function(payload){var id='http_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);return new Promise(function(resolve,reject){window['__httpResolve_'+id]=function(v){cleanup();resolve(v)};window['__httpReject_'+id]=function(e){cleanup();reject(new Error(String(e||'Native HTTP bridge failed.')))};function cleanup(){try{delete window['__httpResolve_'+id]}catch(e){window['__httpResolve_'+id]=undefined}try{delete window['__httpReject_'+id]}catch(e){window['__httpReject_'+id]=undefined}}b.triggerHttpRequest(typeof payload==='string'?payload:JSON.stringify(payload||{}),id)})};
      n.request=n.httpRequest;n.fetchJson=n.httpRequest;
    }else if(typeof b.httpRequest==='function'||typeof b.request==='function'||typeof b.fetchJson==='function'){
      n.httpRequest=function(payload){var m=b.httpRequest||b.request||b.fetchJson;return Promise.resolve(m.call(b,typeof payload==='string'?payload:JSON.stringify(payload||{})))};n.request=n.httpRequest;n.fetchJson=n.httpRequest;
    }
    window.SignalLMNativeBridge=n;window.SignalLMTools=window.SignalLMTools||{};window.SignalLMTools.bridge=n;return n;
  }
  window.SignalLMInstallNativeBridge=installBridge;installBridge();

  function normalizePath(path){var clean=String(path||'').replace(/\\/g,'/').replace(/^\/+/, '').replace(/\/+/g,'/').trim();if(!clean||clean.indexOf('../')!==-1||clean==='..'||/^[a-z]+:/i.test(clean))return'';return clean}
  function normPayload(parsed){var src=Array.isArray(parsed)?parsed:(parsed&& (parsed.files||parsed.changes||parsed.edits)) || [];if(!Array.isArray(src))return[];var map=new Map();src.forEach(function(item){var path=normalizePath(item&&(item.path||item.file||item.name||item.relativePath));var content=item&&(item.content!==undefined?item.content:item.newContent!==undefined?item.newContent:item.replacement!==undefined?item.replacement:item.text);if(path&&typeof content==='string')map.set(path,{path:path,content:content})});return Array.from(map.values())}
  function jsonBlocks(text){var raw=String(text||''),out=[],starts=[];for(var i=0;i<raw.length;i++){if(raw[i]==='{'||raw[i]==='[')starts.push(i)}starts.forEach(function(start){if(out.length>8)return;var depth=0,q='',esc=false;for(var i=start;i<raw.length;i++){var ch=raw[i];if(q){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch===q)q='';continue}if(ch==='"'||ch==="'"){q=ch;continue}if(ch==='{'||ch==='[')depth++;if(ch==='}'||ch===']')depth--;if(depth===0){out.push(raw.slice(start,i+1));break}}});return out}
  function robustExtract(text,prev){var raw=String(text||''),c=[],m;var re=/```(?:json|lmstudio-edits|signal-lm-edits)?\s*([\s\S]*?)```/gi;while((m=re.exec(raw)))c.push(m[1].trim());c=c.concat(jsonBlocks(raw));for(var i=0;i<c.length;i++){var parsed=parseMaybeJson(c[i]);var edits=normPayload(parsed);if(edits.length)return edits}return typeof prev==='function'?prev(raw):[]}
  function restoreHooks(){
    installBridge();
    if(typeof window.getNativeFileBridge==='function'&&!window.__signalLmGetNativeFileBridgePatched){var oldGet=window.getNativeFileBridge;window.getNativeFileBridge=function(){installBridge();var n=window.SignalLMNativeBridge;if(n&&(n.selectFolder||n.writeFiles||n.readFile))return n;return oldGet()};window.__signalLmGetNativeFileBridgePatched=true}
    if(typeof window.buildWorkspaceEditInstruction==='function'&&!window.__signalLmEditInstructionPatched){var oldInst=window.buildWorkspaceEditInstruction;window.buildWorkspaceEditInstruction=function(){return oldInst()+'\n\nSignal-LM edit tool contract: when changing files, output exactly one fenced json block. Use {"files":[{"path":"relative/path","content":"complete replacement content"}]}. Do not output diffs, markdown file sections, or partial snippets. The app will parse this block and show an Apply button that writes through the Android bridge, File System Access API, or ZIP fallback.'};window.__signalLmEditInstructionPatched=true}
    if(typeof window.extractEditsFromAssistantText==='function'&&!window.__signalLmExtractEditsPatched){var oldExtract=window.extractEditsFromAssistantText;window.extractEditsFromAssistantText=function(text){return robustExtract(text,oldExtract)};window.__signalLmExtractEditsPatched=true}
  }
  async function restoreWorkspace(){try{installBridge();var b=window.SignalLMNativeBridge;if(!b||!b.getPersistedWorkspace||typeof window.loadNativeWorkspace!=='function')return;var strip=document.getElementById('workspace-strip'),name=(document.getElementById('workspace-name')||{}).textContent||'';if(strip&&strip.classList.contains('show')&&!/no folder selected|context only/i.test(name))return;var ws=await b.getPersistedWorkspace();if(ws&&Array.isArray(ws.files)&&ws.files.length)await window.loadNativeWorkspace(ws)}catch(e){console.warn('Native workspace restore skipped:',e)}}
  var attempts=0,timer=setInterval(function(){attempts++;restoreHooks();if(attempts===4||attempts===10)restoreWorkspace();if(attempts>20)clearInterval(timer)},150);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){restoreHooks();setTimeout(restoreWorkspace,600)});else{restoreHooks();setTimeout(restoreWorkspace,600)}
})();
