/**
 * Decodes an element's text from random characters into its real content over
 * ~600ms, left-to-right, with a cubic ease-out. Locked-in characters stay put;
 * unrevealed ones keep re-randomizing until their turn.
 */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*~+-=.:";

export function scrambleIn(el: HTMLElement, durationMs = 600): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const original = el.textContent ?? "";
  if (!original.length) return;

  const width = el.offsetWidth;
  const height = el.offsetHeight;
  el.style.minWidth = `${width}px`;
  el.style.minHeight = `${height}px`;
  el.style.display = "inline-block";

  const start = performance.now();

  function frame(now: number) {
    const progress = Math.min((now - start) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const revealCount = Math.floor(eased * original.length);

    let out = "";
    for (let i = 0; i < original.length; i++) {
      if (i < revealCount) {
        out += original[i];
      } else if (original[i] === " ") {
        out += " ";
      } else {
        out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
    }
    el.textContent = out;

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      el.textContent = original;
      el.style.minWidth = "";
      el.style.minHeight = "";
      el.style.display = "";
    }
  }
  requestAnimationFrame(frame);
}

/** Applies `scrambleIn` to `el` the first time it scrolls into view. */
export function scrambleOnIntersect(el: HTMLElement, delayMs = 0): () => void {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        setTimeout(() => scrambleIn(el), delayMs);
        observer.disconnect();
      }
    },
    { threshold: 0.4 }
  );
  observer.observe(el);
  return () => observer.disconnect();
}
