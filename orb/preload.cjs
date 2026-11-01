// The page gets exactly two capabilities: hear Jarvis's messages, and send one back.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  onMessage: (fn) => ipcRenderer.on("jarvis", (_event, m) => fn(m)),
  send: (m) => ipcRenderer.send("orb", m),
});
