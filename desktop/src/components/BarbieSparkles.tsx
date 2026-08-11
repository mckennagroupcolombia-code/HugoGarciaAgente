import { useEffect, useRef } from "react";
import { usePanelTheme } from "../stores/panelTheme";

type Sparkle = {
  x: number;
  y: number;
  size: number;
  rot: number;
  spin: number;
  life: number;
  maxLife: number;
  hue: number;
};

/** Brillos suaves para el skin Barbie Agenda (respeta prefers-reduced-motion). */
export default function BarbieSparkles() {
  const skin = usePanelTheme((s) => s.skin);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (skin !== "barbie") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const el = canvas;
    const c = ctx;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    let sparkles: Sparkle[] = [];
    let tick = 0;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.floor(w * dpr);
      el.height = Math.floor(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = reduceMotion ? 12 : Math.min(42, Math.max(22, Math.floor((w * h) / 38000)));
      sparkles = Array.from({ length: n }, () => spawn(true));
    }

    function spawn(anywhere: boolean): Sparkle {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : -8,
        size: 3 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.04,
        life: anywhere ? Math.random() : 0,
        maxLife: 0.55 + Math.random() * 0.9,
        hue: Math.random() < 0.55 ? 330 : Math.random() < 0.5 ? 300 : 45,
      };
    }

    function drawStar(x: number, y: number, size: number, rot: number, alpha: number, hue: number) {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.globalAlpha = alpha;
      c.fillStyle = `hsla(${hue}, 90%, 72%, 1)`;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        c.lineTo(Math.cos(a) * size, Math.sin(a) * size);
        c.lineTo(Math.cos(a + Math.PI / 4) * size * 0.28, Math.sin(a + Math.PI / 4) * size * 0.28);
      }
      c.closePath();
      c.fill();
      c.restore();
    }

    function frame() {
      if (!running) return;
      c.clearRect(0, 0, w, h);
      tick += 1;
      for (let i = 0; i < sparkles.length; i++) {
        const s = sparkles[i];
        if (!reduceMotion) {
          s.life += 0.006 + s.size * 0.0004;
          s.y += 0.18 + s.size * 0.04;
          s.x += Math.sin(tick * 0.02 + i) * 0.15;
          s.rot += s.spin;
        }
        const t = s.life / s.maxLife;
        const alpha = t < 0.15 ? t / 0.15 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 0.85;
        if (alpha > 0.02) drawStar(s.x, s.y, s.size, s.rot, alpha * 0.7, s.hue);
        if (s.life >= s.maxLife || s.y > h + 20) sparkles[i] = spawn(false);
      }
      raf = requestAnimationFrame(frame);
    }

    function onVis() {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (running) {
        raf = requestAnimationFrame(frame);
      }
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    if (reduceMotion) {
      c.clearRect(0, 0, w, h);
      for (const s of sparkles) drawStar(s.x, s.y, s.size, s.rot, 0.35, s.hue);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [skin]);

  if (skin !== "barbie") return null;

  return (
    <canvas
      ref={canvasRef}
      className="mck-barbie-sparkles pointer-events-none fixed inset-0 z-0"
      aria-hidden
    />
  );
}
