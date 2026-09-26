/**
 * Los editores de una caja de Colaboradores (la hoja que se abre al tocar un bloque del edificio):
 * contenido común (foto, cómo/dónde/cuándo/por qué, tiempo, dinero, campos propios, escenarios,
 * adjuntos) y lo propio de cada plantilla (producto, proveedor, rival, decisión). Además, dónde está
 * la caja y quién la lleva (Colocacion) y sus entregas (Entregas), y el historial de versiones.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, fetchAuthBlobUrl } from "../../api/client";
import { Sprite } from "./pixel";
import {
  ICONOS, MONEDAS, PLANTILLAS, VARIABLES, costoProducto, plata, urlValida,
  type Adjunto, type Avatar, type Componente, type Diagrama, type Dinero, type EntregaDoc, type Moneda, type NodoDoc,
  type Piso, type Tipo, type Version,
} from "./modelo";

/** Caché de las URLs blob: el mismo adjunto se pide una vez, no en cada render. */
const _blobCache = new Map<string, Promise<string | null>>();
export function AuthImg({ did, mid, className, alt }: { did: number; mid: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const clave = `${did}/${mid}`;
    let p = _blobCache.get(clave);
    if (!p) { p = fetchAuthBlobUrl(`/api/colaboradores/diagramas/${did}/media/${mid}`); _blobCache.set(clave, p); }
    void p.then((u) => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [did, mid]);
  if (!url) return <div className={`animate-pulse bg-gray-100 ${className || ""}`} />;
  return <img src={url} alt={alt || ""} className={className} />;
}

export const INP = "w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm text-ink";
export const MINI = "rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink";

export function DineroCampo({ etq, valor, onCambio }: { etq: string; valor?: Dinero; onCambio: (d?: Dinero) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-xs text-muted">{etq}</span>
      <input inputMode="numeric" placeholder="0" value={valor?.monto ?? ""}
             onChange={(e) => {
               const n = Number(e.target.value.replace(/[^\d.]/g, ""));
               onCambio(e.target.value.trim() === "" || !isFinite(n) ? undefined : { monto: n, moneda: valor?.moneda ?? "COP" });
             }}
             className={`${MINI} flex-1 tabular-nums`} />
      <select value={valor?.moneda ?? "COP"} disabled={!valor}
              onChange={(e) => valor && onCambio({ monto: valor.monto, moneda: e.target.value as Moneda })}
              className={`${MINI} disabled:opacity-50`}>
        {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

export type Subir = (f: File) => Promise<Adjunto | null>;

/** La foto que sale en la caja. Sin `capture`: así el teléfono deja elegir entre
 *  cámara y galería (la captura de una publicación ya está guardada). */
export function FotoCampo({ did, nd, editar, subir, subiendo, texto }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean; texto: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {nd.imagen ? (
        <AuthImg did={did} mid={nd.imagen} alt="" className="h-14 w-14 shrink-0 rounded border border-border object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-border">
          <Sprite s="foto" px={3} />
        </div>
      )}
      <label className="px-btn flex-1 cursor-pointer rounded-lg border border-border px-2 py-1.5 text-center text-xs font-bold text-ink">
        {subiendo ? "Subiendo…" : nd.imagen ? "Cambiar foto" : texto}
        <input type="file" accept="image/*" className="hidden"
               onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = "";
                 if (f) { const a = await subir(f); if (a?.tipo === "imagen") editar({ imagen: a.id }); } }} />
      </label>
      {nd.imagen && (
        <button type="button" onClick={() => editar({ imagen: undefined })}
                className="shrink-0 text-xs font-bold text-red-500">Quitar</button>
      )}
    </div>
  );
}

/** Enlace a una publicación: solo http(s) (el servidor descarta lo demás). */
export function UrlCampo({ valor, onCambio, ph }: { valor?: string; onCambio: (u?: string) => void; ph: string }) {
  const v = valor ?? "";
  const malo = v.trim() !== "" && !urlValida(v);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <input value={v} placeholder={ph} inputMode="url" autoCapitalize="off" autoCorrect="off"
               onChange={(e) => onCambio(e.target.value || undefined)}
               // «tienda.co/collar» → «https://tienda.co/collar» al salir del campo.
               onBlur={() => { const t = v.trim(); if (t && !/^[a-z]+:/i.test(t) && /^[\w-]+(\.[\w-]+)+/.test(t)) onCambio(`https://${t}`); }}
               className={`${INP} flex-1`} />
        {urlValida(v) && (
          <a href={v.trim()} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-bold text-accent">Abrir</a>
        )}
      </div>
      {malo && <p className="text-[11px] text-red-500">Debe empezar por https:// — así no se guarda.</p>}
    </div>
  );
}

export function ContenidoCaja({ did, nd, editar, subir, subiendo, extras = false }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void;
  subir: Subir; subiendo: boolean;
  /** Solo lo que no tiene su propio editor (producto y rival ya piden foto y precio). */
  extras?: boolean;
}) {
  const datos = nd.datos ?? [];
  const cons = nd.consecuencias ?? [];
  const adj = nd.adjuntos ?? [];
  return (
    <div className={`space-y-2 ${extras ? "" : "border-t border-border pt-2"}`}>
      {!extras && (
        <FotoCampo did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} texto="Poner foto (sale en la caja)" />
      )}

      {/* Cómo, dónde, por qué */}
      <div className="grid grid-cols-1 gap-1.5">
        {VARIABLES.map((v) => (
          <input key={v.id} placeholder={`${v.label}: ${v.ph}`} value={nd.variables?.[v.id] ?? ""}
                 onChange={(e) => editar({ variables: { ...(nd.variables ?? {}), [v.id]: e.target.value } })}
                 className={INP} />
        ))}
      </div>

      {/* Tiempo y dinero */}
      <div className="flex items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs text-muted">Tiempo</span>
        <input inputMode="numeric" placeholder="minutos" value={nd.tiempo_min ?? ""}
               onChange={(e) => { const n = Number(e.target.value.replace(/[^\d.]/g, ""));
                 editar({ tiempo_min: e.target.value.trim() === "" || !isFinite(n) ? undefined : n }); }}
               className={`${MINI} flex-1 tabular-nums`} />
        <span className="text-xs text-muted">min</span>
      </div>
      {!extras && (
        <>
          <DineroCampo etq="Costo" valor={nd.costo} onCambio={(d) => editar({ costo: d })} />
          <DineroCampo etq="Precio" valor={nd.precio} onCambio={(d) => editar({ precio: d })} />
        </>
      )}

      {/* Datos (campo: valor) */}
      {/* Campos propios: siempre a la vista — son lo que hace configurable a cualquier caja. */}
      <div className="rounded border border-border p-2">
        <p className="text-xs font-bold text-muted">Campos propios ({datos.length}) — nómbralos como quieras</p>
        <div className="mt-1 space-y-1">
          {datos.map((d, i) => (
            <div key={i} className="flex gap-1">
              <input placeholder="nombre del campo" value={d.campo} onChange={(e) => editar({ datos: datos.map((x, j) => j === i ? { ...x, campo: e.target.value } : x) })} className={`${MINI} w-1/3`} />
              <input placeholder="valor" value={d.valor} onChange={(e) => editar({ datos: datos.map((x, j) => j === i ? { ...x, valor: e.target.value } : x) })} className={`${MINI} flex-1`} />
              <button type="button" onClick={() => editar({ datos: datos.filter((_, j) => j !== i) })} className="px-1 text-red-500">×</button>
            </div>
          ))}
          {datos.length < 8 && (
            <button type="button" onClick={() => editar({ datos: [...datos, { campo: "", valor: "" }] })} className="text-xs font-bold text-accent">＋ campo</button>
          )}
        </div>
      </div>

      {/* Consecuencias: si pasa esto → consecuencia → medida */}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Si pasa esto… ({cons.length})</summary>
        <div className="mt-1 space-y-1.5">
          {cons.map((c, i) => (
            <div key={i} className="space-y-1 rounded border border-border p-1.5">
              <input placeholder="Si pasa…" value={c.si} onChange={(e) => editar({ consecuencias: cons.map((x, j) => j === i ? { ...x, si: e.target.value } : x) })} className={`${MINI} w-full`} />
              <input placeholder="…ocurre esto" value={c.entonces} onChange={(e) => editar({ consecuencias: cons.map((x, j) => j === i ? { ...x, entonces: e.target.value } : x) })} className={`${MINI} w-full`} />
              <div className="flex gap-1">
                <input placeholder="posible medida" value={c.medida} onChange={(e) => editar({ consecuencias: cons.map((x, j) => j === i ? { ...x, medida: e.target.value } : x) })} className={`${MINI} flex-1`} />
                <button type="button" onClick={() => editar({ consecuencias: cons.filter((_, j) => j !== i) })} className="px-1 text-red-500">×</button>
              </div>
            </div>
          ))}
          {cons.length < 6 && (
            <button type="button" onClick={() => editar({ consecuencias: [...cons, { si: "", entonces: "", medida: "" }] })} className="text-xs font-bold text-accent">＋ escenario</button>
          )}
        </div>
      </details>

      {/* Adjuntos: fotos y facturas */}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Fotos y facturas ({adj.length})</summary>
        <div className="mt-1 space-y-1">
          {adj.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 rounded border border-border p-1">
              {a.tipo === "imagen"
                ? <AuthImg did={did} mid={a.id} alt="" className="h-10 w-10 rounded object-cover" />
                : <span className="flex h-10 w-10 items-center justify-center rounded bg-red-50"><Sprite s="doc" px={3} /></span>}
              <span className="flex-1 truncate text-xs text-ink">{a.nombre || (a.tipo === "pdf" ? "Documento" : "Foto")}</span>
              <a href="#" onClick={async (e) => { e.preventDefault();
                    const u = await fetchAuthBlobUrl(`/api/colaboradores/diagramas/${did}/media/${a.id}`);
                    if (u) window.open(u, "_blank"); }}
                 className="text-xs font-bold text-accent">Ver</a>
              <button type="button" onClick={() => editar({ adjuntos: adj.filter((_, j) => j !== i) })} className="px-1 text-red-500">×</button>
            </div>
          ))}
          {adj.length < 12 && (
            <label className="inline-block cursor-pointer text-xs font-bold text-accent">
              {subiendo ? "Subiendo…" : "＋ foto o factura (PDF)"}
              <input type="file" accept="image/*,application/pdf" className="hidden"
                     onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = "";
                       if (f) { const a = await subir(f); if (a) editar({ adjuntos: [...adj, a] }); } }} />
            </label>
          )}
        </div>
      </details>
    </div>
  );
}

// ─── Producto y competencia: datos reales en vez de pasos genéricos ──────────

export function ProductoEditor({ did, nd, editar, subir, subiendo, proveedores = [] }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean;
  /** Las cajas «Proveedor» del tablero: cada pieza de la receta dice a quién se le compra. */
  proveedores?: { id: string; label: string }[];
}) {
  const comps = nd.componentes ?? [];
  const moneda: Moneda = nd.precio?.moneda ?? "COP";
  const costo = costoProducto(nd);
  const setComp = (i: number, cambio: Partial<Componente>) =>
    editar({ componentes: comps.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  const aDinero = (txt: string): Dinero | undefined => {
    const n = Number(txt.replace(/[^\d.]/g, ""));
    return txt.trim() === "" || !isFinite(n) ? undefined : { monto: n, moneda };
  };
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <FotoCampo did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} texto="Foto de la publicación" />
      <input placeholder="SKU (ej. C-COLLAR-M)" value={nd.sku ?? ""} autoCapitalize="characters"
             onChange={(e) => editar({ sku: e.target.value })} className={INP} />
      <DineroCampo etq="Precio" valor={nd.precio} onCambio={(d) => editar({ precio: d })} />
      <UrlCampo valor={nd.url} onCambio={(u) => editar({ url: u })} ph="Enlace a la publicación (https://…)" />

      <div className="space-y-1 rounded border border-border p-2">
        <p className="px-t flex items-center gap-1 text-xs font-bold text-muted"><Sprite s="cofre" px={2} /> Empaque</p>
        <input placeholder="Qué empaque (ej. bolsa kraft con visor)" value={nd.empaque?.nombre ?? ""}
               onChange={(e) => editar({ empaque: { ...nd.empaque, nombre: e.target.value } })} className={INP} />
        <DineroCampo etq="Costo" valor={nd.empaque?.costo}
                     onCambio={(d) => editar({ empaque: { nombre: nd.empaque?.nombre ?? "", costo: d } })} />
      </div>

      <div className="space-y-1 rounded border border-border p-2">
        <p className="px-t flex items-center gap-1 text-xs font-bold text-muted">
          <Sprite s="bloques" px={2} /> Receta: de qué está hecho ({comps.length})
        </p>
        {comps.map((c, i) => (
          <div key={i} className="flex flex-wrap gap-1">
            <input placeholder="SKU hijo" value={c.sku ?? ""} autoCapitalize="characters"
                   onChange={(e) => setComp(i, { sku: e.target.value })} className={`${MINI} w-24`} />
            <input placeholder="pieza" value={c.nombre} onChange={(e) => setComp(i, { nombre: e.target.value })}
                   className={`${MINI} min-w-0 flex-1`} />
            <input placeholder="cant." value={c.cantidad ?? ""} onChange={(e) => setComp(i, { cantidad: e.target.value })}
                   className={`${MINI} w-16`} />
            <input placeholder="costo" inputMode="numeric" value={c.costo?.monto ?? ""}
                   onChange={(e) => setComp(i, { costo: aDinero(e.target.value) })} className={`${MINI} w-20 tabular-nums`} />
            <button type="button" onClick={() => editar({ componentes: comps.filter((_, j) => j !== i) })}
                    className="px-1 text-red-500" aria-label="Quitar pieza">×</button>
            {proveedores.length > 0 && (
              <select value={c.proveedor ?? ""} onChange={(e) => setComp(i, { proveedor: e.target.value || undefined })}
                      className={`${MINI} w-full`} aria-label="A quién se le compra">
                <option value="">proveedor: —</option>
                {proveedores.map((v) => <option key={v.id} value={v.id}>de {v.label}</option>)}
              </select>
            )}
          </div>
        ))}
        {comps.length < 12 && (
          <button type="button" onClick={() => editar({ componentes: [...comps, { nombre: "" }] })}
                  className="text-xs font-bold text-accent">＋ pieza</button>
        )}
        <p className="text-[11px] text-muted">El costo de cada pieza es lo que gasta UNA unidad del producto, en {moneda}.</p>
      </div>

      <div className="space-y-0.5 rounded border border-border bg-surface-input p-2 text-sm text-ink">
        <p className="flex items-center gap-1"><Sprite s="bolsa" px={2} /> Costo por unidad (receta + empaque): <b>{costo ? plata(costo) : "—"}</b></p>
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Más: tiempo, datos, facturas, escenarios</summary>
        <div className="mt-1">
          <ContenidoCaja extras did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} />
        </div>
      </details>
    </div>
  );
}

/** Un proveedor (tienda del mercado externo): cuánto tarda, qué tan confiable es y qué vende. */
export function ProveedorEditor({ did, nd, editar, subir, subiendo }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean;
}) {
  const insumos = nd.componentes ?? [];
  const setIns = (i: number, cambio: Partial<Componente>) =>
    editar({ componentes: insumos.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">Entrega en
          <input inputMode="numeric" value={nd.entrega_dias ?? ""} placeholder="días"
                 onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); editar({ entrega_dias: v === "" ? undefined : Number(v) }); }}
                 className={`${MINI} ml-1 w-16`} /> días
        </label>
        <span className="text-xs text-muted">Fiabilidad</span>
        {[1, 2, 3, 4, 5].map((k) => (
          <button key={k} type="button" aria-label={`Fiabilidad ${k} de 5`} aria-pressed={(nd.fiabilidad ?? 0) >= k}
                  onClick={() => editar({ fiabilidad: nd.fiabilidad === k ? undefined : k })}
                  className="text-lg leading-none" style={{ color: (nd.fiabilidad ?? 0) >= k ? "#FFA300" : "#C2C3C7" }}>★</button>
        ))}
      </div>
      <UrlCampo valor={nd.url} onCambio={(u) => editar({ url: u })} ph="Su página o catálogo (https://…)" />
      <div className="space-y-1 rounded border border-border p-2">
        <p className="px-t flex items-center gap-1 text-xs font-bold text-muted"><Sprite s="cofre" px={2} /> Lo que vende ({insumos.length})</p>
        {insumos.map((c, i) => (
          <div key={i} className="flex gap-1">
            <input placeholder="SKU" value={c.sku ?? ""} onChange={(e) => setIns(i, { sku: e.target.value })} className={`${MINI} w-20`} />
            <input placeholder="insumo" value={c.nombre} onChange={(e) => setIns(i, { nombre: e.target.value })} className={`${MINI} min-w-0 flex-1`} />
            <input placeholder="costo" inputMode="numeric" value={c.costo?.monto ?? ""}
                   onChange={(e) => { const n = Number(e.target.value.replace(/[^\d.]/g, "")); setIns(i, { costo: e.target.value.trim() === "" ? undefined : { monto: n, moneda: "COP" } }); }}
                   className={`${MINI} w-20 tabular-nums`} />
            <button type="button" onClick={() => editar({ componentes: insumos.filter((_, j) => j !== i) })}
                    className="px-1 text-red-500" aria-label="Quitar insumo">×</button>
          </div>
        ))}
        {insumos.length < 12 && (
          <button type="button" onClick={() => editar({ componentes: [...insumos, { nombre: "" }] })}
                  className="text-xs font-bold text-accent">＋ insumo</button>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Más: cómo, dónde, cuándo, facturas, escenarios</summary>
        <div className="mt-1">
          <ContenidoCaja did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} />
        </div>
      </details>
    </div>
  );
}

export function CompetenciaEditor({ did, nd, editar, subir, subiendo }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean;
}) {
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <FotoCampo did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} texto="Captura de su publicación" />
      <input placeholder="Dónde vende (marketplace, Instagram, tienda propia…)" value={nd.plataforma ?? ""}
             onChange={(e) => editar({ plataforma: e.target.value })} className={INP} />
      <UrlCampo valor={nd.url} onCambio={(u) => editar({ url: u })} ph="Enlace a su publicación (https://…)" />
      <DineroCampo etq="Su precio" valor={nd.precio} onCambio={(d) => editar({ precio: d })} />
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Datos del rival: envío, calificación, ventas, capturas…</summary>
        <div className="mt-1">
          <ContenidoCaja extras did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} />
        </div>
      </details>
    </div>
  );
}

// ─── Consenso: propuestas, votos 👍 y desempate por turno ─────────────────────

export function ConsensoEditor({ nd, yoId, participantes, turnoActual, editarAsunto, editarSkill, correr }: {
  nd: NodoDoc; yoId: number; participantes: Record<string, string>; turnoActual?: number | null;
  editarAsunto: (v: string) => void; editarSkill: (v: string) => void; correr: (accion: string, extra?: { texto?: string; propuesta?: string }) => Promise<void>;
}) {
  const props = nd.propuestas ?? [];
  const votos = nd.votos ?? {};
  const resuelto = nd.resuelto;
  const nombre = (uid?: number) => (uid != null && participantes[String(uid)]) || `#${uid ?? "?"}`;
  const miPropuesta = props.find((p) => p.autor === yoId || p.id === `p${yoId}`);
  const [miTexto, setMiTexto] = useState(miPropuesta?.texto ?? "");
  useEffect(() => { setMiTexto(miPropuesta?.texto ?? ""); }, [miPropuesta?.texto]);
  const [ocupado, setOcupado] = useState(false);
  const acto = async (accion: string, extra?: { texto?: string; propuesta?: string }) => {
    setOcupado(true); try { await correr(accion, extra); } finally { setOcupado(false); }
  };
  const votosDe = (pid: string) => Object.entries(votos).filter(([, v]) => v === pid).map(([u]) => Number(u));
  const miVoto = votos[String(yoId)];
  const empatePosible = props.length > 1;

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <textarea value={nd.asunto ?? ""} placeholder="¿Qué hay que decidir? (ej. ¿bolsa o caja para el empaque?)"
                onChange={(e) => editarAsunto(e.target.value)} rows={2}
                className={`${INP} resize-none`} />
      <input value={nd.skill ?? ""} placeholder="Habilidad que desempata (ej. negociación): decide quien la tenga"
             onChange={(e) => editarSkill(e.target.value)} className={INP}
             title="Si hay empate y solo una persona tiene esta habilidad (en ⚙ Reglas), decide ella; si no, el turno" />

      {resuelto ? (
        <div className="rounded-lg border border-emerald-400 bg-emerald-50 p-2 text-sm">
          <p className="flex items-center gap-1.5 font-bold text-emerald-800">
            <Sprite s="trofeo" px={2} /> Decidido: {props.find((p) => p.id === resuelto.propuesta)?.texto ?? "—"}
          </p>
          <p className="text-xs text-emerald-700">
            {resuelto.modo === "turno" ? `Por turno de ${nombre(resuelto.por)} (empate)`
              : resuelto.modo === "skill" ? `Por habilidad de ${nombre(resuelto.por)} en ${nd.skill ?? "—"} (empate)`
              : "Por acuerdo de los votos"}
          </p>
          <button type="button" disabled={ocupado} onClick={() => void acto("reabrir")}
                  className="mt-1 text-xs font-bold text-accent disabled:opacity-40">Reabrir para volver a votar</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {empatePosible ? `Si hay empate, desempata ${nombre(turnoActual ?? Number(Object.keys(participantes)[0]))} (turno)` : "Cada quien propone y ambos votan"}
          </span>
          <button type="button" disabled={ocupado || !props.length} onClick={() => void acto("cerrar")}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">Cerrar y decidir</button>
        </div>
      )}

      {/* Mi propuesta */}
      <div className="rounded-lg border border-border p-2">
        <p className="text-xs font-bold text-muted">Mi propuesta</p>
        <textarea value={miTexto} placeholder="Escribe tu solución para este asunto…" rows={2}
                  onChange={(e) => setMiTexto(e.target.value)} className={`${INP} mt-1 resize-none`} />
        <div className="mt-1 flex gap-2">
          <button type="button" disabled={ocupado || miTexto.trim() === (miPropuesta?.texto ?? "")}
                  onClick={() => void acto("proponer", { texto: miTexto })}
                  className="rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">
            {miPropuesta ? "Actualizar" : "Poner mi propuesta"}
          </button>
          {miPropuesta && (
            <button type="button" disabled={ocupado} onClick={() => { setMiTexto(""); void acto("proponer", { texto: "" }); }}
                    className="text-xs font-bold text-red-500 disabled:opacity-40">Retirar</button>
          )}
        </div>
      </div>

      {/* Las propuestas sobre la mesa, con votos */}
      <div className="space-y-1.5">
        {props.length === 0 && <p className="text-xs text-muted">Aún no hay propuestas. Pon la tuya y pídele la suya al otro.</p>}
        {props.map((p) => {
          const votantes = votosDe(p.id);
          const yoVote = miVoto === p.id;
          const ganadora = resuelto?.propuesta === p.id;
          return (
            <div key={p.id} className={`rounded-lg border p-2 ${ganadora ? "border-emerald-400 bg-emerald-50" : "border-border"}`}>
              <p className="text-[11px] font-bold uppercase text-muted">{nombre(p.autor)}</p>
              <p className="text-sm text-ink">{p.texto}</p>
              <div className="mt-1 flex items-center gap-2">
                <button type="button" disabled={ocupado} onClick={() => void acto(yoVote ? "quitar_voto" : "votar", { propuesta: p.id })}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${yoVote ? "border-emerald-500 bg-emerald-100 text-emerald-700" : "border-border text-muted"} disabled:opacity-40`}>
                  <Sprite s="pulgar" px={2} /> {yoVote ? "mi voto" : "votar"}
                </button>
                <span className="text-xs text-muted">
                  {votantes.length ? `${votantes.length} voto${votantes.length === 1 ? "" : "s"}: ${votantes.map(nombre).join(", ")}` : "sin votos"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Historial({ did, version, onCerrar, onRestaurado }: {
  did: number; version: number; onCerrar: () => void; onRestaurado: (d: Diagrama) => void;
}) {
  const q = useQuery<{ versiones: Version[] }>({
    queryKey: ["colab-versiones", did, version],
    queryFn: () => api.get(`/api/colaboradores/diagramas/${did}/versiones`),
  });
  const [error, setError] = useState<string | null>(null);
  async function restaurar(v: number) {
    if (!window.confirm(`¿Volver a la versión ${v}? Se guarda como una versión nueva; no se pierde nada.`)) return;
    try {
      onRestaurado(await api.post<Diagrama>(`/api/colaboradores/diagramas/${did}/restaurar`, { a_version: v, version }));
    } catch (e) {
      setError((e as Error).message === "conflicto" ? "El otro acaba de guardar: cierra y vuelve a intentarlo." : (e as Error).message);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onCerrar}>
      <div className="px-hoja max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-panel p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-ink">Historial de versiones</p>
          <button type="button" onClick={onCerrar} className="text-sm font-bold text-muted">Cerrar</button>
        </div>
        {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
        {(q.data?.versiones ?? []).map((v) => (
          <div key={v.version} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm">
            <div>
              <p className="font-bold text-ink">Versión {v.version} · {v.usuario || "—"}</p>
              <p className="text-xs text-muted">{v.creado_en} · {v.nodos} cajas, {v.flechas} entregas{v.resumen ? ` · ${v.resumen}` : ""}</p>
            </div>
            {v.version !== version && (
              <button type="button" onClick={() => void restaurar(v.version)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-bold text-ink">Restaurar</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Dónde está la caja, qué es y quién la lleva ────────────────────────────

/** La colocación de un bloque: su habitación en el edificio, su plantilla, su ícono y su responsable. */
export function Colocacion({ nd, pisos, avatares, habitacion, editar }: {
  nd: NodoDoc; pisos: Piso[]; avatares: Avatar[]; habitacion: string; editar: (c: Partial<NodoDoc>) => void;
}) {
  return (
    <div className="space-y-1.5 rounded border border-border p-2">
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-20 shrink-0">Dónde está</span>
        <select value={habitacion} onChange={(e) => editar({ habitacion: e.target.value })} className={`${MINI} min-w-0 flex-1`}>
          {[...pisos].reverse().map((p) => (
            <optgroup key={p.id} label={p.nombre}>
              {p.habitaciones.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-20 shrink-0">Responsable</span>
        <select value={nd.avatar ?? ""} onChange={(e) => editar({ avatar: e.target.value || undefined })} className={`${MINI} min-w-0 flex-1`}>
          <option value="">— nadie en particular —</option>
          {avatares.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-20 shrink-0">Plantilla</span>
        <select value={nd.tipo} onChange={(e) => editar({ tipo: e.target.value as Tipo })} className={`${MINI} min-w-0 flex-1`}
                title="Cambiarla no borra nada: solo cambia qué campos se ven primero">
          {PLANTILLAS.map((p) => <option key={p.tipo} value={p.tipo}>{p.label}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Ícono de la caja">
        <span className="w-20 shrink-0 text-xs text-muted">Ícono</span>
        {ICONOS.map((ic) => (
          <button key={ic} type="button" onClick={() => editar({ icono: nd.icono === ic ? undefined : ic })}
                  aria-pressed={nd.icono === ic} title={ic}
                  className={`border-2 p-0.5 ${nd.icono === ic ? "border-black bg-[#FFEC27]" : "border-transparent"}`}>
            <Sprite s={ic} px={2} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Las entregas de una caja: qué lleva a otra caja y quién lo lleva (lo que antes eran flechas). */
export function Entregas({ nd, nodos, entregas, avatares, crear, abrir }: {
  nd: NodoDoc; nodos: NodoDoc[]; entregas: EntregaDoc[]; avatares: Avatar[];
  crear: (e: { to: string; label: string; portador?: string }) => void;
  abrir: (id: string) => void;
}) {
  const nombre = (id: string) => nodos.find((n) => n.id === id)?.label ?? "(borrada)";
  const salen = entregas.filter((e) => e.from === nd.id);
  const llegan = entregas.filter((e) => e.to === nd.id);
  const [destino, setDestino] = useState("");
  const [que, setQue] = useState("");
  const [quien, setQuien] = useState(nd.avatar ?? "");
  return (
    <div className="space-y-1 rounded border border-border p-2">
      <p className="flex items-center gap-1 text-xs font-bold text-muted"><Sprite s="camion" px={2} /> Entregas</p>
      {llegan.map((e) => (
        <button key={e.id} type="button" onClick={() => abrir(e.id)} className="block w-full text-left text-xs text-ink">
          ← recibe {e.label ? `«${e.label}» ` : ""}de <b>{nombre(e.from)}</b>
        </button>
      ))}
      {salen.map((e) => (
        <button key={e.id} type="button" onClick={() => abrir(e.id)} className="block w-full text-left text-xs text-ink">
          → lleva {e.label ? `«${e.label}» ` : ""}a <b>{nombre(e.to)}</b>
          {e.portador ? ` · la lleva ${avatares.find((a) => a.id === e.portador)?.nombre.split(" ")[0] ?? "?"}` : ""}
        </button>
      ))}
      <div className="flex flex-wrap gap-1 pt-1">
        <input value={que} onChange={(e) => setQue(e.target.value)} placeholder="Qué lleva (ej. cajas listas)" className={`${MINI} min-w-0 flex-1`} />
        <select value={destino} onChange={(e) => setDestino(e.target.value)} className={`${MINI} min-w-0 flex-1`} aria-label="A qué caja">
          <option value="">a qué caja…</option>
          {nodos.filter((n) => n.id !== nd.id).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <select value={quien} onChange={(e) => setQuien(e.target.value)} className={MINI} aria-label="Quién la lleva">
          <option value="">quién la lleva</option>
          {avatares.map((a) => <option key={a.id} value={a.id}>{a.nombre.split(" ")[0]}</option>)}
        </select>
        <button type="button" disabled={!destino} className="rounded bg-accent px-2 py-1 text-xs font-bold text-white disabled:opacity-40"
                onClick={() => { crear({ to: destino, label: que.trim(), portador: quien || undefined }); setDestino(""); setQue(""); }}>
          ＋ Entregar
        </button>
      </div>
    </div>
  );
}
