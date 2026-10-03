import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { Ico } from "../../icons/Ico";
import { BTN_SEC } from "./comun";

/**
 * El documento técnico de un combo, para LEERLO y decidir sin salir del taller: sus tres partes
 * (ficha técnica · COA · SDS), las fuentes, qué tiene pendiente y cuántos campos le faltan a cada
 * parte. Abajo van las acciones que cierran la pieza (unirlo a la materia prima, elegir otro,
 * editarlo en Docs técnicos): las decide quien lo abre y llegan por `acciones`.
 *
 * Solo lectura: `GET /api/mapa-sistema/documentos/<archivo>/revision` no genera PDF ni toca el YAML.
 */

type Ruta = (string | number)[];
type Bloque =
  | { tipo: "texto"; titulo: string; texto: string; ruta: Ruta | null }
  | { tipo: "filas"; titulo: string; filas: [string, string, Ruta | null][] }
  | { tipo: "tabla"; titulo: string; filas: string[][]; ruta: Ruta | null }
  | { tipo: "lista"; titulo: string; items: string[]; ruta: Ruta | null };
/** Lo que se va cambiando, por ruta: se guarda todo junto. */
type Cambios = Record<string, { ruta: Ruta; valor: string }>;
type Edicion = { activo: boolean; cambios: Cambios; poner: (ruta: Ruta, valor: string, original: string) => void };
type Seccion = { id: string; titulo: string; bloques: Bloque[]; vacios: number; existe: boolean; firmado?: boolean };
type Revision = {
  archivo: string; titulo: string; estado: string; referencia: string; equivalentes: string[]; borrador: boolean;
  secciones: Seccion[]; pendientes: { titulo: string; items: string[] }[]; fuentes: string[];
  publicado: boolean; ediciones: { cuando: string; quien: string; campos: string[] }[];
  proveedor: { proveedor?: string; fecha?: string; nombre_en_factura?: string } | null;
};

const LISTO = new Set(["TDS+COA+SDS", "TDS+COA", "TDS"]);

const CAMPO = "w-full rounded-md border border-border bg-surface-input px-2 py-1 text-[12.5px] text-ink focus:border-accent focus:outline-none";

/** Un valor del documento: texto para leer, o campo para corregir cuando se está editando. */
function Valor({ ruta, valor, ed, largo = false, vacio = "sin dato" }: { ruta: Ruta | null; valor: string; ed: Edicion; largo?: boolean; vacio?: string }) {
  const clave = ruta ? JSON.stringify(ruta) : "";
  const actual = ruta && clave in ed.cambios ? ed.cambios[clave].valor : valor;
  if (!ed.activo || !ruta) return actual ? <span className="whitespace-pre-line">{actual}</span> : <span className="font-mono text-[10.5px] text-muted/70">{vacio}</span>;
  const cambiado = clave in ed.cambios;
  const cls = `${CAMPO} ${cambiado ? "border-accent bg-accent/5" : ""}`;
  return largo || actual.length > 70 || actual.includes("\n") ? (
    <textarea rows={Math.min(8, Math.max(2, Math.ceil(actual.length / 95)))} className={cls} value={actual} onChange={(ev) => ed.poner(ruta, ev.target.value, valor)} />
  ) : (
    <input className={cls} value={actual} onChange={(ev) => ed.poner(ruta, ev.target.value, valor)} />
  );
}

function BloqueVista({ b, ed }: { b: Bloque; ed: Edicion }) {
  const titulo = b.titulo ? <h5 className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">{b.titulo}</h5> : null;
  if (b.tipo === "texto") return <div>{titulo}<div className="text-[12.5px] leading-relaxed text-ink"><Valor ruta={b.ruta} valor={b.texto} ed={ed} largo /></div></div>;
  if (b.tipo === "lista")
    return (
      <div>{titulo}
        <ul className="space-y-1 text-[12.5px] text-ink">
          {b.items.map((it, i) => {
            const [cab, ...resto] = it.split("|");
            return (
              <li key={i} className="flex gap-1.5">
                <span className="text-accent">·</span>
                <span className="min-w-0 flex-1">
                  {ed.activo && b.ruta ? <Valor ruta={[...b.ruta, i]} valor={it} ed={ed} /> : resto.length ? <><b>{cab}.</b> {resto.join("|")}</> : it}
                </span>
              </li>
            );
          })}
        </ul>
        {ed.activo && b.ruta && b.items.some((it) => it.includes("|")) && <p className="mt-1 text-[10.5px] text-muted">Formato: <code>Título|explicación</code>.</p>}
      </div>
    );
  if (b.tipo === "filas")
    return (
      <div>{titulo}
        <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-[12px]">
          {b.filas.map(([k, v, ruta], i) => (
            <div key={i} className="contents">
              <dt className="text-muted">{k}{ed.activo && !ruta ? <span className="ml-1 text-muted" title="No se edita desde aquí"><Ico e="🔒" /></span> : null}</dt>
              <dd className="text-ink"><Valor ruta={ruta} valor={v} ed={ed} /></dd>
            </div>
          ))}
        </dl>
      </div>
    );
  return (
    <div>{titulo}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[11.5px]">
          <tbody>
            {b.filas.map((fila, i) => (
              <tr key={i} className={i === 0 && fila.length > 2 ? "bg-surface-input font-bold text-ink" : "border-t border-border/60 text-ink"}>
                {fila.map((c, j) => <td key={j} className="px-2 py-1 align-top"><Valor ruta={b.ruta ? [...b.ruta, i, j] : null} valor={c} ed={ed} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ed.activo && !b.ruta && <p className="mt-1 text-[10.5px] text-muted">Esta tabla se arma sola con los campos de arriba: se corrige allá.</p>}
    </div>
  );
}

export default function DocumentoEmergente({ archivo, combo, onCerrar, acciones, onGuardado }: {
  archivo: string;
  /** Para qué combo se está revisando (solo para decirlo en la cabecera). */
  combo: string;
  onCerrar: () => void;
  acciones?: ReactNode;
  /** Tras guardar una edición (para refrescar las piezas del combo). */
  onGuardado?: () => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [cambios, setCambios] = useState<Cambios>({});
  const [confirmaPublicado, setConfirmaPublicado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const nCambios = Object.keys(cambios).length;
  const ed: Edicion = {
    activo: editando,
    cambios,
    poner: (ruta, valor, original) =>
      setCambios((c) => {
        const k = JSON.stringify(ruta);
        const n = { ...c };
        if (valor === original) delete n[k];
        else n[k] = { ruta, valor };
        return n;
      }),
  };
  const cerrar = () => {
    if (nCambios > 0 && !window.confirm(`Hay ${nCambios} cambio${nCambios === 1 ? "" : "s"} sin guardar. ¿Cerrar y perderlos?`)) return;
    onCerrar();
  };
  const rev = useQuery({
    queryKey: ["mision-doc-revision", archivo],
    queryFn: () => api.get<Revision>(`/api/mapa-sistema/documentos/${encodeURIComponent(archivo)}/revision`),
    retry: false,
  });
  const [pestana, setPestana] = useState("tds");
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") cerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }); // sin dependencias: `cerrar` mira cuántos cambios hay en ESTE momento

  const guardar = async () => {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await api.post<{ ok: boolean; error?: string; cambiados?: string[]; revision?: Revision }>(
        `/api/mapa-sistema/documentos/${encodeURIComponent(archivo)}/editar`,
        { cambios: Object.values(cambios), confirmar_publicado: confirmaPublicado },
      );
      if (!r.ok) throw new Error(r.error || "No se pudo guardar");
      if (r.revision) qc.setQueryData(["mision-doc-revision", archivo], r.revision);
      setCambios({});
      setEditando(false);
      setConfirmaPublicado(false);
      setAviso({ ok: true, texto: `Guardado: ${r.cambiados?.length ?? 0} campo${(r.cambiados?.length ?? 0) === 1 ? "" : "s"}. Quedó una copia de respaldo del documento anterior.` });
      await onGuardado?.();
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error)?.message || "No se pudo guardar" });
    } finally {
      setGuardando(false);
    }
  };

  const d = rev.data;
  const sec = d?.secciones.find((s) => s.id === pestana);
  const listo = d ? LISTO.has(d.estado) : false;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3" role="dialog" aria-modal="true" aria-label="Revisar documento técnico" onClick={cerrar}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl" onClick={(ev) => ev.stopPropagation()}>
        {/* Cabecera */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Documento técnico · para {combo}</p>
            <h3 className="truncate text-lg font-bold text-ink">{d?.titulo ?? "Abriendo…"}</h3>
            {d && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
                <span className={`rounded-full border px-2 py-px font-mono text-[10px] font-bold ${listo ? "border-accent-leaf/60 bg-accent-leaf/15 text-ink" : "border-accent-sun/60 bg-accent-sun/15 text-ink"}`}>{d.estado || "sin estado"}</span>
                <span>{d.referencia ? <>SKU <code className="text-ink">{[d.referencia, ...d.equivalentes].join(", ")}</code></> : <span className="text-accent-rose">sin SKU declarado</span>}</span>
                <code className="text-[10px]">{d.archivo}</code>
              </p>
            )}
          </div>
          {d && !editando && (
            <button onClick={() => { setEditando(true); setAviso(null); }} className="shrink-0 rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-bold text-white hover:opacity-90">Editar aquí</button>
          )}
          <button onClick={cerrar} aria-label="Cerrar" className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] text-ink hover:bg-surface-hover">Cerrar</button>
        </div>

        {rev.isLoading && <p className="p-6 text-sm text-muted">Leyendo el documento…</p>}
        {rev.isError && <p className="p-6 text-sm text-accent-rose">{(rev.error as Error)?.message || "No se pudo abrir el documento"}</p>}

        {d && (
          <>
            {/* Lo que impide publicarlo, primero */}
            {(d.pendientes.length > 0 || !listo) && (
              <div className="shrink-0 space-y-1.5 border-b border-border bg-accent-sun/10 px-4 py-2 text-[12px] text-ink">
                {d.pendientes.length === 0 && (
                  <p>
                    {d.estado === "borrador" ? "Es un borrador: está escrito pero nadie lo ha revisado ni firmado todavía." :
                     d.estado.startsWith("antigua") ? "Es una ficha antigua: solo trae la ficha técnica, le faltan el COA y la SDS." :
                     d.estado.startsWith("completo") ? "Tiene las tres partes diligenciadas, pero no está marcado como completo: por eso la web no lo publica." :
                     "Aún no está listo para publicarse."}
                  </p>
                )}
                {d.pendientes.map((p) => (
                  <details key={p.titulo} open={d.pendientes.length === 1}>
                    <summary className="cursor-pointer font-bold">{p.titulo} <span className="font-normal text-muted">({p.items.length})</span></summary>
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-4">{p.items.map((it, i) => <li key={i} className="list-disc">{it}</li>)}</ul>
                  </details>
                ))}
                {d.proveedor?.proveedor && <p className="text-[11px] text-muted">Última compra: {d.proveedor.proveedor}{d.proveedor.fecha ? ` · ${d.proveedor.fecha}` : ""}{d.proveedor.nombre_en_factura ? ` · «${d.proveedor.nombre_en_factura}»` : ""}</p>}
              </div>
            )}

            {/* Las partes del documento */}
            <div className="mck-flujo-nav flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2">
              {d.secciones.map((s) => (
                <button key={s.id} onClick={() => setPestana(s.id)} aria-pressed={pestana === s.id} disabled={!s.existe}
                  className={`mck-flujo-nodo shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-bold disabled:opacity-40 ${pestana === s.id ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink-secondary hover:border-accent/50"}`}>
                  {s.titulo}
                  {!s.existe ? <span className="ml-1.5 font-normal">no tiene</span> : s.vacios > 0 ? <span className={`ml-1.5 rounded-full px-1.5 text-[10px] font-normal ${pestana === s.id ? "bg-white/25" : "bg-surface text-muted"}`} title="Campos sin dato: algunos no aplican a este producto">{s.vacios} sin dato</span> : <span className="ml-1.5 text-[10px] font-normal opacity-80">completa</span>}
                  {s.firmado && <span className="ml-1.5 text-[10px] font-normal opacity-80">· firmada</span>}
                </button>
              ))}
              <button onClick={() => setPestana("fuentes")} aria-pressed={pestana === "fuentes"}
                className={`mck-flujo-nodo shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-bold ${pestana === "fuentes" ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink-secondary hover:border-accent/50"}`}>
                Fuentes <span className="ml-1 text-[10px] font-normal opacity-80">{d.fuentes.length}</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {pestana === "fuentes" ? (
                d.fuentes.length ? <ul className="space-y-1.5 text-[12.5px] text-ink">{d.fuentes.map((f, i) => <li key={i} className="flex gap-1.5"><span className="text-accent">·</span><span>{f}</span></li>)}</ul>
                  : <p className="text-[12.5px] text-muted">Este documento no anota de dónde salió su información.</p>
              ) : sec?.existe ? (
                sec.bloques.map((b, i) => <BloqueVista key={`${pestana}-${i}`} b={b} ed={ed} />)
              ) : (
                <p className="text-[12.5px] text-muted">El documento no tiene esta parte.</p>
              )}
            </div>
          </>
        )}

        {aviso && <p className={`shrink-0 border-t border-border px-4 py-1.5 text-[11.5px] ${aviso.ok ? "text-accent-leaf" : "text-accent-rose"}`}>{aviso.texto}</p>}
        {editando ? (
          <div className="shrink-0 space-y-2 border-t border-border bg-surface px-4 py-2.5">
            {d?.publicado && (
              <label className="flex items-start gap-2 rounded-md border border-accent-sun/60 bg-accent-sun/10 p-2 text-[11.5px] text-ink">
                <input type="checkbox" className="mt-0.5" checked={confirmaPublicado} onChange={(ev) => setConfirmaPublicado(ev.target.checked)} />
                <span><b>Este documento está publicado.</b> Lo que guardes se verá en la página web tal cual, y el PDF ya emitido no cambia hasta regenerarlo en Docs técnicos. Marca para confirmar.</span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={guardando || nCambios === 0 || Boolean(d?.publicado && !confirmaPublicado)} onClick={guardar}
                className="rounded-md border border-accent bg-accent px-3 py-1 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-40">
                {guardando ? "Guardando…" : nCambios ? `Guardar ${nCambios} cambio${nCambios === 1 ? "" : "s"}` : "Sin cambios todavía"}
              </button>
              <button className={BTN_SEC} disabled={guardando} onClick={() => { setCambios({}); setEditando(false); setConfirmaPublicado(false); }}>Descartar y dejar de editar</button>
              <span className="text-[10.5px] text-muted">Se corrigen valores; el nombre y el SKU no se cambian desde aquí. Cada guardado deja respaldo y anota quién cambió qué.</span>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2.5">
            {acciones}
            <span className="flex-1" />
            {d?.ediciones?.length ? <span className="text-[10.5px] text-muted" title={d.ediciones.map((x) => `${x.cuando} · ${x.quien} · ${x.campos.join(", ")}`).join("\n")}>Última edición: {d.ediciones[d.ediciones.length - 1].quien} · {d.ediciones[d.ediciones.length - 1].cuando.slice(0, 10)}</span> : null}
            <button className={BTN_SEC} onClick={cerrar}>Volver al combo</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
