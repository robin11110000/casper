/**
 * Full-viewport canvas overlay that sparks monospace-glyph particles at the
 * pointer position on scroll/wheel/touch, with simple gravity+friction physics.
 * Pure canvas 2D; the animation loop only runs while particles are alive.
 */
const GLYPHS = ".:+-=*#@$&~<>[]|/\\";

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  char: string;
  life: number;
  maxLife: number;
  size: number;
}

export function mountScrollSpark(canvas: HTMLCanvasElement): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

  function resize() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const sparks: Spark[] = [];
  let pointerX = -1;
  let pointerY = -1;
  let lastSpawn = 0;
  let running = false;
  let rafId = 0;
  let lastFrameTime = 0;

  function spawn(x: number, y: number, deltaY: number) {
    const magnitude = Math.min(Math.abs(deltaY), 200);
    const direction = deltaY > 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      sparks.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 60,
        vy: direction * (60 + magnitude * 0.8 + Math.random() * 40),
        char: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        life: 0.6 + Math.random() * 0.2,
        maxLife: 0.6 + Math.random() * 0.2,
        size: 7 + Math.random() * 4
      });
    }
    if (!running) {
      running = true;
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function frame(now: number) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);

    let alive = 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      alive++;
      s.vy += 20 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.98;
      s.vy *= 0.98;

      const lifeRatio = s.life / s.maxLife;
      ctx!.globalAlpha = lifeRatio * lifeRatio;
      ctx!.fillStyle = accent || "#b0491f";
      ctx!.font = `500 ${s.size}px "JetBrains Mono", monospace`;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.fillText(s.char, s.x, s.y);
    }
    ctx!.globalAlpha = 1;

    if (alive > 0) {
      rafId = requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  };
  const onMouseLeave = () => {
    pointerX = -1;
    pointerY = -1;
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    pointerX = t.clientX;
    pointerY = t.clientY;
  };
  const onTouchEnd = () => {
    pointerX = -1;
    pointerY = -1;
  };

  let lastScrollY = window.scrollY;
  const onScroll = () => {
    if (pointerX < 0) return;
    const delta = window.scrollY - lastScrollY;
    lastScrollY = window.scrollY;
    if (Math.abs(delta) < 2) return;
    const now = performance.now();
    if (now - lastSpawn < 30) return;
    lastSpawn = now;
    spawn(pointerX, pointerY, delta);
  };

  const onWheel = (e: WheelEvent) => {
    if (pointerX < 0) return;
    const delta = e.deltaY;
    requestAnimationFrame(() => {
      const atTop = window.scrollY <= 0 && delta < 0;
      const atBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1 &&
        delta > 0;
      if (atTop || atBottom) return;
      const now = performance.now();
      if (now - lastSpawn < 30) return;
      lastSpawn = now;
      spawn(pointerX, pointerY, delta);
    });
  };

  window.addEventListener("mousemove", onMouseMove, { passive: true });
  document.addEventListener("mouseleave", onMouseLeave);
  window.addEventListener("touchstart", onTouchMove, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });
  window.addEventListener("touchend", onTouchEnd);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("resize", resize);

  const onBlur = () => {
    pointerX = -1;
    pointerY = -1;
  };
  const onVisibilityChange = () => {
    if (document.hidden) onBlur();
  };
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseleave", onMouseLeave);
    window.removeEventListener("touchstart", onTouchMove);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("resize", resize);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    sparks.length = 0;
  };
}
