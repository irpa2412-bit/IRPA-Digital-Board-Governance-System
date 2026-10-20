(() => {
  let deferredPrompt = null;
  const addButton = () => {
    if (document.getElementById("irpa-install-app")) return;
    const button = document.createElement("button");
    button.id = "irpa-install-app";
    button.type = "button";
    button.textContent = "Install app";
    button.setAttribute("aria-label", "Install IRPA-DBGS app");
    Object.assign(button.style, {position:"fixed",right:"16px",bottom:"16px",zIndex:"2147483000",padding:"12px 16px",border:"0",borderRadius:"999px",background:"#b8e0c8",color:"#071713",font:"600 14px system-ui",boxShadow:"0 4px 18px #0005",cursor:"pointer"});
    button.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch {}
        deferredPrompt = null;
        button.hidden = true;
      } else {
        alert("To install IRPA-DBGS, open your browser menu and choose Install app / Install this site as an app. On iPhone/iPad, use Share → Add to Home Screen.");
      }
    });
    document.body.appendChild(button);
  };
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredPrompt = event; addButton(); });
  window.addEventListener("appinstalled", () => { const b=document.getElementById("irpa-install-app"); if(b)b.hidden=true; });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton, {once:true}); else addButton();
})();