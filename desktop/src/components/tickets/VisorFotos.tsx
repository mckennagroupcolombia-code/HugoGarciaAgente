import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./visorFotos.css";

/** Una foto para el visor: la dirección y un pie opcional (quién la mandó, cuándo). */
export interface FotoVisor {
  src: string;
  pie?: string;
}

/**
 * Visor de fotos dentro de la app (27-sep-2026). Antes la foto se abría con `target="_blank"`
 * y en la APK / modo instalado no pasaba nada al tocarla: Stella no podía ver lo que le
 * mandaban. Aquí se ve a pantalla completa y se pasa a la foto anterior o la siguiente del
 * chat con las flechas de los lados, el teclado (← →) o deslizando el dedo (8-oct-2026).
 * Va en un portal: dentro de la burbuja flotante un `fixed` quedaría encerrado en su caja.
 * Los botones no llevan `position` propia (index.css fuerza `relative` en todo `button`).
 */
export default function VisorFotos({
  fotos, inicio, onCerrar,
}: { fotos: FotoVisor[]; inicio: number; onCerrar: () => void }) {
  const [i, setI] = useState(inicio);
  const toque = useRef<{ x: number; y: number } | null>(null);
  const foto = fotos[i];
  const hayAntes = i > 0;
  const hayDespues = i < fotos.length - 1;
  const antes = () => setI((n) => Math.max(0, n - 1));
  const despues = () => setI((n) => Math.min(fotos.length - 1, n + 1));

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
      if (e.key === "ArrowRight") setI((n) => Math.min(fotos.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fotos.length, onCerrar]);

  if (!foto) return null;
  return createPortal(
    <div className="vf-visor" role="dialog" aria-modal="true" onClick={onCerrar}>
      <div className="vf-barra" onClick={(e) => e.stopPropagation()}>
        <p className="vf-titulo">
          {fotos.length > 1 ? `Foto ${i + 1} de ${fotos.length}` : "Foto"}
          {foto.pie ? ` · ${foto.pie}` : ""}
        </p>
        <a href={foto.src} download className="vf-boton">Descargar</a>
        <button type="button" onClick={onCerrar} className="vf-boton" aria-label="Cerrar">✕ Cerrar</button>
      </div>
      <div className="vf-escena"
        onTouchStart={(e) => {
          if (e.touches.length === 1) toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          else toque.current = null; // dos dedos = zoom, no pasar de foto
        }}
        onTouchEnd={(e) => {
          const t = toque.current;
          toque.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          if (dx < 0) despues(); else antes();
        }}>
        <img key={foto.src} src={foto.src} alt={foto.pie ?? "Foto adjunta"} onClick={(e) => e.stopPropagation()} />
        {fotos.length > 1 && (
          <>
            <button type="button" className="vf-flecha vf-izq" disabled={!hayAntes} aria-label="Foto anterior"
              onClick={(e) => { e.stopPropagation(); antes(); }}>‹</button>
            <button type="button" className="vf-flecha vf-der" disabled={!hayDespues} aria-label="Foto siguiente"
              onClick={(e) => { e.stopPropagation(); despues(); }}>›</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
