/** Efectos sutiles de fantasía al pulsar botones (ripple + chispas). */
export function initFantasyPress(): () => void {
  const root = document.getElementById("root");
  if (!root) return () => {};

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function findButton(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest(
      'button:not(:disabled):not(.mck-btn-no-fx):not(.sr-only), [role="button"]:not([aria-disabled="true"]):not(.mck-btn-no-fx)',
    );
    if (!(el instanceof HTMLElement)) return null;
    if (el.closest(".quest-sticky-drag-handle, .quest-sticky-resize-handle, .paso-checklist-input")) {
      return null;
    }
    return el;
  }

  function coords(el: HTMLElement, e: PointerEvent): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function spawnRipple(el: HTMLElement, x: number, y: number) {
    const ripple = document.createElement("span");
    ripple.className = "mck-fantasy-ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    el.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  }

  function spawnSparks(el: HTMLElement, x: number, y: number) {
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const spark = document.createElement("span");
      spark.className = "mck-fantasy-spark";
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const dist = 10 + Math.random() * 14;
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      el.appendChild(spark);
      spark.addEventListener("animationend", () => spark.remove(), { once: true });
    }
  }

  function flashGlow(el: HTMLElement) {
    el.classList.remove("mck-fantasy-flash");
    void el.offsetWidth;
    el.classList.add("mck-fantasy-flash");
    el.addEventListener("animationend", () => el.classList.remove("mck-fantasy-flash"), { once: true });
  }

  function onPointerDown(e: PointerEvent) {
    if (reduced() || e.button > 0) return;
    const el = findButton(e.target);
    if (!el) return;
    const { x, y } = coords(el, e);
    spawnRipple(el, x, y);
    spawnSparks(el, x, y);
    flashGlow(el);
  }

  root.addEventListener("pointerdown", onPointerDown, { passive: true });
  return () => root.removeEventListener("pointerdown", onPointerDown);
}
