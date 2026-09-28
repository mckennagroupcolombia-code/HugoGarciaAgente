import { useEffect, useState } from "react";

/** Una foto para el visor: la dirección y un pie opcional (quién la mandó, cuándo). */
export interface FotoVisor {
  src: string;
  pie?: string;
}

/**
 * Visor de fotos dentro de la app (27-sep-2026). Antes la foto se abría con `target="_blank"`
 * y en la APK / modo instalado no pasaba nada al tocarla: Stella no podía ver lo que le
 * mandaban. Aquí se ve a pantalla completa, con flechas para pasar entre las fotos del hilo.
 * Los botones no llevan `position` propia (index.css fuerza `relative` en todo `button`).
 */
export default function VisorFotos({
  fotos, inicio, onCerrar,
}: { fotos: FotoVisor[]; inicio: number; onCerrar: () => void }) {
  const [i, setI] = useState(inicio);
  const foto = fotos[i];

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
  return (
    <div className="hp-visor" role="dialog" aria-modal="true" onClick={onCerrar}>
      <div className="flex items-center gap-2 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold">
          {fotos.length > 1 ? `Foto ${i + 1} de ${fotos.length}` : "Foto"}
          {foto.pie ? ` · ${foto.pie}` : ""}
        </p>
        <a href={foto.src} download className="hp-boton-sm">Descargar</a>
        <button type="button" onClick={onCerrar} className="hp-boton-sm" aria-label="Cerrar">✕ Cerrar</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <img src={foto.src} alt={foto.pie ?? "Foto adjunta"} onClick={(e) => e.stopPropagation()} />
      </div>
      {fotos.length > 1 && (
        <div className="flex items-center justify-center gap-4 p-3" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="hp-boton blanco" disabled={i === 0} onClick={() => setI(i - 1)}>◀</button>
          <button type="button" className="hp-boton blanco" disabled={i === fotos.length - 1} onClick={() => setI(i + 1)}>▶</button>
        </div>
      )}
    </div>
  );
}
