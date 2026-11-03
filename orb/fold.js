// The fold (accordion) button every panel has in its header, next to close: folds the panel to its header and back.
// Shared by all the panels (detail, map, brain, terminal, git, transcript, sessions, Tallyline). A panel's status line
// (#collapse), where it has one, is a second toggle for the same thing. Folding tells the orb's main process
// ("slab-collapse"), which shrinks the window and keeps the layout and the dropdown's "Unfold" in step.
(() => {
  const bridge = window.jarvis;
  const slab = document.querySelector(".slab");
  const button = document.getElementById("fold");
  if (!bridge || !slab || !button) return;
  const status = document.getElementById("collapse");
  const name = button.dataset.panel || "panel";

  const folded = () => slab.classList.contains("collapsed");
  function show(isFolded) {
    button.setAttribute("aria-expanded", String(!isFolded));
    button.setAttribute("aria-label", `${isFolded ? "Unfold" : "Fold"} the ${name}`);
    button.title = isFolded ? "Unfold" : "Fold";
    if (status) {
      status.setAttribute("aria-expanded", String(!isFolded));
      status.title = isFolded ? "Expand" : "Collapse";
    }
  }
  function setFolded(isFolded) {
    slab.classList.toggle("collapsed", isFolded);
    show(isFolded);
    const edge = (slab.querySelector(".shelf") ?? document.getElementById("bar")).getBoundingClientRect().bottom;
    bridge.send({ type: "slab-collapse", collapsed: isFolded, height: Math.ceil(edge + 10) });
  }
  const toggle = () => setFolded(!folded());
  button.addEventListener("click", toggle);
  status?.addEventListener("click", toggle);
  // Unfolded from the orb's dropdown.
  bridge.onMessage((m) => {
    if (m?.type === "slab-expand" && folded()) setFolded(false);
  });
  show(false);
})();
