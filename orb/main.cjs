/**
 * Astra's orb: a frameless, transparent, always-on-top window. Astra drives it with JSON lines on stdin and
 * hears back on stdout. Run by Electron as a child of the Astra CLI; quits when Astra closes stdin.
 */
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } = require("electron");
const path = require("node:path");
const readline = require("node:readline");
const { layoutPanels, placeNew, minFor } = require("./layout.cjs");

const ANSWERS = new Set(["yes", "always", "no"]);

/** Only well-formed messages from the page reach Astra. */
function fromPage(m) {
  if (!m || typeof m !== "object") return null;
  if (m.type === "talk" || m.type === "stop" || m.type === "record") return { type: m.type };
  if (m.type === "type-only" && typeof m.on === "boolean") return { type: "type-only", on: m.on };
  if (m.type === "typed" && typeof m.text === "string" && m.text.trim() && m.text.length <= 2000) return { type: "typed", text: m.text };
  if (m.type === "answer" && typeof m.id === "string" && ANSWERS.has(m.answer)) {
    return { type: "answer", id: m.id, answer: m.answer };
  }
  if (m.type === "volume" && typeof m.delta === "number" && Math.abs(m.delta) <= 0.25) return { type: "volume", delta: m.delta };
  if (m.type === "git-diff" && typeof m.root === "string" && typeof m.path === "string") return { type: "git-diff", root: m.root, path: m.path };
  if ((m.type === "brain-open" || m.type === "brain-map") && typeof m.path === "string" && m.path.length <= 300) {
    return { type: m.type, path: m.path };
  }
  // The sessions panel's buttons (Astra checks them again before acting).
  if (m.type === "session-action" && ["open", "message", "stop", "transcript"].includes(m.action) && typeof m.ref === "string" && m.ref.length < 200) {
    const out = { type: "session-action", action: m.action, ref: m.ref };
    if (typeof m.run === "string" && /^s\d{1,4}$/.test(m.run)) out.run = m.run;
    if (typeof m.text === "string" && m.text.trim() && m.text.length <= 4000) out.text = m.text;
    return out;
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

/** Tallyline's own server: the only address the expanded Tallyline panel may show. */
const TALLYLINE_ORIGIN = "http://127.0.0.1:4317";

/** The expanded Tallyline panel shows a web app, so it gets no bridge at all, its own storage, and a sandbox. */
const TALLYLINE_PREFERENCES = { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "persist:tallyline" };

/** Whether an address is on Tallyline's local server (exact origin: not another port, host or scheme). */
function isTallyline(url) {
  try {
    return new URL(url).origin === TALLYLINE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * The expanded Tallyline panel: it may move around Tallyline itself, but any other address (a Jira link, say) opens
 * in the user's browser, and it can't open windows or ask for permissions (camera, location, notifications...).
 */
function hardenTallyline(w) {
  const elsewhere = (url) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isTallyline(url)) w.loadURL(url);
    else elsewhere(url);
    return { action: "deny" };
  });
  const guard = (e, url) => {
    if (isTallyline(url)) return;
    e.preventDefault();
    elsewhere(url);
  };
  w.webContents.on("will-navigate", guard);
  w.webContents.on("will-redirect", guard);
  w.webContents.session.setPermissionRequestHandler((_wc, _perm, done) => done(false));
}

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
  let lastCoffee = null;
  win.webContents.on("did-finish-load", () => {
    if (lastCoffee) win.webContents.send("jarvis", lastCoffee);
  });
  win.webContents.once("did-finish-load", () => send({ type: "ready" }));

  // Folding away and unfolding: the orb page plays the transform and reports "transform-done" (or we move on after
  // 1.6 s), so the window only hides once she has folded up, and unfolds after it reappears.
  let transformWaiter = null;
  let foldingToQuit = false;
  const transform = (to) =>
    new Promise((resolve) => {
      transformWaiter?.();
      const timer = setTimeout(() => done(), 1600);
      const done = () => {
        clearTimeout(timer);
        if (transformWaiter === done) transformWaiter = null;
        resolve();
      };
      transformWaiter = done;
      win.webContents.send("jarvis", { type: "transform", to });
    });
  const show = async () => {
    if (!win.isVisible()) {
      win.webContents.send("jarvis", { type: "transform", to: "closed-now" });
      win.showInactive();
      win.moveTop();
    }
    await transform("open");
  };
  const hideOrb = async () => {
    if (!win.isVisible()) return;
    await transform("close");
    win.hide();
  };
  const tray = new Tray(trayIcon());
  tray.setToolTip("Astra");
  // One click on the menu-bar icon brings the orb back (or tucks it away); right-click shows the same as a menu.
  const toggle = () => void (win.isVisible() ? hideOrb() : show());
  tray.on("click", toggle);
  tray.on("right-click", () =>
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        win.isVisible() ? { label: "Hide Astra", click: () => void hideOrb() } : { label: "Show Astra", click: () => void show() },
        { label: "Stop Astra", click: () => send({ type: "stop" }) },
        { label: "Show last detail", enabled: slabs.detail.last !== null, click: () => openSlab("detail", slabs.detail.last, "user") },
        { label: "Show last map", enabled: slabs.graph.last !== null, click: () => openSlab("graph", slabs.graph.last, "user") },
        { label: "Open brain", click: () => send({ type: "brain-request" }) },
        { label: "Tidy up panels", click: () => relayout("tidy") },
        { label: "Show terminal", click: () => openSlab("terminal", slabs.terminal.last ?? { type: "terminal", entries: [] }, "user") },
        { label: "Show git changes", click: () => openSlab("git", slabs.git.last ?? { type: "git", repos: [] }, "user") },
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
        // Restarts her with her latest code; she waits for work in progress first and says so.
        { label: "Continue last session", click: () => send({ type: "continue-session" }) },
        { label: "Restart Astra", click: () => send({ type: "restart" }) },
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
    // The work panels stack at the bottom-left of the orb: the terminal at the bottom, git changes above it.
    terminal: { file: "terminal.html", width: 600, height: 330, win: null, last: null, place: "bottom" },
    git: { file: "git.html", width: 600, height: 420, win: null, last: null, place: "above-terminal" },
    // Narrow: a background run's live transcript.
    transcript: { file: "transcript.html", width: 380, height: 560, win: null, last: null },
    // Dan's open sessions: only ever opened on request; while open it keeps itself up to date.
    sessions: { file: "sessions.html", width: 440, height: 520, win: null, last: null },
    // Tallyline at a glance (sprint, today's time, latest issues), refreshed while open; and the full app, expanded.
    tallyline: { file: "tallyline.html", width: 400, height: 460, win: null, last: null },
    "tallyline-app": { url: true, width: 1100, height: 760, win: null, last: null },
  };
  /**
   * Panels Dan closed (✕, or "close your panels"). They stay closed: updates only refresh the dropdown, and only an
   * explicit show (show_terminal, "show me…", the dropdown, Astra's show tools) opens one again. Never cleared by a
   * new request, which is what let background runs reopen them.
   */
  const closed = new Set();

  // Who each open panel is for, which decides whether she tidies it away when she's done:
  // "auto" popped up while she worked (closed when she finishes), "astra" she showed you on purpose (kept until the
  // end of her next request), "user" you opened or clicked into (never closed for you).
  const RANK = { auto: 0, astra: 1, user: 2 };
  let requestNo = 0;
  const TIDY_MS = 6000;

  /** She's finished (and no background session is running): close what's no longer needed, after a moment. */
  const tidyUp = () => {
    const at = requestNo;
    setTimeout(() => {
      if (requestNo !== at) return; // A new request started: leave everything for it.
      for (const slab of Object.values(slabs)) {
        if (!slab.win || slab.win.isDestroyed()) continue;
        if (slab.owner === "auto" || (slab.owner === "astra" && slab.request < at)) slab.win.close();
      }
    }, TIDY_MS);
  };

  /** Tells the orb which panels she has shown and whether each is open, folded or closed (for its dropdown). */
  const sendPanels = () => {
    if (win.isDestroyed()) return;
    const panels = Object.entries(slabs)
      .filter(([, s]) => s.last)
      .map(([kind, s]) => ({ kind, state: !s.win || s.win.isDestroyed() ? "closed" : s.collapsed ? "collapsed" : "open" }));
    win.webContents.send("jarvis", { type: "panels", panels });
  };

  /** From the orb's dropdown: unfold a folded panel, or reopen a closed one as yours (so she won't tidy it away). */
  const restoreSlab = (kind) => {
    const slab = slabs[kind];
    if (!slab?.last) return;
    closed.delete(kind);
    // Reopened from the dropdown: Astra starts refreshing it again.
    if (kind === "sessions" || kind === "tallyline") send({ type: "panel-opened", kind });
    if (slab.win && !slab.win.isDestroyed()) {
      slab.owner = "user";
      if (slab.collapsed) slab.win.webContents.send("jarvis", { type: "slab-expand" });
      slab.win.show();
      slab.lastUsed = Date.now();
      scheduleLayout();
      return;
    }
    openSlab(kind, slab.last, "user");
  };

  /**
   * The sun glyph (or "bring your panels forward"): every open panel in front of other apps' windows, the one used
   * most recently on top. Without focusing them, so typing stays where it was.
   */
  const raisePanels = () => {
    const open = Object.values(slabs).filter((s) => s.win && !s.win.isDestroyed() && s.win.isVisible());
    open.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0));
    for (const slab of open) slab.win.showInactive();
  };

  /**
   * Opens a panel, or updates the open one. `raise` false is a live update (a transcript ticking, the terminal
   * scrolling): it refreshes the panel where it sits instead of pulling it over the one Dan is looking at.
   */
  const openSlab = (kind, msg, owner = "astra", raise = true) => {
    const slab = slabs[kind];
    slab.last = msg;
    slab.request = requestNo;
    slab.lastUsed = Date.now();
    const webApp = !!slab.url;
    const appUrl = webApp ? `${TALLYLINE_ORIGIN}${typeof msg.path === "string" && msg.path.startsWith("/") ? msg.path : "/"}` : null;
    if (slab.win && !slab.win.isDestroyed()) {
      if (RANK[owner] > RANK[slab.owner ?? "auto"]) slab.owner = owner;
      if (webApp) {
        slab.win.loadURL(appUrl);
        slab.win.show();
        return;
      }
      slab.win.webContents.send("jarvis", msg);
      // showInactive orders the window to the front, so only a hidden panel or an explicit show gets it.
      if (raise || !slab.win.isVisible()) slab.win.showInactive();
      return;
    }
    slab.owner = owner;
    slab.collapsed = false;
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const { width, height } = slab;
    const left = Math.max(workArea.x + 12, bounds.x - width - 8);
    const bottom = workArea.y + workArea.height - 12;
    const placed =
      slab.place === "bottom"
        ? { x: left, y: bottom - height }
        : slab.place === "above-terminal"
          ? { x: left, y: Math.max(workArea.y + 12, bottom - slabs.terminal.height - 10 - height) }
          : null;
    const w = new BrowserWindow({
      width,
      height,
      x: placed?.x ?? left,
      y: placed?.y ?? Math.max(workArea.y + 12, Math.min(bounds.y, workArea.y + workArea.height - height - 12)),
      minWidth: 340,
      minHeight: 220,
      // Panels are normal windows that other apps can cover (only the orb floats); the sun glyph brings them all back.
      // The full Tallyline app also gets a title bar, native close and keyboard focus.
      ...(webApp
        ? { title: "Tallyline", backgroundColor: "#0d0b08", fullscreenable: true }
        : {
            frame: false,
            // Frosted glass: macOS blurs whatever is behind the window; panel.css adds tint, rim light and sheen.
            vibrancy: "under-window",
            visualEffectState: "active",
            backgroundColor: "#00000000",
            roundedCorners: true,
            fullscreenable: false,
            skipTaskbar: true,
          }),
      resizable: true,
      show: false,
      webPreferences: webApp ? TALLYLINE_PREFERENCES : WEB_PREFERENCES,
    });
    slab.win = w;
    slab.pinned = false;
    // Clicking into a panel (or dragging it) makes it yours: she won't close it on you, and it comes to the front.
    w.on("focus", () => {
      slab.owner = "user";
      slab.lastUsed = Date.now();
      w.moveTop();
    });
    // Resized by hand (not by the layout): it keeps the size and place you gave it until it closes or you tidy up.
    w.on("resized", () => {
      if (Date.now() > layingOutUntil) slab.pinned = true;
    });
    w.on("closed", () => {
      slab.collapsed = false;
      slab.pinned = false;
      slab.placed = false;
      // Astra stops refreshing a panel no one can see.
      if (kind === "sessions" || kind === "tallyline") send({ type: "panel-closed", kind });
      sendPanels();
      scheduleLayout();
    });
    if (webApp) {
      hardenTallyline(w);
      w.loadURL(appUrl);
      // Opened on request, so it comes forward with the keyboard (unlike her panels, which never take focus).
      w.once("ready-to-show", () => {
        w.show();
        sendPanels();
        relayout();
      });
      return;
    }
    harden(w);
    w.loadFile(path.join(__dirname, slab.file));
    w.webContents.once("did-finish-load", () => {
      w.webContents.send("jarvis", msg);
      w.showInactive();
      sendPanels();
      relayout();
    });
  };

  // Window moves and resizes before this time are the layout's own (it animates), not yours.
  let layingOutUntil = 0;

  /**
   * Lays every visible panel out so all can be seen at once (see layout.cjs) on the display the orb is on, skipping any you've
   * dragged or resized by hand. `tidy` (the "tidy up" action) brings those back into the layout too.
   */
  const relayout = (mode = "new") => {
    const tidy = mode === "tidy";
    if (tidy) for (const s of Object.values(slabs)) s.pinned = false;
    const visible = Object.entries(slabs).filter(([, s]) => s.win && !s.win.isDestroyed() && s.win.isVisible());
    const orb = win.getBounds();
    const { workArea } = screen.getDisplayMatching(orb);
    layingOutUntil = Date.now() + 700;
    // Once panels are arranged, an update never moves them: only panels not yet placed get a spot, a free one.
    if (mode === "new" && visible.some(([, s]) => s.placed || s.pinned)) {
      const fixed = visible.filter(([, s]) => s.placed || s.pinned).map(([, s]) => s.win.getBounds());
      for (const [, s] of visible) {
        if (s.placed || s.pinned) continue;
        const rect = placeNew({ area: workArea, orb, fixed, width: s.width, height: s.collapsed ? s.win.getBounds().height : s.height });
        s.win.setBounds(rect, true);
        s.placed = true;
        fixed.push(rect);
      }
      return;
    }
    const open = visible.filter(([, s]) => !s.pinned);
    if (!open.length) return;
    const { rects, order } = layoutPanels({
      area: workArea,
      orb,
      panels: open.map(([kind, s]) => {
        const b = s.win.getBounds();
        // The size each panel wants is its own default; a folded one keeps its header height.
        return { kind, width: s.width, height: s.collapsed ? b.height : s.height, folded: !!s.collapsed, lastUsed: s.lastUsed ?? 0 };
      }),
    });
    for (const [kind, s] of open) {
      if (!rects[kind]) continue;
      // The layout never goes below a panel's own minimum (a folded one is just its header).
      const [minW, minH] = minFor(kind);
      s.win.setMinimumSize(Math.min(minW, rects[kind].width), s.collapsed ? 60 : Math.min(minH, rects[kind].height));
      s.win.setBounds(rects[kind], true);
      s.placed = true;
    }
    // Where panels must overlap, the lower ones go on top so every header above stays visible.
    for (const kind of order) if (slabs[kind]?.win && !slabs[kind].win.isDestroyed()) slabs[kind].win.moveTop();
  };
  let layoutTimer;
  /** A re-layout once things settle (the orb gliding, a burst of panel changes, a display rearranging). */
  const scheduleLayout = () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => relayout(), 250);
  };
  // A display change can leave panels off-screen, so that one re-arranges everything (except panels placed by hand).
  for (const event of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(event, () => {
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => relayout("all"), 250);
    });
  }

  /** Astra working her own interface (ui_control and quick spoken commands). */
  const runUi = (action) => {
    if (action === "stack_windows") return relayout("tidy");
    if (action === "panels_front") return raisePanels();
    if (action === "minimise") void hideOrb();
    else if (action === "show") void show();
    // Every panel, whatever fed it, and they stay closed until something explicitly shows one again.
    else if (action === "close_panels") {
      for (const [kind, slab] of Object.entries(slabs)) {
        closed.add(kind);
        if (slab.win?.isDestroyed() === false) slab.win.close();
      }
      sendPanels();
    }
    else if (action === "show_last_detail" && slabs.detail.last) {
      closed.delete("detail");
      openSlab("detail", slabs.detail.last);
    } else if (action === "show_last_map" && slabs.graph.last) {
      closed.delete("graph");
      openSlab("graph", slabs.graph.last);
    }
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
  win.on("moved", () => {
    void arrange();
    // The panels follow the orb once it stops.
    scheduleLayout();
  });

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
    if (m?.type === "minimise") return void hideOrb();
    if (m?.type === "panel-restore" && sender === win && typeof m.kind === "string" && slabs[m.kind]) return restoreSlab(m.kind);
    if (m?.type === "panels-front" && sender === win) return raisePanels();
    if (m?.type === "transform-done" && sender === win) return transformWaiter?.();
    if (m?.type === "fit" && sender === win && Number.isFinite(m.height)) return void fitHeight(m.height);
    // The compact Tallyline panel's expand control and issue links: open the full app at that page.
    if (m?.type === "tallyline-open" && sender && sender === slabs.tallyline.win) {
      const where = typeof m.path === "string" && /^\/[\w\-./?=&%]*$/.test(m.path) ? m.path : "/";
      closed.delete("tallyline-app");
      return void openSlab("tallyline-app", { type: "tallyline-app", path: where }, "user");
    }
    if (m?.type === "panel-close") {
      // Closed by its ✕: it stays closed (see `closed`).
      for (const [kind, slab] of Object.entries(slabs)) if (slab.win === sender) closed.add(kind);
      return sender && sender !== win ? sender.close() : undefined;
    }
    if (m?.type === "slab-collapse" && sender && sender !== win) {
      const slab = Object.values(slabs).find((s) => s.win === sender);
      if (!slab) return;
      const [w] = sender.getSize();
      slab.collapsed = !!m.collapsed;
      layingOutUntil = Date.now() + 700;
      sendPanels();
      scheduleLayout();
      if (m.collapsed && Number.isFinite(m.height)) {
        slab.fullHeight = sender.getSize()[1];
        sender.setMinimumSize(340, 60);
        sender.setSize(w, Math.max(60, Math.round(m.height)));
      } else if (!m.collapsed && slab.fullHeight) {
        sender.setMinimumSize(340, 220);
        sender.setSize(w, slab.fullHeight);
      }
      return;
    }
    if (m?.type === "drag-start" && sender) {
      const p = screen.getCursorScreenPoint();
      const [winX, winY] = sender.getPosition();
      clearInterval(drag?.timer);
      drag = { target: sender, cursorX: p.x, cursorY: p.y, winX, winY, timer: setInterval(dragStep, 16) };
      return;
    }
    if (m?.type === "drag-end") {
      clearInterval(drag?.timer);
      // A panel you've dragged keeps its place until it closes or you tidy up.
      const moved = Object.values(slabs).find((s) => s.win && s.win === drag?.target);
      if (moved) moved.pinned = true;
      drag = null;
      return;
    }
    const safe = fromPage(m);
    if (safe) send(safe);
  });

  // While Astra operates apps: a click-through glow round the screen she's working on, and a hotkey to stop her.
  let controlWin = null;
  /** When she last acted on another app; work panels stay put for a minute after. */
  let lastControlAt = 0;
  const CONTROL_QUIET_MS = 60_000;
  const controlIndicator = (on) => {
    if (!on) return void controlWin?.hide();
    const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (!controlWin || controlWin.isDestroyed()) {
      controlWin = new BrowserWindow({
        ...bounds, frame: false, transparent: true, hasShadow: false, focusable: false, resizable: false, movable: false,
        skipTaskbar: true, show: false, webPreferences: { sandbox: true, contextIsolation: true },
      });
      controlWin.setIgnoreMouseEvents(true);
      controlWin.setAlwaysOnTop(true, "screen-saver");
      controlWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      harden(controlWin);
      controlWin.loadFile(path.join(__dirname, "control.html"));
    }
    controlWin.setBounds(bounds);
    controlWin.showInactive();
  };
  // Control+Option+Escape: stop whatever she's doing, from any app.
  globalShortcut.register("Control+Alt+Escape", () => send({ type: "stop" }));
  app.on("will-quit", () => globalShortcut.unregisterAll());

  readline
    .createInterface({ input: process.stdin })
    .on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type === "control") {
        if (m.on) lastControlAt = Date.now();
        controlIndicator(!!m.on);
      }
      // Quitting folds her away first (she's gone either way within 1.6 s).
      else if (m.type === "quit") {
        foldingToQuit = true;
        void (win.isVisible() ? transform("close") : Promise.resolve()).then(() => app.quit());
      }
      // The sessions panel opens only when asked for (owner "user"); its live updates never reopen it.
      // Remembered, so a reloaded orb page shows coffee mode again.
      else if (m.type === "coffee") {
        lastCoffee = m;
        win.webContents.send("jarvis", m);
      }
      // The sessions and Tallyline panels open only when asked for (owner "user"); live updates never reopen them.
      else if (m.type === "sessions" || m.type === "tallyline") {
        const slab = slabs[m.type];
        if (m.owner === "user") {
          closed.delete(m.type);
          openSlab(m.type, m, "user");
        } else {
          slab.last = m;
          if (slab.win && !slab.win.isDestroyed()) slab.win.webContents.send("jarvis", m);
        }
      }
      // A background run's transcript updates by itself (no owner); a closed one only refreshes the dropdown.
      else if (m.type === "transcript" && m.owner !== "user" && closed.has("transcript")) {
        slabs.transcript.last = m;
        sendPanels();
      }
      // Detail, map and brain come from Astra's show tools (or "show me…"): explicit, so they open even if closed.
      else if (m.type === "detail" || m.type === "graph" || m.type === "brain" || m.type === "transcript") {
        closed.delete(m.type);
        // A background run's transcript ticks constantly (no owner): those updates don't raise it.
        openSlab(m.type, m, m.owner === "user" ? "user" : "astra", m.type !== "transcript" || !!m.owner);
      }
      // Work panels open by themselves when there's something new, unless closed during this request (or asked for).
      else if (m.type === "terminal" || m.type === "git") {
        const slab = slabs[m.type];
        const hasContent = m.type === "terminal" ? m.entries.length > 0 : m.repos.length > 0;
        const owner = m.owner === "user" ? "user" : m.force ? "astra" : "auto";
        // While she's operating another app, a panel popping up covers it and catches her clicks: keep the news
        // (the dropdown can show it) and only refresh a panel that's already open, without raising it.
        if (owner === "auto" && (closed.has(m.type) || Date.now() - lastControlAt < CONTROL_QUIET_MS)) {
          slab.last = m;
          if (slab.win && !slab.win.isDestroyed()) slab.win.webContents.send("jarvis", m);
          sendPanels();
        } else if (slab.win && !slab.win.isDestroyed()) openSlab(m.type, m, owner, owner !== "auto");
        else if (m.force || hasContent) {
          closed.delete(m.type);
          openSlab(m.type, m, owner);
        } else slab.last = m;
      } else if (m.type === "git-diff-result") slabs.git.win?.webContents.send("jarvis", m);
      else if (m.type === "request-done") tidyUp();
      else if (m.type === "activity-reset") {
        requestNo++;
        win.webContents.send("jarvis", m);
      }
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
        // On top, but not focused: focusing made Astra the active app, so the keys she sent next (and Dan's own
        // typing) went to her instead of the app she was working in. Clicking the card still focuses it.
        win.moveTop();
      } else win.webContents.send("jarvis", m);
    })
    // Astra's process closed the pipe: quit, unless a quit fold is already playing (it quits when done).
    .on("close", () => {
      if (!foldingToQuit) app.quit();
    });
});

app.on("window-all-closed", () => app.quit());
