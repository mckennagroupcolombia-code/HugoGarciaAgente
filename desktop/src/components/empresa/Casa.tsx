/**
 * «Decorar mi casa»: el catálogo del vecindario (jardín, muebles, accesorios) y la casa (ampliar,
 * pintar), con las monedas del mes. Elegir algo → el juego pinta en verde/rojo dónde cabe y se pone
 * tocando el terreno; tocar algo que ya está → moverlo o quitarlo (devuelve la mitad). Todo lo
 * valida y cobra el servidor (app/services/empresa_viva_vecindario.py).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { tocarSonido } from "../../lib/sonidosJuego";
import type { JuegoEmpresa } from "./juego";
import { CuadroAtlas } from "./VentanaModulo";
import { errorLugar, nivelDe, zonas, type EstadoVecindario, type ItemCatalogo, type LoteEstado, type LoteMapa } from "./vecindario";

type Colocando = { it: ItemCatalogo; mover?: number } | null;

export function DecorarCasa({ juego, lote, mio, v, onAccion, onCerrar }: {
  juego: JuegoEmpresa | null;
  lote: LoteMapa;
  mio: LoteEstado;
  v: EstadoVecindario;
  onAccion: (ruta: string, cuerpo?: object) => Promise<EstadoVecindario | null>;
  onCerrar: () => void;
}) {
  const [cat, setCat] = useState(v.catalogo.categorias[0]?.id ?? "jardin");
  const [colocando, setColocando] = useState<Colocando>(null);
  const [elegido, setElegido] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");
  const [abierto, setAbierto] = useState(true);
  const nivel = nivelDe(v, mio.casa?.nivel);
  const z = useMemo(() => zonas(lote.frente, nivel), [lote.frente, nivel]);
  const saldo = v.billetera.saldo;

  const decir = (t: string) => { setAviso(t); window.setTimeout(() => setAviso((a) => (a === t ? "" : a)), 3500); };

  const poner = useCallback(async (cx: number, cy: number) => {
    if (!colocando) return;
    const err = errorLugar(v.catalogo.items, lote.frente, nivel, colocando.it, cx, cy, mio.items, colocando.mover);
    if (err) { decir(err); tocarSonido("error"); return; }
    const r = colocando.mover
      ? await onAccion("mover", { id: colocando.mover, cx, cy })
      : await onAccion("poner", { item: colocando.it.id, cx, cy });
    if (r) {
      tocarSonido(colocando.mover ? "blip" : "vender");
      if (colocando.mover) setColocando(null);
      else if (r.billetera.saldo < colocando.it.precio) setColocando(null);   // ya no alcanza para otro igual
    }
  }, [colocando, v.catalogo.items, lote.frente, nivel, mio.items, onAccion]);

  // El juego: zonas, fantasma y toques
  useEffect(() => {
    juego?.modoDecorar({
      lote, adentro: z.adentro, jardin: z.jardin,
      colocar: colocando ? { frame: `casa_${colocando.it.id}`, w: colocando.it.w, h: colocando.it.h, donde: colocando.it.donde } : null,
      valido: (cx, cy) => Boolean(colocando) && !errorLugar(v.catalogo.items, lote.frente, nivel, colocando!.it, cx, cy, mio.items, colocando!.mover),
      onCelda: (cx, cy) => void poner(cx, cy),
      onItem: (id) => { setElegido(id); tocarSonido("blip"); },
    });
  }, [juego, lote, z, colocando, v.catalogo.items, nivel, mio.items, poner]);
  useEffect(() => () => juego?.modoDecorar(null), [juego]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (colocando) setColocando(null);
      else if (elegido != null) setElegido(null);
      else onCerrar();
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [colocando, elegido, onCerrar]);

  const items = v.catalogo.items.filter((i) => i.categoria === cat);
  const sel = elegido != null ? mio.items.find((i) => i.id === elegido) : null;
  const selIt = sel ? v.catalogo.items.find((i) => i.id === sel.item) : null;
  const siguiente = v.catalogo.niveles.find((n) => n.nivel === (mio.casa?.nivel ?? 0) + 1);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center p-1.5 sm:items-start sm:justify-end sm:p-3">
      <div className="ev-ventana pointer-events-auto flex max-h-[46%] w-full flex-col p-2 sm:max-h-full sm:w-[22rem]" role="dialog" aria-label="Decorar mi casa">
        <div className="flex items-center gap-2">
          <div className="ev-nombre-dialogo flex-1">Decorar mi casa</div>
          <span className="rounded border border-[#ffe14d] px-1.5 text-sm text-[#ffe14d]" title={`Cada mes llegan ${v.asignacion_mensual} ${v.moneda}`}>◉ {saldo}</span>
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>{abierto ? "▾" : "▴"}</button>
          <button type="button" className="ev-boton mck-btn-no-fx" aria-pressed="true" onClick={onCerrar}>Listo</button>
        </div>
        {colocando && (
          <div className="mt-1 rounded border-2 border-[#2ecc71] p-1.5 text-sm">
            {colocando.mover ? "Toca dónde lo quieres" : `Toca dónde poner: ${colocando.it.nombre} (${colocando.it.precio})`}
            {" · "}<span className="text-[#b9c2ff]">{colocando.it.donde === "adentro" ? "va adentro" : colocando.it.donde === "jardin" ? "va en el jardín" : "adentro o afuera"}</span>
            <button type="button" className="ev-boton mck-btn-no-fx ml-2" onClick={() => setColocando(null)}>Cancelar</button>
          </div>
        )}
        {sel && selIt && !colocando && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded border-2 border-[#ffe14d] p-1.5 text-sm">
            <CuadroAtlas frame={`casa_${selIt.id}`} tam={28} />
            <span className="flex-1">{selIt.nombre}</span>
            <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => { setColocando({ it: selIt, mover: sel.id }); setElegido(null); }}>Mover</button>
            <button type="button" className="ev-boton mck-btn-no-fx"
                    onClick={() => void onAccion("quitar", { id: sel.id }).then((r) => { if (r) { setElegido(null); tocarSonido("volver"); } })}>
              Quitar (+{Math.floor(selIt.precio * v.catalogo.devolucion)})
            </button>
          </div>
        )}
        {aviso && <p className="mt-1 text-sm text-[#ffb4b4]">{aviso}</p>}
        {abierto && (
          <>
            <div className="mt-2 flex flex-wrap gap-1" role="tablist">
              {[...v.catalogo.categorias, { id: "casa", nombre: "Casa" }].map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} aria-pressed={cat === c.id}
                        className="ev-boton mck-btn-no-fx" onClick={() => setCat(c.id)}>{c.nombre}</button>
              ))}
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              {cat === "casa" ? (
                <div className="space-y-2 text-sm">
                  <p>Tu casa: {nivel?.nombre ?? "—"} ({nivel ? `${nivel.w} × ${nivel.h}` : ""} baldosas).</p>
                  {siguiente ? (
                    <button type="button" className="ev-boton mck-btn-no-fx" disabled={saldo < siguiente.precio}
                            onClick={() => void onAccion("ampliar").then((r) => { if (r) tocarSonido("logro"); })}>
                      {siguiente.nombre} ({siguiente.precio})
                    </button>
                  ) : <p className="text-[#b9c2ff]">Ya tiene todas las ampliaciones.</p>}
                  <div>Pintar ({v.catalogo.casa.pintar}):</div>
                  <div className="flex flex-wrap gap-1">
                    {v.catalogo.casa.modelos.map((m) => (
                      <button key={m.id} type="button" className="ev-boton mck-btn-no-fx" disabled={m.id === mio.casa?.modelo || saldo < v.catalogo.casa.pintar}
                              onClick={() => void onAccion("pintar", { modelo: m.id }).then((r) => { if (r) tocarSonido("vender"); })}>
                        <span className="mr-1 inline-block h-3 w-3 border border-black align-middle" style={{ background: m.pared }} />{m.nombre}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#b9c2ff]">Lo que quitas te devuelve la mitad. Cada mes llegan {v.asignacion_mensual} {v.moneda}{v.acumula ? "; lo que no gastes se acumula" : ""}.</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {items.map((it) => {
                    const max = it.maximo && mio.items.filter((x) => x.item === it.id).length >= it.maximo;
                    const caro = it.precio > saldo;
                    return (
                      <button key={it.id} type="button" disabled={caro || Boolean(max)}
                              className={`ev-boton mck-btn-no-fx flex flex-col items-center gap-0.5 p-1 ${colocando?.it.id === it.id && !colocando.mover ? "ring-2 ring-[#2ecc71]" : ""}`}
                              onClick={() => { setColocando({ it }); setElegido(null); }}
                              title={`${it.nombre} · ${it.precio} ${v.moneda}${it.donde === "adentro" ? " · adentro" : it.donde === "jardin" ? " · jardín" : ""}`}>
                        <CuadroAtlas frame={`casa_${it.id}`} tam={34} />
                        <span className="w-full truncate text-[11px]">{it.nombre}</span>
                        <span className="text-[11px] text-[#ffe14d]">◉ {it.precio}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="mt-1 hidden text-xs text-[#b9c2ff] sm:block">Elige algo y toca dónde ponerlo. Toca algo de tu casa para moverlo o quitarlo. Esc sale.</p>
          </>
        )}
      </div>
    </div>
  );
}
