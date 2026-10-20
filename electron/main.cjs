const { app, BrowserWindow, shell } = require("electron");
const APP_URL = process.env.IRPA_DBGS_URL || "https://irpa.or.tz/staging";
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 800, minHeight: 600,
    title: "IRPA-DBGS",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://irpa.or.tz/")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(APP_URL);
}
app.whenReady().then(() => { createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
