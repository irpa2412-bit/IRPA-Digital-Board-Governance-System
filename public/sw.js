const CACHE_NAME="irpa-dbgs-app-shell-v1";
const APP_SHELL=["/","/index.html","/manifest.webmanifest"];

self.addEventListener("install",(event)=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
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

self.addEventListener("fetch",(event)=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request).then(response=>{
        const copy=response.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put("/",copy));
        return response;
      }).catch(()=>caches.match("/").then(cached=>cached||Response.error()))
    );
    return;
  }

  if(isAppAsset(request)){
    event.respondWith(
      caches.match(request).then(cached=>{
        const network=fetch(request).then(response=>{
          if(response.ok) caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
          return response;
        }).catch(()=>cached);
        return cached||network;
      })
    );
  }
});
