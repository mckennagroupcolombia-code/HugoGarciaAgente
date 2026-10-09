/**
 * «¿Dónde está…?»: todos los módulos de la app, en el orden del Mapa (lib/flujoApp.ts), y al elegir
 * uno el personaje camina hasta su objeto en el barrio. Así el barrio es la app hecha lugar: cada
 * módulo tiene su sitio (estaciones de mapa.json) y aquí se encuentra sin saber dónde quedaba.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ETAPAS_APP, FUERA_DEL_FLUJO, ORIGEN_APP } from "../../lib/flujoApp";
import { infoModulo } from "./barrio";
import type { EstacionMapa } from "./tipos";

/** Los que no tienen objeto propio porque se hacen hablando con Hugo, en la tienda. */
const CON_HUGO = new Set(["chat", "supervisor"]);

function normal(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function BuscadorModulos({ estaciones, puede, onIr, onCerrar }: {
  estaciones: EstacionMapa[]; puede: (panel: string) => boolean; onIr: (panel: string) => void; onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCerrar(); } };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [onCerrar]);

  const conLugar = useMemo(() => new Set(estaciones.filter((e) => e.tipo === "modulo").map((e) => e.panel)), [estaciones]);
  const grupos = useMemo(() => {
    const tiene = (p: string) => conLugar.has(p) || CON_HUGO.has(p);
    const g: { titulo: string; paneles: string[] }[] = [
      { titulo: "Inicio", paneles: [ORIGEN_APP.panel, ...FUERA_DEL_FLUJO.map((p) => p.panel)].filter(tiene) },
      ...ETAPAS_APP.map((et) => ({ titulo: et.titulo, paneles: et.tramos.flatMap((t) => t.pasos.map((p) => p.panel)).filter(tiene) })),
    ];
    const nq = normal(q.trim());
    return g.map((x) => ({
      ...x,
      paneles: nq ? x.paneles.filter((p) => { const m = infoModulo(p); return normal(`${m.nombre} ${m.hace} ${x.titulo}`).includes(nq); }) : x.paneles,
    })).filter((x) => x.paneles.length);
  }, [conLugar, q]);
  const primero = grupos[0]?.paneles[0];

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-3" onClick={onCerrar}>
      <div className="ev-ventana flex max-h-full w-[min(44rem,100%)] flex-col p-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="¿Dónde está…?">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="ev-nombre-dialogo flex-1 text-lg">¿Dónde está…?</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar (Esc)" className="ev-boton mck-btn-no-fx">Esc ✕</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (primero) onIr(primero); }}>
          <input ref={campo} className="ev-campo" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Escribe un módulo: facturación, libro mayor, etiquetas…" aria-label="Buscar un módulo" />
        </form>
        <p className="mt-1 text-xs text-[#b9c2ff]">Elige uno y tu personaje camina hasta su objeto en el barrio. Ahí lo puedes abrir.</p>
        <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <div className="mb-1 text-sm text-[#ffe14d]">{g.titulo}</div>
              <div className="flex flex-wrap gap-1">
                {g.paneles.map((p) => {
                  const m = infoModulo(p);
                  return (
                    <button key={p} type="button" className="ev-boton mck-btn-no-fx" onClick={() => onIr(p)}
                            title={`${m.hace}${CON_HUGO.has(p) ? " (con Hugo, en la tienda)" : ""}${puede(p) ? "" : " · no está en tus permisos"}`}>
                      {m.nombre}{puede(p) ? "" : " · sin acceso"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!grupos.length && <p className="text-[#b9c2ff]">No hay un módulo con ese nombre.</p>}
        </div>
      </div>
    </div>
  );
}
