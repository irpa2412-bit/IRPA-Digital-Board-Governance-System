const CACHE_NAME="irpa-dbgs-app-shell-v45";
const APP_SHELL=["/","/index.html","/manifest.webmanifest"];

self.addEventListener("install",(event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",(event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key.startsWith("irpa-dbgs-")&&key!==CACHE_NAME).map(key=>caches.delete(key))
    )).then(()=>self.clients.claim())
  );
});

function isAppAsset(request){
  const url=new URL(request.url);
  return url.origin===self.location.origin && (
    url.pathname.startsWith("/assets/") ||
    url.pathname==="/manifest.webmanifest" ||
    url.pathname==="/favicon.ico"
  );
}

// Cache writes are deliberately best-effort. A cache failure must never turn
// a successful network response into an unhandled service-worker rejection.
function cacheResponse(request,response){
  if(!response || !response.ok || response.type==="opaque") return Promise.resolve();
  try{
    // Clone synchronously while the response is available. Do not call
    // event.waitUntil here: this function runs inside an async fetch promise
    // callback, after the ExtendableEvent dispatch may already have finished.
    if(response.bodyUsed || response.body?.locked) return Promise.resolve();
    const copy=response.clone();
    // The fetch handler's respondWith promise keeps this best-effort cache
    // operation alive. Cache failures never replace a successful response.
    return caches.open(CACHE_NAME)
      .then(cache=>cache.put(request,copy))
      .catch(error=>console.warn("IRPA app-shell cache write skipped:",error));
  }catch(error){
    console.warn("IRPA app-shell response could not be cloned; returning network response unchanged:",error);
    return Promise.resolve();
  }
}

self.addEventListener("fetch",(event)=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request).then(response=>{
        return cacheResponse("/",response).then(()=>response);
      }).catch(()=>caches.match("/").then(cached=>cached||Response.error()))
    );
    return;
  }

  if(isAppAsset(request)){
    event.respondWith(
      caches.match(request).then(cached=>{
        // Prefer the current deployment; cached assets are an offline fallback only.
        return fetch(request).then(response=>{
          return cacheResponse(request,response).then(()=>response);
        }).catch(()=>cached||Response.error());
      })
    );
  }
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
