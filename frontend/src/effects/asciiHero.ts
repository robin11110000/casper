/**
 * Renders `text` as a field of monospace-glyph particles that converge into the
 * shape of the text, then gently drift/shimmer and repel away from the pointer.
 * Pure canvas 2D, no libraries. Adapted from the "ASCII hero" technique (sample
 * text pixels on an offscreen canvas, one particle per lit pixel, spring-ease each
 * particle toward its target position).
 */
const GLYPHS = ".:+-=*#@&~<>{}[]|/\\";

interface Particle {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  char: string;
  alpha: number;
  targetAlpha: number;
  isTextPixel: boolean;
  phase: number;
  delay: number;
}

export function mountAsciiHero(canvas: HTMLCanvasElement, text: string): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const isSmall = window.innerWidth <= 600;
  const glyphSet = isSmall ? "01" : GLYPHS;
  const step = isSmall ? 3 : 5;
  const glyphSize = isSmall ? 8 : 11;
  const repelRadius = isSmall ? 60 : 100;
  const repelStrength = isSmall ? 3 : 4;

  const containerWidth = canvas.parentElement?.offsetWidth ?? 600;
  const refFontPx = 100;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `600 ${refFontPx}px "JetBrains Mono", monospace`;
  const refWidth = measure.measureText(text).width || 1;
  const fittedFontPx = Math.max(16, Math.floor(refFontPx * (containerWidth / refWidth) * 0.95));
  const height = Math.max(60, Math.ceil(fittedFontPx * 1.4));

  canvas.style.width = `${containerWidth}px`;
  canvas.style.height = `${height}px`;
  canvas.width = containerWidth * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sample = document.createElement("canvas");
  sample.width = containerWidth;
  sample.height = height;
  const sctx = sample.getContext("2d")!;
  sctx.font = `600 ${fittedFontPx}px "JetBrains Mono", monospace`;
  sctx.fillStyle = "#fff";
  sctx.textBaseline = "middle";
  sctx.fillText(text, 0, height / 2);
  const pixels = sctx.getImageData(0, 0, containerWidth, height);

  const particles: Particle[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < containerWidth; x += step) {
      const idx = (y * containerWidth + x) * 4;
      if (pixels.data[idx + 3] > 100) {
        particles.push({
          x: x + (Math.random() - 0.5) * containerWidth * 0.5,
          y: y + (Math.random() - 0.5) * height * 2.5,
          tx: x,
          ty: y,
          vx: 0,
          vy: 0,
          char: glyphSet[Math.floor(Math.random() * glyphSet.length)],
          alpha: 0,
          targetAlpha: 0.85 + Math.random() * 0.15,
          isTextPixel: true,
          phase: Math.random() * Math.PI * 2,
          delay: (x / containerWidth) * 1.2
        });
      }
    }
  }

  // A handful of ambient stray particles drifting in the background.
  const ambientCount = Math.max(20, Math.floor(particles.length * 0.12));
  for (let i = 0; i < ambientCount; i++) {
    const x = Math.random() * containerWidth;
    const y = Math.random() * height;
    particles.push({
      x,
      y,
      tx: x,
      ty: y,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      char: glyphSet[Math.floor(Math.random() * glyphSet.length)],
      alpha: 0,
      targetAlpha: 0.04 + Math.random() * 0.07,
      isTextPixel: false,
      phase: Math.random() * Math.PI * 2,
      delay: Math.random() * 0.6
    });
  }

  let pointerX = -9999;
  let pointerY = -9999;
  const onMouseMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointerX = e.clientX - rect.left;
    pointerY = e.clientY - rect.top;
  };
  const onMouseLeave = () => {
    pointerX = -9999;
    pointerY = -9999;
  };
  const onTouchMove = (e: TouchEvent) => {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    pointerX = t.clientX - rect.left;
    pointerY = t.clientY - rect.top;
  };
  const onTouchEnd = () => {
    pointerX = -9999;
    pointerY = -9999;
  };
  canvas.addEventListener("mousemove", onMouseMove, { passive: true });
  canvas.addEventListener("mouseleave", onMouseLeave);
  canvas.addEventListener("touchmove", onTouchMove, { passive: true });
  canvas.addEventListener("touchend", onTouchEnd);

  let rafId = 0;
  let running = true;
  let visible = true;
  const start = performance.now();

  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) tick();
    },
    { threshold: 0 }
  );
  intersectionObserver.observe(canvas);

  const onVisibilityChange = () => {
    running = !document.hidden;
    if (running) tick();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  function frame(now: number) {
    const t = (now - start) / 1000;
    ctx!.clearRect(0, 0, containerWidth, height);
    ctx!.fillStyle = accent || "#b0491f";
    ctx!.font = `500 ${glyphSize}px "JetBrains Mono", monospace`;

    for (const p of particles) {
      const elapsed = Math.max(0, t - p.delay);
      if (p.isTextPixel && elapsed < 0.01) {
        ctx!.globalAlpha = 0.02;
        ctx!.fillText(p.char, p.x, p.y);
        continue;
      }

      p.vx += (p.tx - p.x) * 0.04;
      p.vy += (p.ty - p.y) * 0.04;

      const dx = p.x - pointerX;
      const dy = p.y - pointerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < repelRadius && dist > 0) {
        const force = (1 - dist / repelRadius) ** 2 * repelStrength;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }

      p.vx *= 0.88;
      p.vy *= 0.88;
      p.x += p.vx;
      p.y += p.vy;
      p.alpha += (p.targetAlpha - p.alpha) * 0.04;

      if (p.isTextPixel) {
        p.alpha = p.targetAlpha + Math.sin(t * 0.8 + p.phase) * 0.08;
        if (elapsed < 0.8 || Math.random() < 0.0008) {
          p.char = glyphSet[Math.floor(Math.random() * glyphSet.length)];
        }
      } else {
        p.tx += (Math.random() - 0.5) * 0.2;
        p.ty += (Math.random() - 0.5) * 0.2;
        if (p.x < -20) p.x = p.tx = containerWidth + 10;
        if (p.x > containerWidth + 20) p.x = p.tx = -10;
        if (p.y < -20) p.y = p.ty = height + 10;
        if (p.y > height + 20) p.y = p.ty = -10;
        if (Math.random() < 0.003) p.char = glyphSet[Math.floor(Math.random() * glyphSet.length)];
      }

      ctx!.globalAlpha = Math.max(0, p.alpha);
      ctx!.fillText(p.char, p.x, p.y);
    }
    ctx!.globalAlpha = 1;
    rafId = requestAnimationFrame(frame);
  }

  function tick() {
    if (!rafId && running && visible) {
      rafId = requestAnimationFrame(frame);
    }
  }
  tick();

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseleave", onMouseLeave);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
  };
}
