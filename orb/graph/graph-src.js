// The 3D teardown map. Bundled by esbuild into orb/build/graph.js (npm run build:orb) because the page can't
// resolve bare imports and its CSP allows only local scripts.
import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";

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

function renderLegend() {
  const groups = [...new Set(data.nodes.map((n) => n.group))];
  legend.replaceChildren(
    ...groups.map((g) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = COLOURS[g] ?? COLOURS.other;
      li.append(dot, GROUP_NAMES[g] ?? g);
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
    .nodeThreeObjectExtend(true)
    .nodeThreeObject((n) => {
      const text = new SpriteText(n.label);
      text.color = "#eaf7ff";
      text.fontFace = "Avenir Next, -apple-system, sans-serif";
      text.textHeight = n.group === "app" ? 8 : 4.5;
      text.position.y = -(Math.cbrt(n.group === "app" ? 14 : 4) * 4 + 4);
      return text;
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

const close = () => bridge.send({ type: "panel-close" });
document.getElementById("close").addEventListener("click", close);
document.getElementById("info-close").addEventListener("click", () => (info.hidden = true));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") (info.hidden ? close : () => (info.hidden = true))();
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
