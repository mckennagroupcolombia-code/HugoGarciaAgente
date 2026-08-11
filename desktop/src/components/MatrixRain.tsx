import { useEffect, useRef } from "react";
import { usePanelTheme } from "../stores/panelTheme";

const DIGITS = "0123456789";

function digitAt(seed: number): string {
  return DIGITS[((seed % 10) + 10) % 10];
}

function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Lluvia Matrix: solo dígitos, una celda por símbolo (sin solapes). */
export default function MatrixRain() {
  const skin = usePanelTheme((s) => s.skin);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (skin !== "matrix") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const el = canvas;
    const c = ctx;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fontPx = window.innerWidth < 640 ? 12 : 15;

    let raf = 0;
    let running = true;
    let cols = 0;
    let rows = 0;
    let cell = fontPx + 4;
    let drops: number[] = [];
    let speeds: number[] = [];
    let trails: number[] = [];
    let seeds: number[] = [];
    let active: boolean[] = [];

    function applyFont() {
      c.font = `600 ${fontPx}px "Share Tech Mono", "JetBrains Mono", ui-monospace, monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
    }

    function spawn(i: number, scatter: boolean) {
      if (Math.random() < 0.45) {
        active[i] = false;
        trails[i] = 0;
        speeds[i] = 1;
        drops[i] = scatter ? ((Math.random() * rows) | 0) - rows : -((Math.random() * rows) | 0) - 8;
        return;
      }
      active[i] = true;
      trails[i] = 6 + ((Math.random() * 5) | 0);
      speeds[i] = 2 + ((Math.random() * 3) | 0);
      seeds[i] = hash32((seeds[i] || i * 9973) + 101 + ((Math.random() * 999) | 0));
      drops[i] = scatter
        ? ((Math.random() * (rows + trails[i] + 20)) | 0) - trails[i] - 8
        : -((Math.random() * rows) | 0) - 1;
    }

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      el.width = Math.floor(w * dpr);
      el.height = Math.floor(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      applyFont();
      const glyphW = Math.ceil(c.measureText("0").width);
      cell = Math.max(glyphW + 8, fontPx + 6);
      cols = Math.max(4, Math.floor(w / cell));
      rows = Math.max(4, Math.floor(h / cell));
      drops = new Array(cols);
      speeds = new Array(cols);
      trails = new Array(cols);
      seeds = new Array(cols);
      active = new Array(cols);
      for (let i = 0; i < cols; i++) spawn(i, true);
      c.fillStyle = "#020802";
      c.fillRect(0, 0, w, h);
    }

    function paintDigit(col: number, row: number, seed: number, alpha: number, t: number) {
      const x = col * cell + cell / 2;
      const y = row * cell + cell / 2;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
      if (t === 0) {
        c.shadowColor = "#00ff41";
        c.shadowBlur = 16;
        c.fillStyle = `rgba(236, 255, 236, ${alpha})`;
      } else if (t === 1) {
        c.shadowColor = "#00ff41";
        c.shadowBlur = 8;
        c.fillStyle = `rgba(120, 255, 150, ${alpha})`;
      } else {
        c.shadowBlur = 0;
        c.shadowColor = "transparent";
        c.fillStyle = `rgba(0, 230, 70, ${alpha})`;
      }
      c.fillText(digitAt(seed), x, y);
      c.shadowBlur = 0;
      c.shadowColor = "transparent";
    }

    function frame() {
      if (!running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      c.fillStyle = "rgba(2, 8, 2, 0.12)";
      c.fillRect(0, 0, w, h);
      applyFont();

      for (let i = 0; i < cols; i++) {
        if (!active[i]) {
          drops[i] += 1;
          if (drops[i] >= 0) spawn(i, false);
          continue;
        }
        const head = drops[i];
        const trail = trails[i];
        for (let t = 0; t < trail; t++) {
          const row = head - t;
          if (row < 0 || row >= rows) continue;
          const fade = Math.pow(1 - t / trail, 1.75);
          const alpha = t === 0 ? 1 : Math.max(0.08, fade * 0.88);
          paintDigit(i, row, hash32(seeds[i] + row * 7919), alpha, t);
        }
        drops[i] += speeds[i];
        if (drops[i] > rows + trail) spawn(i, false);
      }
      raf = requestAnimationFrame(frame);
    }

    resize();
    if (reduceMotion) {
      c.fillStyle = "#020802";
      c.fillRect(0, 0, window.innerWidth, window.innerHeight);
      applyFont();
      for (let i = 0; i < cols; i++) {
        const row = ((drops[i] % rows) + rows) % rows;
        paintDigit(i, row, seeds[i], 0.5, 2);
      }
      return undefined;
    }

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
        return;
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [skin]);

  if (skin !== "matrix") return null;

  return (
    <canvas
      ref={canvasRef}
      className="mck-matrix-rain pointer-events-none fixed inset-0 z-0"
      aria-hidden
    />
  );
}
