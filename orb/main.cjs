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
  if (m.type === "volume" && typeof m.delta === "number" && Math.abs(m.delta) <= 0.25) return { type: "volume", delta: m.delta };
  if ((m.type === "brain-open" || m.type === "brain-map") && typeof m.path === "string" && m.path.length <= 300) {
    return { type: m.type, path: m.path };
  }
  if (m.type === "question-answer" && typeof m.id === "string") {
    const a = m.answer;
    if (Array.isArray(a) && a.length <= 8 && a.every((x) => typeof x === "string" && x.length <= 200)) {
      return { type: "question-answer", id: m.id, answer: a };
    }
    if (typeof a === "string" && a.trim() && a.length <= 2000) return { type: "question-answer", id: m.id, answer: a };
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
        { label: "Show last detail", enabled: slabs.detail.last !== null, click: () => openSlab("detail", slabs.detail.last) },
        { label: "Show last map", enabled: slabs.graph.last !== null, click: () => openSlab("graph", slabs.graph.last) },
        { label: "Open brain", click: () => send({ type: "brain-request" }) },
        {
          label: "Volume",
          submenu: [25, 50, 75, 100].map((pct) => ({
            label: `${pct}%`,
            type: "radio",
            checked: Math.round(volume * 100) === pct,
            click: () => send({ type: "volume", level: pct / 100 }),
          })),
        },
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

  let volume = 0.8; // kept in step with Astra's setting, for the menu's tick

  // Glass slab windows beside the orb: the detail panel (text) and the teardown map (3D graph). One of each.
  const slabs = {
    detail: { file: "panel.html", width: 540, height: 620, win: null, last: null },
    graph: { file: "graph.html", width: 880, height: 640, win: null, last: null },
    brain: { file: "brain.html", width: 920, height: 660, win: null, last: null },
  };
  const openSlab = (kind, msg) => {
    const slab = slabs[kind];
    slab.last = msg;
    if (slab.win && !slab.win.isDestroyed()) {
      slab.win.webContents.send("jarvis", msg);
      slab.win.showInactive();
      return;
    }
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const { width, height } = slab;
    const w = new BrowserWindow({
      width,
      height,
      x: Math.max(workArea.x + 12, bounds.x - width - 8),
      y: Math.max(workArea.y + 12, Math.min(bounds.y, workArea.y + workArea.height - height - 12)),
      minWidth: 340,
      minHeight: 220,
      frame: false,
      // Frosted glass: macOS blurs whatever is behind the window; panel.css adds tint, rim light and sheen.
      vibrancy: "under-window",
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
    slab.win = w;
    w.setAlwaysOnTop(true, "floating");
    harden(w);
    w.loadFile(path.join(__dirname, slab.file));
    w.webContents.once("did-finish-load", () => {
      w.webContents.send("jarvis", msg);
      w.showInactive();
    });
  };

  /** Astra working her own interface (ui_control and quick spoken commands). */
  const runUi = (action) => {
    if (action === "minimise") win.hide();
    else if (action === "show") show();
    else if (action === "close_panels") for (const slab of Object.values(slabs)) slab.win?.isDestroyed() === false && slab.win.close();
    else if (action === "show_last_detail" && slabs.detail.last) openSlab("detail", slabs.detail.last);
    else if (action === "show_last_map" && slabs.graph.last) openSlab("graph", slabs.graph.last);
    else if (action === "collapse_panel" || action === "expand_panel") {
      win.webContents.send("jarvis", { type: "collapse", collapsed: action === "collapse_panel" });
    }
  };

  /** Slides the window to (x, y) over ~450 ms, eased, instead of jumping. */
  let gliding = null;
  const glideTo = (x, y) =>
    new Promise((resolve) => {
      clearInterval(gliding);
      const [x0, y0] = win.getPosition();
      const start = Date.now();
      const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
      gliding = setInterval(() => {
        const p = Math.min(1, (Date.now() - start) / 450);
        win.setPosition(Math.round(x0 + (x - x0) * ease(p)), Math.round(y0 + (y - y0) * ease(p)));
        if (p === 1) {
          clearInterval(gliding);
          gliding = null;
          resolve();
        }
      }, 16);
    });

  /** Astra moving herself: a spot on screen (where the orb, not the window, ends up) or a nudge. */
  const ORB_CENTRE = 136; // the orb's centre inside its canvas (orb.js: H / 2 + 6)
  const NUDGE = 140;
  const moveTo = async (position) => {
    if (!win.isVisible()) show();
    const b = win.getBounds();
    const { workArea: wa } = screen.getDisplayMatching(b);
    if (position.startsWith("nudge_")) {
      const dx = position === "nudge_left" ? -NUDGE : position === "nudge_right" ? NUDGE : 0;
      const dy = position === "nudge_up" ? -NUDGE : position === "nudge_down" ? NUDGE : 0;
      await glideTo(Math.max(wa.x, Math.min(b.x + dx, wa.x + wa.width - b.width)), b.y + dy);
      return void arrange();
    }
    const [vertical, horizontal] = position.includes("_")
      ? position.split("_")
      : ["top", "bottom"].includes(position) ? [position, "centre"] : ["middle", position];
    const margin = 8;
    const x =
      horizontal === "left" ? wa.x + margin : horizontal === "right" ? wa.x + wa.width - b.width - margin : Math.round(wa.x + (wa.width - b.width) / 2);
    const orbCentreY =
      vertical === "top" ? wa.y + ORB_CENTRE - 20 : vertical === "bottom" ? wa.y + wa.height - 150 : Math.round(wa.y + wa.height / 2);
    // At the top the cards must go below for the orb to reach the menu bar: arrange that before gliding there.
    if (vertical === "top" && !layoutTop) {
      layoutTop = true;
      win.webContents.send("jarvis", { type: "layout", top: true });
      await settle();
      orbOffset = await orbTop();
    }
    await glideTo(x, Math.round(orbCentreY - ORB_CENTRE - orbOffset));
    void arrange();
  };

  /*
   * Window arrangement. The orb stays where it is on screen; the window around it is sized to what's showing, and
   * her cards go below the orb whenever they fit above the bottom of the screen, otherwise above it. (With the cards
   * below, the orb is at the window's top, so it can also be dragged right up under the menu bar.)
   */
  const ORB_SECTION = 290; // the orb, its state label and padding: the window's height with no cards showing
  let layoutTop = true; // true: cards below the orb
  let orbOffset = null; // the orb's top inside the window
  let wantedHeight = ORB_SECTION;
  let arranging = false;
  let arrangeAgain = false;
  const orbTop = () => win.webContents.executeJavaScript("document.querySelector('.orb-wrap').offsetTop");
  const settle = () => new Promise((r) => setTimeout(r, 30));

  const arrange = async () => {
    if (orbOffset === null) return;
    if (arranging) return void (arrangeAgain = true);
    arranging = true;
    try {
      do {
        arrangeAgain = false;
        const b = win.getBounds();
        const { workArea: wa } = screen.getDisplayMatching(b);
        const orbScreenY = b.y + orbOffset;
        const height = Math.round(Math.min(Math.max(wantedHeight, ORB_SECTION), wa.height - 16));
        const below = orbScreenY + height <= wa.y + wa.height - 4;
        if (below === layoutTop && height === b.height) continue;
        if (below !== layoutTop) {
          layoutTop = below;
          win.webContents.send("jarvis", { type: "layout", top: below });
        }
        win.setBounds({ x: b.x, y: b.y, width: b.width, height });
        await settle();
        orbOffset = await orbTop();
        const y = Math.max(wa.y, Math.min(orbScreenY - orbOffset, wa.y + wa.height - height));
        win.setPosition(b.x, y);
        if (drag?.target === win) drag.winY += y - b.y;
      } while (arrangeAgain);
    } finally {
      arranging = false;
    }
  };
  win.webContents.on("did-finish-load", async () => {
    win.webContents.send("jarvis", { type: "layout", top: layoutTop });
    await settle();
    orbOffset = await orbTop();
    void arrange();
  });
  win.on("moved", () => void arrange());

  const fitHeight = (wanted) => {
    wantedHeight = wanted;
    void arrange();
  };

  // Dragging is done here rather than with CSS drag regions, which don't take hold reliably on a transparent window.
  let drag = null;
  const dragStep = () => {
    if (!drag || drag.target.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    drag.target.setPosition(drag.winX + p.x - drag.cursorX, drag.winY + p.y - drag.cursorY);
    if (drag.target === win) void arrange();
  };

  ipcMain.on("orb", (event, m) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (m?.type === "minimise") return win.hide();
    if (m?.type === "fit" && sender === win && Number.isFinite(m.height)) return void fitHeight(m.height);
    if (m?.type === "panel-close") return sender && sender !== win ? sender.close() : undefined;
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
      else if (m.type === "detail" || m.type === "graph" || m.type === "brain") openSlab(m.type, m);
      else if (m.type === "brain-note") slabs.brain.win?.webContents.send("jarvis", m);
      else if (m.type === "ui" && m.action === "move" && typeof m.position === "string") void moveTo(m.position);
      else if (m.type === "ui") runUi(m.action);
      else if (m.type === "volume-level") {
        volume = m.level;
        win.webContents.send("jarvis", m);
      }
      else if (m.type === "ask" || m.type === "question") {
        // A question needs you, so a minimised orb comes back for it.
        if (!win.isVisible()) show();
        win.webContents.send("jarvis", m);
        win.focus();
      } else win.webContents.send("jarvis", m);
    })
    .on("close", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
