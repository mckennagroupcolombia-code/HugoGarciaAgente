/**
 * «Atender» (tecla Q): lo que necesita tu atención, en un solo menú, para no tener que recorrer el
 * barrio buscando. Arriba lo que es para ti (solicitudes que te hicieron, chats sin responder,
 * retos y tu turno en el ajedrez), luego lo detenido en los módulos que puedes abrir (lo mismo que
 * el «Detenido ahora» del Mapa: mapa_app.urgencias_para) y lo que está pasando en el barrio
 * (clientes en la tienda, paquetes por alistar).
 *
 * Cada renglón tiene «Atender» (abre el módulo ahí mismo, dentro del juego, y tu personaje va a su
 * objeto) e «Ir» (solo caminar hasta allá, para verlo en el barrio).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { IconoModulo } from "./VentanaModulo";

export interface ItemAtencion {
  clave: string;
  grupo: "Para ti" | "Detenido en tus módulos" | "En el barrio";
  titulo: string;
  detalle: string;
  /** Urgente (rojo) o no (ámbar). */
  alta?: boolean;
  /** El color de su etapa del Mapa (barrio.colorModulo) e ícono del objeto en el barrio. */
  color?: string;
  icono?: string | null;
  atender: () => void;
  ir?: () => void;
}

const GRUPOS: ItemAtencion["grupo"][] = ["Para ti", "Detenido en tus módulos", "En el barrio"];

export function MenuAtencion({ items, onCerrar }: { items: ItemAtencion[]; onCerrar: () => void }) {
  const [cursor, setCursor] = useState(0);
  const lista = useRef<HTMLDivElement>(null);
  const orden = useMemo(() => GRUPOS.flatMap((g) => items.filter((i) => i.grupo === g)), [items]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (e.key === "Escape" || e.code === "KeyQ") { e.preventDefault(); e.stopPropagation(); onCerrar(); return; }
      if (!orden.length) return;
      if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); e.stopPropagation(); setCursor((c) => (c + 1) % orden.length); }
      else if (e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); e.stopPropagation(); setCursor((c) => (c - 1 + orden.length) % orden.length); }
      else if (e.code === "Enter" || e.code === "Space" || e.code === "KeyE") { e.preventDefault(); e.stopPropagation(); orden[cursor]?.atender(); }
      else if (e.code === "KeyI") { e.preventDefault(); e.stopPropagation(); orden[cursor]?.ir?.(); }
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [orden, cursor, onCerrar]);
  useEffect(() => {
    lista.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  let i = -1;
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/45 p-2 pt-3 sm:p-4" onClick={onCerrar}>
      <div className="ev-ventana flex max-h-full w-[min(44rem,100%)] flex-col p-3 sm:p-4" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-label="Lo que necesita tu atención">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="ev-nombre-dialogo flex-1 text-lg">Atender {orden.length ? `· ${orden.length}` : ""}</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar (Esc)" className="ev-boton mck-btn-no-fx">Esc ✕</button>
        </div>
        {!orden.length && <p className="py-6 text-center text-[#b9c2ff]">Nada te está esperando ahora mismo. ¡Al día!</p>}
        <div ref={lista} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {GRUPOS.map((g) => {
            const del = items.filter((x) => x.grupo === g);
            if (!del.length) return null;
            return (
              <section key={g}>
                <div className="mb-1 text-sm text-[#ffe14d]">{g}</div>
                <ul className="space-y-1">
                  {del.map((it) => {
                    i += 1;
                    const k = i;
                    return (
                      <li key={it.clave} data-i={k} onMouseEnter={() => setCursor(k)}
                          className={`flex items-center gap-2 rounded border-2 px-2 py-1.5 ${k === cursor ? "border-[#ffe14d] bg-white/10" : "border-transparent"}`}>
                        <span className="relative shrink-0 rounded-md p-0.5" style={{ background: it.color ?? "#FFF1E8", boxShadow: "0 0 0 2px #0b0f2a, 0 0 0 3px #fff1e8" }}>
                          <IconoModulo icono={it.icono ?? null} tam={26} />
                          <span className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full border border-[#0b0f2a]"
                                style={{ background: it.alta ? "#e74c3c" : "#f39c12" }} aria-hidden />
                        </span>
                        <button type="button" className="mck-btn-no-fx min-w-0 flex-1 bg-transparent p-0 text-left leading-tight" onClick={it.atender}>
                          <span className="line-clamp-2 block break-words sm:truncate">{it.titulo}</span>
                          <span className="line-clamp-2 block break-words text-xs text-[#b9c2ff] sm:truncate">{it.detalle}</span>
                        </button>
                        {it.ir && (
                          <button type="button" className="ev-boton mck-btn-no-fx shrink-0" onClick={it.ir} title="Caminar hasta allá en el barrio">Ir</button>
                        )}
                        <button type="button" className="ev-boton mck-btn-no-fx shrink-0" aria-pressed="true" onClick={it.atender}>Atender</button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="mt-2 hidden text-xs text-[#b9c2ff] sm:block">↑↓ elegir · Enter atender · I ir caminando · Q o Esc cerrar</p>
      </div>
    </div>
  );
}
