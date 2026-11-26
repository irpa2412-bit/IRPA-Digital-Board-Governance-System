/* Build-keyed shell cache. API/auth/signing traffic is never cached. */
const CACHE_PREFIX="irpa-dbgs-shell-";
const BUILD_KEY=new URL(self.location.href).searchParams.get("v")||"unversioned";
const CACHE_NAME=CACHE_PREFIX+BUILD_KEY;
const OFFLINE_URL="/offline.html";
const APP_SHELL=["/","/index.html","/manifest.webmanifest",OFFLINE_URL,"/icons/irpa-192.svg","/icons/irpa-512.svg","/icons/irpa-maskable.svg","/install.js"];
function excluded(url){const p=url.pathname.toLowerCase();return p.startsWith("/api/")||p.includes("/api/")||p.includes("/worker/")||p.includes("auth")||p.includes("sign")||p.includes("signature")||p.includes("invitation")||p.endsWith(".pdf")||p.includes("/pdf/")||p.includes("token")||p.includes("upload")||p.includes("approval");}
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||excluded(url))return;
 if(request.mode==="navigate"){
  event.respondWith(fetch(request,{cache:"no-store"}).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put("/",response.clone())).catch(()=>{});return response;}).catch(async()=>(await caches.match("/"))||(await caches.match(OFFLINE_URL))||Response.error()));
  return;
 }
 const path=url.pathname,asset=APP_SHELL.includes(path)||path.startsWith("/assets/")||/\.(?:js|css|woff2?|ttf|svg|png|webp|ico)$/.test(path);
 if(!asset)return;
 event.respondWith((async()=>{const cached=await caches.match(request);try{const response=await fetch(request,{cache:"no-store"});if(response.ok&&response.type!=="opaque")await caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone())).catch(()=>{});return response;}catch{return cached||Response.error();}})());
});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")void self.skipWaiting();});
