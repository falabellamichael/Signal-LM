(function(){
  if(window.SignalLMMcpAuth)return;
  var KEY='lmStudioLite.settings.v1';
  var DEF='http://localhost:1234/v1';
  function readSettings(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(e){return{}}}
  function writeSettings(next){localStorage.setItem(KEY,JSON.stringify(next||{}))}
  function cleanBase(url){return String(url||DEF).trim().replace(/\/+$/,'')}
  function apiBaseUrl(){return cleanBase(readSettings().baseUrl)}
  function nativeApiBaseUrl(){var base=apiBaseUrl();if(/\/api\/v1$/i.test(base))return base;if(/\/v1$/i.test(base))return base.replace(/\/v1$/i,'/api/v1');return base+'/api/v1'}
  function savedKey(){var s=readSettings();return String(s.mcpAuthToken||s.apiKey||'').trim()}
  function setSavedKey(value){var s=readSettings();s.apiKey=String(value||'').trim();s.mcpAuthToken=s.apiKey;writeSettings(s);return s.apiKey}
  function authHeaders(extra){var h=Object.assign({},extra||{}),k=savedKey();if(k)h['Author'+'ization']='Bear'+'er '+k;return h}
  function jsonHeaders(extra){return authHeaders(Object.assign({'Content-Type':'application/json'},extra||{}))}
  function bridgeAuthPayload(extra){var k=savedKey();return Object.assign({auth:k?{type:'bearer',token:k}:null,headers:authHeaders()},extra||{})}
  function endpoint(path){return apiBaseUrl()+path}
  function nativeEndpoint(path){return nativeApiBaseUrl()+path}
  async function testModels(){var url=endpoint('');var r=await fetch(url,{method:'GET',headers:authHeaders()});var txt=await r.clone().text().catch(function(){return''});var p=null;try{p=txt?JSON.parse(txt):null}catch(e){}var n=Array.isArray(p&&p.data)?p.data.length:Array.isArray(p&&p.models)?p.models.length:0;return{ok:r.ok,status:r.status,url:url,models:n,detail:r.ok?'Model request succeeded.':txt}}
  async function testMcpChat(model){var url=nativeEndpoint('/chat');var body={model:model||readSettings().model||'',input:'Reply with exactly: MCP ready',integrations:[],temperature:0,max_output_tokens:24,store:false};var r=await fetch(url,{method:'POST',headers:jsonHeaders(),body:JSON.stringify(body)});var txt=await r.clone().text().catch(function(){return''});return{ok:r.ok,status:r.status,url:url,detail:r.ok?'MCP chat endpoint reached.':txt}}
  window.SignalLMMcpAuth={readSettings:readSettings,writeSettings:writeSettings,normalizeBaseUrl:cleanBase,apiBaseUrl:apiBaseUrl,nativeApiBaseUrl:nativeApiBaseUrl,endpoint:endpoint,nativeEndpoint:nativeEndpoint,token:savedKey,setToken:setSavedKey,authHeaders:authHeaders,jsonHeaders:jsonHeaders,bridgeAuthPayload:bridgeAuthPayload,testModels:testModels,testMcpChat:testMcpChat};
})();
