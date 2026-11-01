// The 3D teardown map. Bundled by esbuild into orb/build/graph.js (npm run build:orb) because the page can't
// resolve bare imports and its CSP allows only local scripts.
import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";
import * as THREE from "three";

const COLOURS = {
  app: "#fff1c9",
  module: "#46e0d6",
  framework: "#6f9bff",
  feature: "#ecbc52",
  data: "#b98cff",
  service: "#ff8a7a",
  other: "#a9c2d6",
};
const GROUP_NAMES = {
  app: "App",
  module: "Module",
  framework: "Framework",
  feature: "Feature",
  data: "Data",
  service: "Service",
  other: "Other",
};

const bridge = window.jarvis ?? { onMessage() {}, send() {} };
const stage = document.getElementById("graph");
const title = document.getElementById("title");
const stamp = document.getElementById("stamp");
const legend = document.getElementById("legend");
const info = document.getElementById("info");
const infoTitle = document.getElementById("info-title");
const infoGroup = document.getElementById("info-group");
const infoDetail = document.getElementById("info-detail");
const infoLinks = document.getElementById("info-links");
const outline = document.getElementById("outline");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// Labels come from analysed apps and sites; the tooltip is HTML, so escape them.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
const colourOf = (n) => COLOURS[n.group] ?? COLOURS.other;

let graph = null;
let data = { nodes: [], links: [] };

function neighbours(node) {
  return data.links
    .filter((l) => l.source === node || l.target === node)
    .map((l) => ({ other: l.source === node ? l.target : l.source, link: l, outgoing: l.source === node }));
}

function select(node) {
  info.hidden = false;
  infoTitle.textContent = node.label;
  infoGroup.textContent = GROUP_NAMES[node.group] ?? "Other";
  infoGroup.style.color = colourOf(node);
  infoDetail.textContent = node.detail || "No detail recorded.";
  infoLinks.replaceChildren(
    ...neighbours(node).map(({ other, link, outgoing }) => {
      const li = document.createElement("li");
      const verb = link.label || (outgoing ? "→" : "←");
      li.textContent = `${outgoing ? verb : `${verb} from`} ${other.label}${link.inferred ? " (inferred)" : ""}`;
      return li;
    }),
  );
  const d = 70;
  const r = 1 + d / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
  graph.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, reducedMotion ? 0 : 900);
  graph.controls().autoRotate = false;
}

/**
 * Icons for each kind of tech, in the orb's line-art: a dark lapis disc ringed in the group's colour, with the symbol
 * drawn on it. Drawn once per group onto a canvas; used as 3D sprites and in the legend.
 */
const SYMBOLS = {
  app(g) {
    // sun disc with rays
    g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.beginPath(); g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); g.lineTo(Math.cos(a) * 24, Math.sin(a) * 24); g.stroke();
    }
  },
  module(g) {
    // cube
    g.beginPath();
    g.moveTo(0, -18); g.lineTo(16, -9); g.lineTo(16, 10); g.lineTo(0, 19); g.lineTo(-16, 10); g.lineTo(-16, -9); g.closePath();
    g.moveTo(-16, -9); g.lineTo(0, 0); g.lineTo(16, -9); g.moveTo(0, 0); g.lineTo(0, 19);
    g.stroke();
  },
  framework(g) {
    // stacked layers
    for (const dy of [-10, 0, 10]) {
      g.beginPath(); g.moveTo(-18, dy); g.lineTo(0, dy - 8); g.lineTo(18, dy); g.lineTo(0, dy + 8); g.closePath(); g.stroke();
    }
  },
  feature(g) {
    // four-point spark
    g.beginPath();
    g.moveTo(0, -20); g.quadraticCurveTo(3, -3, 20, 0); g.quadraticCurveTo(3, 3, 0, 20);
    g.quadraticCurveTo(-3, 3, -20, 0); g.quadraticCurveTo(-3, -3, 0, -20); g.closePath();
    g.stroke();
  },
  data(g) {
    // database cylinder
    g.beginPath(); g.ellipse(0, -12, 15, 6, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(-15, -12); g.lineTo(-15, 12); g.ellipse(0, 12, 15, 6, 0, Math.PI, 0, true); g.lineTo(15, -12); g.stroke();
    g.beginPath(); g.ellipse(0, 0, 15, 6, 0, 0, Math.PI); g.stroke();
  },
  service(g) {
    // cloud
    g.beginPath();
    g.moveTo(-14, 10); g.arc(-12, 2, 8, Math.PI / 2, Math.PI * 1.5); g.arc(-2, -6, 10, Math.PI, Math.PI * 1.85);
    g.arc(11, 0, 9, -Math.PI / 2, Math.PI / 2); g.lineTo(-12, 10);
    g.stroke();
  },
  other(g) {
    g.beginPath(); g.moveTo(0, -14); g.lineTo(14, 0); g.lineTo(0, 14); g.lineTo(-14, 0); g.closePath(); g.stroke();
  },
};

const iconCache = new Map();
/** A 128 px canvas with the group's icon. */
function iconCanvas(group) {
  if (iconCache.has(group)) return iconCache.get(group);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const colour = COLOURS[group] ?? COLOURS.other;
  g.translate(64, 64);
  const disc = g.createRadialGradient(0, -10, 6, 0, 0, 52);
  disc.addColorStop(0, "rgba(40, 72, 150, 0.95)");
  disc.addColorStop(1, "rgba(6, 12, 34, 0.95)");
  g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.fillStyle = disc; g.fill();
  g.shadowColor = colour; g.shadowBlur = 14;
  g.lineWidth = 4; g.strokeStyle = colour;
  g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 6;
  g.scale(1.45, 1.45);
  g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = group === "app" ? "#ffe9b0" : colour;
  g.fillStyle = g.strokeStyle;
  (SYMBOLS[group] ?? SYMBOLS.other)(g);
  iconCache.set(group, c);
  return c;
}

const textureCache = new Map();
function iconTexture(group) {
  if (!textureCache.has(group)) {
    const t = new THREE.CanvasTexture(iconCanvas(group));
    t.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(group, t);
  }
  return textureCache.get(group);
}

const iconSize = (n) => (n.group === "app" ? 22 : n.group === "feature" ? 9 : 12);

function renderLegend() {
  const groups = [...new Set(data.nodes.map((n) => n.group))];
  legend.replaceChildren(
    ...groups.map((g) => {
      const li = document.createElement("li");
      const icon = document.createElement("canvas");
      icon.width = icon.height = 32;
      icon.className = "icon";
      icon.setAttribute("aria-hidden", "true");
      icon.getContext("2d").drawImage(iconCanvas(g), 0, 0, 32, 32);
      li.append(icon, GROUP_NAMES[g] ?? g);
      return li;
    }),
  );
}

/** The same map as text, for screen readers (the WebGL canvas is invisible to them). */
function renderOutline() {
  outline.replaceChildren(
    ...data.nodes.map((n) => {
      const li = document.createElement("li");
      const links = neighbours(n)
        .filter((x) => x.outgoing)
        .map((x) => `${x.link.label || "links to"} ${x.other.label}`);
      li.textContent = `${n.label} (${GROUP_NAMES[n.group] ?? "Other"})${links.length ? `: ${links.join("; ")}` : ""}`;
      return li;
    }),
  );
}

function build() {
  graph = ForceGraph3D({ controlType: "orbit" })(stage)
    .backgroundColor("rgba(0,0,0,0)")
    .showNavInfo(false)
    .nodeRelSize(4)
    .nodeVal((n) => (n.group === "app" ? 14 : n.group === "feature" ? 3 : 4))
    .nodeColor(colourOf)
    .nodeOpacity(0.95)
    .nodeResolution(16)
    .nodeLabel((n) => `<b>${escapeHtml(n.label)}</b><br><span>${escapeHtml(GROUP_NAMES[n.group] ?? "Other")}</span>`)
    // Each node is its tech-type icon (a sprite that always faces you) with its label underneath.
    .nodeThreeObjectExtend(false)
    .nodeThreeObject((n) => {
      const group = new THREE.Group();
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(n.group), transparent: true, depthWrite: false }));
      const size = iconSize(n);
      icon.scale.set(size, size, 1);
      group.add(icon);
      const text = new SpriteText(n.label);
      text.color = "#eaf7ff";
      text.fontFace = "Avenir Next, -apple-system, sans-serif";
      text.textHeight = n.group === "app" ? 8 : 4.5;
      text.position.y = -(size / 2 + text.textHeight / 2 + 2);
      group.add(text);
      return group;
    })
    .linkColor((l) => (l.inferred ? "rgba(236,188,82,0.45)" : "rgba(70,224,214,0.65)"))
    .linkOpacity(0.7)
    .linkWidth((l) => (l.inferred ? 0 : 0.5))
    .linkDirectionalParticles((l) => (l.inferred || reducedMotion ? 0 : 2))
    .linkDirectionalParticleWidth(1.3)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor(() => "#ecbc52")
    .onNodeClick(select)
    .onBackgroundClick(() => (info.hidden = true));
  const controls = graph.controls();
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.7;
  const fit = () => graph.width(stage.clientWidth).height(stage.clientHeight);
  new ResizeObserver(fit).observe(stage);
  fit();
}

bridge.onMessage((m) => {
  if (m.type !== "graph") return;
  title.textContent = m.title;
  document.title = `Astra · ${m.title}`;
  stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  data = {
    nodes: m.graph.nodes.map((n) => ({ ...n })),
    links: m.graph.edges.map((e) => ({ source: e.source, target: e.target, label: e.label, inferred: !!e.inferred })),
  };
  if (!graph) build();
  info.hidden = true;
  graph.graphData(data);
  graph.controls().autoRotate = !reducedMotion;
  // graphData swaps ids for node objects on links once the layout starts; render text views after that.
  requestAnimationFrame(() => {
    renderLegend();
    renderOutline();
  });
  setTimeout(() => graph.zoomToFit(reducedMotion ? 0 : 800, 40), 1500);
});

/** Moves the camera towards (factor < 1) or away from (> 1) what it's looking at. */
function zoomBy(factor) {
  if (!graph) return;
  const cam = graph.camera().position;
  const target = graph.controls().target;
  graph.controls().autoRotate = false;
  graph.cameraPosition(
    { x: target.x + (cam.x - target.x) * factor, y: target.y + (cam.y - target.y) * factor, z: target.z + (cam.z - target.z) * factor },
    target,
    reducedMotion ? 0 : 300,
  );
}
const fit = () => graph?.zoomToFit(reducedMotion ? 0 : 600, 40);
document.getElementById("zoom-in").addEventListener("click", () => zoomBy(0.7));
document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1.4));
document.getElementById("zoom-fit").addEventListener("click", fit);

const close = () => bridge.send({ type: "panel-close" });
document.getElementById("close").addEventListener("click", close);
document.getElementById("info-close").addEventListener("click", () => (info.hidden = true));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") (info.hidden ? close : () => (info.hidden = true))();
  else if (e.key === "+" || e.key === "=") zoomBy(0.7);
  else if (e.key === "-" || e.key === "_") zoomBy(1.4);
  else if (e.key === "0") fit();
});

const bar = document.getElementById("bar");
bar.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  bar.setPointerCapture(e.pointerId);
  bridge.send({ type: "drag-start" });
});
const endDrag = () => bridge.send({ type: "drag-end" });
bar.addEventListener("pointerup", endDrag);
bar.addEventListener("lostpointercapture", endDrag);
