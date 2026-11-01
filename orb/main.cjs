/**
 * Astra's orb: a frameless, transparent, always-on-top window. Astra drives it with JSON lines on stdin and
 * hears back on stdout. Run by Electron as a child of the Astra CLI; quits when Astra closes stdin.
 */
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require("electron");
const path = require("node:path");
const readline = require("node:readline");

const ANSWERS = new Set(["yes", "always", "no"]);

/** Only well-formed messages from the page reach Astra. */
function fromPage(m) {
  if (!m || typeof m !== "object") return null;
  if (m.type === "talk" || m.type === "stop") return { type: m.type };
  if (m.type === "answer" && typeof m.id === "string" && ANSWERS.has(m.answer)) {
    return { type: "answer", id: m.id, answer: m.answer };
  }
  return null;
}

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

/**
 * Menu-bar icon drawn in code (no image files): a sun disc with a ring and three-tier wings. As a template
 * image macOS tints it for light and dark menu bars.
 */
function trayIcon() {
  const size = 36; // 18 pt at 2x
  const buf = Buffer.alloc(size * size * 4);
  const cover = (x, y) => {
    const dx = x - 18;
    const dy = y - 18;
    const d = Math.hypot(dx, dy);
    if (d <= 6) return 1; // disc
    if (d >= 8.5 && d <= 10) return 1; // ring
    const reach = Math.abs(dx);
    for (const [row, len] of [[14, 17], [17.5, 14], [21, 11]]) {
      if (reach >= 11 && reach <= len && Math.abs(y - (row - ((reach - 11) / 6) * 2)) <= 1.1) return 1; // wings
    }
    return 0;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) a += cover(x + ox, y + oy) / 4;
      buf[(y * size + x) * 4 + 3] = Math.round(a * 255); // BGRA, black with alpha
    }
  }
  const image = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  image.setTemplateImage(true);
  return image;
}

const WEB_PREFERENCES = {
  preload: path.join(__dirname, "preload.cjs"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

/** No window may navigate or open new windows; web links go to the user's browser instead. */
function harden(w) {
  const external = (url) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
  };
  w.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    e.preventDefault();
    external(url);
  });
}

app.dock?.hide();

app.whenReady().then(() => {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 350;
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
    webPreferences: WEB_PREFERENCES,
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  harden(win);
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.once("did-finish-load", () => send({ type: "ready" }));

  const show = () => {
    win.showInactive();
    win.moveTop();
  };
  const tray = new Tray(trayIcon());
  tray.setToolTip("Astra");
  // One click on the menu-bar icon brings the orb back (or tucks it away); right-click shows the same as a menu.
  const toggle = () => (win.isVisible() ? win.hide() : show());
  tray.on("click", toggle);
  tray.on("right-click", () =>
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        win.isVisible() ? { label: "Hide Astra", click: () => win.hide() } : { label: "Show Astra", click: show },
        { label: "Stop Astra", click: () => send({ type: "stop" }) },
        { label: "Show last detail", enabled: lastDetail !== null, click: () => openPanel(lastDetail) },
        { type: "separator" },
        {
          label: "Quit Astra",
          click: () => {
            send({ type: "quit" });
            // Astra closes the orb as it exits; if it doesn't answer, close anyway.
            setTimeout(() => app.quit(), 3000);
          },
        },
      ]),
    ),
  );

  // The detail panel: a second HUD window for anything too long to say. Opens beside the orb.
  let panel = null;
  let lastDetail = null;
  const openPanel = (msg) => {
    lastDetail = msg;
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send("jarvis", msg);
      panel.showInactive();
      return;
    }
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const width = 540;
    const height = 620;
    panel = new BrowserWindow({
      width,
      height,
      x: Math.max(workArea.x + 12, bounds.x - width - 8),
      y: Math.max(workArea.y + 12, Math.min(bounds.y, workArea.y + workArea.height - height - 12)),
      minWidth: 340,
      minHeight: 220,
      frame: false,
      // Frosted glass: macOS blurs whatever is behind the window; panel.css adds tint, rim light and sheen.
      vibrancy: "hud",
      visualEffectState: "active",
      backgroundColor: "#00000000",
      roundedCorners: true,
      resizable: true,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: WEB_PREFERENCES,
    });
    panel.setAlwaysOnTop(true, "floating");
    harden(panel);
    panel.loadFile(path.join(__dirname, "panel.html"));
    panel.webContents.once("did-finish-load", () => {
      panel.webContents.send("jarvis", msg);
      panel.showInactive();
    });
  };

  // Dragging is done here rather than with CSS drag regions, which don't take hold reliably on a transparent window.
  let drag = null;
  const dragStep = () => {
    if (!drag || drag.target.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    drag.target.setPosition(drag.winX + p.x - drag.cursorX, drag.winY + p.y - drag.cursorY);
  };

  ipcMain.on("orb", (event, m) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (m?.type === "minimise") return win.hide();
    if (m?.type === "panel-close") return panel?.close();
    if (m?.type === "drag-start" && sender) {
      const p = screen.getCursorScreenPoint();
      const [winX, winY] = sender.getPosition();
      clearInterval(drag?.timer);
      drag = { target: sender, cursorX: p.x, cursorY: p.y, winX, winY, timer: setInterval(dragStep, 16) };
      return;
    }
    if (m?.type === "drag-end") {
      clearInterval(drag?.timer);
      drag = null;
      return;
    }
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
      else if (m.type === "detail") openPanel(m);
      else if (m.type === "ask") {
        // A question needs you, so a minimised orb comes back for it.
        if (!win.isVisible()) show();
        win.webContents.send("jarvis", m);
        win.focus();
      } else win.webContents.send("jarvis", m);
    })
    .on("close", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
