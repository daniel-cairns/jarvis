// Her uploads and downloads, drawn whole on the beam layer (beam.html): each is one piece from her core to the top of
// the screen, so there's no join at the edge of her box. Upload: five beams rise from just above her core, drawing
// together as they climb, with pulses racing up them. Download: a gold pyramid floats down from the top of the screen
// to rest just above her ring, its tractor beam coming down into her core, rings travelling down it. While Anubis is up, the beams fade out behind
// him, so he stands in front of them. Coordinates arrive in this layer's own points.
(() => {
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d");
  const bridge = window.jarvis ?? { onMessage() {} };
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GOLD = [236, 188, 82];
  const BEAM = [120, 255, 236];
  const rgba = ([r, g, b], a) => `rgba(${r | 0},${g | 0},${b | 0},${Math.max(0, Math.min(1, a))})`;

  // { dir, x, top, coreTop, guard }: her core's x, the top of her drawing frame, the top of her core, Anubis up.
  let sky = null;
  let amt = 0;
  let guardAmt = 0;
  let dir = null;
  /** When the pyramid set off from the top of the screen (seconds), and how long its float down takes. */
  let descentStart = 0;
  const DESCENT_S = 2.4;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  addEventListener("resize", resize);
  resize();

  /** Upload: five beams from her core to the top of the screen, drawing together as they climb, pulses racing up. */
  function upload(x, core, t, a) {
    const beams = [-12, -6, 0, 6, 12];
    const speed = still ? 0.12 : 0.6;
    const at = (dx, y) => x + dx * (0.08 + 0.92 * (y / core));
    const emitter = ctx.createRadialGradient(x, core, 0, x, core, 24);
    emitter.addColorStop(0, rgba([255, 255, 255], 0.8 * a));
    emitter.addColorStop(1, rgba(BEAM, 0));
    ctx.fillStyle = emitter;
    ctx.fillRect(x - 24, core - 24, 48, 48);
    beams.forEach((dx, i) => {
      const centre = dx === 0;
      const fade = ctx.createLinearGradient(0, core, 0, 0);
      fade.addColorStop(0, rgba(BEAM, (centre ? 0.5 : 0.28) * a));
      fade.addColorStop(1, rgba(BEAM, 0.05 * a));
      ctx.beginPath();
      ctx.moveTo(at(dx, core), core);
      ctx.lineTo(at(dx, 0), 0);
      ctx.strokeStyle = fade;
      ctx.lineWidth = centre ? 2 : 1;
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const p = (t * speed + k / 5 + i * 0.13) % 1;
        const y = core * (1 - p);
        const len = 12 + 16 * (1 - p);
        const g = ctx.createLinearGradient(0, y, 0, y + len);
        g.addColorStop(0, rgba([255, 255, 255], a * (1 - p * 0.8)));
        g.addColorStop(1, rgba(BEAM, 0));
        ctx.beginPath();
        ctx.moveTo(at(dx, y), y);
        ctx.lineTo(at(dx, Math.min(core, y + len)), Math.min(core, y + len));
        ctx.strokeStyle = g;
        ctx.lineWidth = centre ? 3 : 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    });
  }

  /**
   * Download: the gold pyramid floats down from the top of the screen to just above her ring (where it always came to
   * rest), turning, bobbing gently once it's there, its tractor beam coming down into her core. As the download ends it
   * lifts away and fades.
   */
  function download(x, frameTop, core, t, a) {
    const s = 22;
    const h = 26;
    const rest = frameTop + 28; // its old resting place, just above her ring
    const start = 30; // the top of the screen
    const p = still ? 1 : Math.min(1, (t - descentStart) / DESCENT_S);
    const ease = 1 - (1 - p) ** 3;
    const bob = still || p < 1 ? 0 : Math.sin(t * 1.3) * 1.5;
    const baseY = start + (rest - start) * ease + bob - (1 - a) * 30;
    const coreHalf = 24; // the beam narrows into her core
    const spin = t * (still ? 0.15 : 0.8);
    const corners = [0, 1, 2, 3].map((i) => {
      const ang = spin + (i * Math.PI) / 2;
      return { x: x + Math.cos(ang) * s, y: baseY + Math.sin(ang) * s * 0.28, z: Math.sin(ang) };
    });
    const apex = { x, y: baseY - h };

    const beam = ctx.createLinearGradient(0, baseY, 0, core);
    beam.addColorStop(0, rgba(BEAM, 0.32 * a));
    beam.addColorStop(1, rgba(BEAM, 0.1 * a));
    ctx.beginPath();
    ctx.moveTo(x - s * 0.9, baseY + 3);
    ctx.lineTo(x + s * 0.9, baseY + 3);
    ctx.lineTo(x + coreHalf, core);
    ctx.lineTo(x - coreHalf, core);
    ctx.closePath();
    ctx.fillStyle = beam;
    ctx.fill();
    const rings = Math.max(3, Math.round((core - baseY) / 110));
    for (let k = 0; k < rings; k++) {
      const p = (t * (still ? 0.08 : 0.35) + k / rings) % 1;
      const y = baseY + 3 + (core - baseY - 3) * p;
      const w = s * 0.9 + (coreHalf - s * 0.9) * p;
      ctx.beginPath();
      ctx.ellipse(x, y, w, 2.4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba([255, 255, 255], 0.55 * a * Math.sin(p * Math.PI));
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const faces = [0, 1, 2, 3]
      .map((i) => ({ a: corners[i], b: corners[(i + 1) % 4], depth: (corners[i].z + corners[(i + 1) % 4].z) / 2 }))
      .sort((p, q) => q.depth - p.depth);
    for (const f of faces) {
      const light = f.depth < 0 ? 0.55 + 0.45 * -f.depth : 0.25;
      ctx.beginPath();
      ctx.moveTo(f.a.x, f.a.y);
      ctx.lineTo(f.b.x, f.b.y);
      ctx.lineTo(apex.x, apex.y);
      ctx.closePath();
      ctx.fillStyle = rgba(GOLD.map((v) => v * light), 0.92 * a);
      ctx.fill();
      ctx.strokeStyle = rgba([255, 232, 170], 0.8 * a);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    const capstone = ctx.createRadialGradient(apex.x, apex.y, 0, apex.x, apex.y, 10);
    capstone.addColorStop(0, rgba([255, 255, 255], 0.95 * a));
    capstone.addColorStop(1, rgba(BEAM, 0));
    ctx.fillStyle = capstone;
    ctx.fillRect(apex.x - 10, apex.y - 10, 20, 20);
  }

  /** While Anubis is up, wipe the beams softly where he stands (head and shoulders, above her core), so he's in front. */
  function behindAnubis(x, top, a) {
    const cy = top + 52;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.translate(x, cy);
    ctx.scale(1.25, 1);
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 62);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.7, `rgba(0,0,0,${a * 0.85})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-62, -62, 124, 124);
    ctx.restore();
  }

  function frame(now) {
    const t = now / 1000;
    amt += ((sky?.dir ? 1 : 0) - amt) * (still ? 1 : 0.06);
    guardAmt += ((sky?.guard ? 1 : 0) - guardAmt) * (still ? 1 : 0.08);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (dir && amt > 0.01 && sky) {
      if (dir === "up") upload(sky.x, sky.coreTop, t, amt);
      else download(sky.x, sky.top, sky.coreTop, t, amt);
      if (guardAmt > 0.01) behindAnubis(sky.x, sky.top, guardAmt);
    }
    if (sky?.dir || amt > 0.01) requestAnimationFrame(frame);
  }

  bridge.onMessage((m) => {
    if (m.type !== "beam") return;
    const was = sky?.dir;
    sky = m.sky && m.sky.dir ? m.sky : sky ? { ...sky, dir: null, guard: m.sky?.guard ?? sky.guard } : null;
    if (sky?.dir) dir = sky.dir;
    // A new download: the pyramid sets off from the top of the screen.
    if (sky?.dir === "down" && was !== "down") descentStart = performance.now() / 1000;
    if (sky?.dir && !was) requestAnimationFrame(frame);
  });
})();
