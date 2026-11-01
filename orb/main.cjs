/**
 * Jarvis's orb: a frameless, transparent, always-on-top window. Jarvis drives it with JSON lines on stdin and
 * hears back on stdout. Run by Electron as a child of the Jarvis CLI; quits when Jarvis closes stdin.
 */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const readline = require("node:readline");

const ANSWERS = new Set(["yes", "always", "no"]);

/** Only well-formed messages from the page reach Jarvis. */
function fromPage(m) {
  if (!m || typeof m !== "object") return null;
  if (m.type === "talk") return { type: "talk" };
  if (m.type === "answer" && typeof m.id === "string" && ANSWERS.has(m.answer)) {
    return { type: "answer", id: m.id, answer: m.answer };
  }
  return null;
}

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

app.dock?.hide();

app.whenReady().then(() => {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 340;
  const height = 480;
  const win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.once("did-finish-load", () => send({ type: "ready" }));

  ipcMain.on("orb", (_event, m) => {
    const safe = fromPage(m);
    if (safe) send(safe);
  });

  readline
    .createInterface({ input: process.stdin })
    .on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type === "quit") app.quit();
      else if (m.type === "ask") {
        win.webContents.send("jarvis", m);
        win.focus();
      } else win.webContents.send("jarvis", m);
    })
    .on("close", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
