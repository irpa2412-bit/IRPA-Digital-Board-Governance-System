const CACHE_NAME="irpa-dbgs-app-shell-v41";
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
function cacheResponse(request,response,event){
  if(!response || !response.ok || response.type==="opaque") return;
  try{
    // Clone synchronously, before handing the original response to the page.
    // A locked/already-consumed body is skipped instead of breaking the fetch.
    if(response.bodyUsed || response.body?.locked) return;
    const copy=response.clone();
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache=>cache.put(request,copy))
        .catch(error=>console.warn("IRPA app-shell cache write skipped:",error))
    );
  }catch(error){
    console.warn("IRPA app-shell response could not be cloned; returning network response unchanged:",error);
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
        cacheResponse("/",response,event);
        return response;
      }).catch(()=>caches.match("/").then(cached=>cached||Response.error()))
    );
    return;
  }

  if(isAppAsset(request)){
    event.respondWith(
      caches.match(request).then(cached=>{
        const network=fetch(request).then(response=>{
          cacheResponse(request,response,event);
          return response;
        }).catch(()=>cached||Response.error());
        return cached||network;
      })
    );
  }
});
