import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import type { Combo, Eslabon, Respuesta } from "./combos/comun";
import { cargarPatchDesdeFichaTecnica } from "../lib/fichaTecnicaAplicar";
import { fotoFicha } from "../lib/fichaTecnicaSync";

/**
 * Espacio de producto: todo lo que respalda UNA presentación de venta (combo
 * C-…) en una sola pantalla. Antes el trabajo de un producto saltaba entre
 * dos secciones del menú —Diseño (Studio visual, Códigos EAN, Imprimir) y
 * Docs técnicos— buscando el mismo producto en cada una.
 *
 * Se elige el producto una vez y cada pestaña es el apartado de siempre, ya
 * abierto en él: el editor de Docs técnicos, el editor de etiquetas del
 * Studio, Códigos EAN filtrado y los PNG aprobados. No nace otra forma de
 * escribir: el documento, la etiqueta y el EAN se unen como los une el Mapa
 * del sistema (`/api/mapa-sistema/combos`), la misma fuente que el taller.
 */

const FichasTecnicasPanel = lazy(() => import("./FichasTecnicasPanel"));
const ProductLabelForm = lazy(() => import("./etiqueta-ficha/ProductLabelForm"));
const CodigosEanPanel = lazy(() =>
  import("./etiquetas/CodigosEanPanel").then((m) => ({ default: m.CodigosEanPanel })),
);

type Pestana = "ficha" | "etiqueta" | "ean" | "png";
const CLAVE_REF = "mck-espacio-producto-ref";
const CLAVE_PESTANA = "mck-espacio-producto-pestana";

type Recurso = { nombre: string; subido_at?: string; thumb_b64?: string; thumb_mime?: string };

function leer(clave: string): string {
  try {
    return localStorage.getItem(clave) || "";
  } catch {
    return "";
  }
}
function guardar(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: solo no se recuerda */
  }
}

/** Letras y números en mayúscula, sin tildes: «SEMILLA DE CHÍA 500g» y
 *  «SEMILLA_DE_CHIA_500g_digital_2.png» quedan comparables. */
function clave(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Nombre del PNG sin carpeta, extensión ni sufijos «_digital» / «_2». */
function baseDePng(nombre: string): string {
  const archivo = nombre.split("/").pop() || nombre;
  return clave(archivo.replace(/\.png$/i, "").replace(/(_digital)?(_\d+)?$/i, "").replace(/_digital$/i, ""));
}

const PUNTO: Record<Eslabon["estado"], string> = {
  ok: "bg-emerald-500",
  aviso: "bg-amber-400",
  falta: "bg-red-400",
};

export default function EspacioProductoPanel() {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const setEanPrefill = useAppStore((s) => s.setEanPrefill);
  const combosQ = useQuery({
    queryKey: ["mapa-sistema-combos"],
    queryFn: () => api.get<Respuesta>("/api/mapa-sistema/combos"),
    staleTime: 60_000,
    retry: false,
  });
  const combos = useMemo(() => combosQ.data?.combos ?? [], [combosQ.data]);

  const [ref, setRef] = useState(() => leer(CLAVE_REF));
  const [pestana, setPestana] = useState<Pestana>(() => (leer(CLAVE_PESTANA) as Pestana) || "ficha");
  const [eligiendo, setEligiendo] = useState(!leer(CLAVE_REF));
  const [q, setQ] = useState("");
  /** Foto de la ficha técnica al entrar a editarla: si la etiqueta aún no guarda
   *  la suya, con esta se sabe qué se cambió y se pasa sola a la etiqueta. */
  const [fichaAntes, setFichaAntes] = useState<{ id: string; foto: Record<string, string> } | null>(null);

  const combo = combos.find((c) => c.ref === ref) ?? null;

  const elegir = (c: Combo) => {
    setRef(c.ref);
    guardar(CLAVE_REF, c.ref);
    setEligiendo(false);
    setQ("");
    setFichaAntes(null);
  };
  const irA = (p: Pestana) => {
    if (p === "ficha" && pestana !== "ficha" && combo?.eslabones.documento?.archivo) {
      const id = combo.eslabones.documento.archivo.replace(/\.ya?ml$/i, "");
      void cargarPatchDesdeFichaTecnica(id)
        .then((patch) => setFichaAntes({ id, foto: fotoFicha(patch) }))
        .catch(() => setFichaAntes(null));
    }
    if (pestana === "ficha" && p !== "ficha") {
      // El documento pudo cambiar de estado (borrador → listo): refrescar las fichas de estado.
      void api.post("/api/mapa-sistema/invalidar").catch(() => null).then(() => qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] }));
    }
    // Sin código: el formulario de alta ya escrito con este SKU (igual que el taller). Con
    // código solo se filtra la lista: precargar el alta invitaría a registrarle un segundo.
    if (p === "ean" && combo && combo.eslabones.ean?.estado !== "ok") setEanPrefill({ sku: combo.ref, nombre: combo.nombre });
    setPestana(p);
    guardar(CLAVE_PESTANA, p);
  };

  const visibles = useMemo(() => {
    const k = clave(q);
    const lista = k ? combos.filter((c) => clave(`${c.nombre} ${c.ref}`).includes(k)) : combos;
    return lista.slice(0, 80);
  }, [combos, q]);

  if (combosQ.isLoading) return <p className="p-6 text-sm text-muted">Cargando productos…</p>;
  if (combosQ.isError)
    return (
      <p className="p-6 text-sm text-red-600">
        {(combosQ.error as Error)?.message || "No se pudieron leer los productos"}. El espacio usa el Mapa del sistema:
        pide el permiso «Espacio de producto» o «Combos».
      </p>
    );

  if (eligiendo || !combo) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-2">
        <div>
          <h1 className="text-lg font-bold text-ink">Espacio de producto</h1>
          <p className="text-[12.5px] text-muted">
            Elige la presentación una vez y trabaja su ficha técnica, su etiqueta, su código EAN y sus PNG en un solo lugar.
          </p>
        </div>
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto o SKU (p. ej. chía 500)…"
          aria-label="Buscar producto"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-panel">
          {visibles.map((c) => (
            <li key={c.ref}>
              <button
                type="button"
                onClick={() => elegir(c)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{c.nombre}</span>
                  <span className="font-mono text-[11px] text-muted">{c.ref}</span>
                </span>
                {(["documento", "etiqueta", "ean"] as const).map((k) => (
                  <span
                    key={k}
                    title={`${c.eslabones[k]?.titulo ?? k}: ${c.eslabones[k]?.detalle ?? ""}`}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${PUNTO[c.eslabones[k]?.estado ?? "falta"]}`}
                  />
                ))}
              </button>
            </li>
          ))}
          {visibles.length === 0 && <li className="px-3 py-4 text-sm text-muted">Ningún producto coincide.</li>}
        </ul>
        <p className="text-[11px] text-muted">Puntos: documento técnico · etiqueta · código EAN (verde completo, ámbar a medias, rojo falta).</p>
        {combo && (
          <button type="button" onClick={() => setEligiendo(false)} className="text-[12px] text-accent hover:underline">
            ← Volver a {combo.nombre}
          </button>
        )}
      </div>
    );
  }

  const doc = combo.eslabones.documento;
  const eti = combo.eslabones.etiqueta;
  const ean = combo.eslabones.ean;
  const PESTANAS: { id: Pestana; titulo: string; e?: Eslabon }[] = [
    { id: "ficha", titulo: "Ficha técnica", e: doc },
    { id: "etiqueta", titulo: "Etiqueta", e: eti },
    { id: "ean", titulo: "Código EAN", e: ean },
    { id: "png", titulo: "PNG aprobados" },
  ];

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-[560px] flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Espacio de producto · {combo.ref}</p>
          <h1 className="truncate text-base font-bold text-ink">{combo.nombre}</h1>
        </div>
        <button
          type="button"
          onClick={() => setEligiendo(true)}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-hover"
        >
          Cambiar producto
        </button>
        <div role="tablist" aria-label="Partes del producto" className="ml-auto flex flex-wrap gap-1 rounded-xl border border-border bg-surface-panel p-1">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              onClick={() => irA(p.id)}
              title={p.e ? `${p.e.titulo}: ${p.e.detalle}` : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                pestana === p.id ? "bg-accent text-white" : "text-ink hover:bg-surface-hover"
              }`}
            >
              {p.e && <span className={`h-2 w-2 rounded-full ${PUNTO[p.e.estado]}`} />}
              {p.titulo}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo…</p>}>
          {pestana === "ficha" &&
            (doc?.archivo ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <FichasTecnicasPanel key={doc.archivo} archivoInicial={doc.archivo} />
              </div>
            ) : (
              <SinPieza
                texto={doc?.detalle || "Este producto todavía no tiene documento técnico unido."}
                accion="Buscarlo o redactarlo en Docs técnicos"
                onAccion={() => setPanel("fichas")}
              />
            ))}
          {pestana === "etiqueta" && (
            <ProductLabelForm
              key={`${combo.ref}-${eti?.etiqueta_id ?? "nueva"}`}
              entrada={eti?.etiqueta_id ? { fichaId: eti.etiqueta_id } : { sku: combo.ref }}
              onVolver={() => setEligiendo(true)}
              onAbrirFichaTecnica={doc?.archivo ? () => irA("ficha") : undefined}
              fichaAntes={fichaAntes}
            />
          )}
          {pestana === "ean" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <CodigosEanPanel buscarInicial={ean?.estado === "ok" ? combo.ref : ""} />
            </div>
          )}
          {pestana === "png" && <PngAprobados combo={combo} />}
        </Suspense>
      </div>
    </div>
  );
}

function SinPieza({ texto, accion, onAccion }: { texto: string; accion: string; onAccion: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-md text-sm text-muted">{texto}</p>
      <button type="button" onClick={onAccion} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
        {accion}
      </button>
    </div>
  );
}

/** Los PNG aprobados de este producto: impresión (Diseño → Imprimir) y su
 *  versión digital desenfocada. Se reconocen por el nombre del archivo, que
 *  nace del título del código de barras de la etiqueta. */
function PngAprobados({ combo }: { combo: Combo }) {
  const carpetas = ["ETIQUETAS STUDIO", "PUBLICACIONES DIGITALES"] as const;
  const qs = useQuery({
    queryKey: ["espacio-producto-png"],
    queryFn: async () => {
      const r = await Promise.all(
        carpetas.map((c) =>
          api.get<{ recursos: Recurso[] }>(`/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(c)}&recursivo=1`),
        ),
      );
      return r.map((x) => x.recursos ?? []);
    },
    staleTime: 15_000,
  });
  const [ampliada, setAmpliada] = useState<string | null>(null);
  useEffect(() => setAmpliada(null), [combo.ref]);

  const objetivo = clave(combo.nombre);
  const filtrar = (lista: Recurso[]) =>
    lista
      .filter((r) => baseDePng(r.nombre) === objetivo)
      .sort((a, b) => (b.subido_at || "").localeCompare(a.subido_at || ""));

  if (qs.isLoading) return <p className="p-6 text-sm text-muted">Buscando PNG…</p>;
  if (qs.isError) return <p className="p-6 text-sm text-red-600">No se pudo leer la biblioteca de PNG.</p>;
  const [impresion, digital] = (qs.data ?? [[], []]).map(filtrar);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { titulo: "Para imprimir", sub: "Diseño → Imprimir", lista: impresion },
          { titulo: "Digital, desenfocado", sub: "Publicaciones digitales", lista: digital },
        ].map((g) => (
          <section key={g.titulo}>
            <h2 className="text-sm font-bold text-ink">{g.titulo}</h2>
            <p className="mb-2 text-[11px] text-muted">{g.sub}</p>
            {g.lista.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-[12px] text-muted">
                Ninguno aprobado. Se aprueban en la pestaña Etiqueta con «Terminar y aprobar».
              </p>
            ) : (
              <ul className="space-y-2">
                {g.lista.map((r, i) => (
                  <li key={r.nombre} className="flex items-center gap-3 rounded-lg border border-border bg-surface-panel p-2">
                    {r.thumb_b64 ? (
                      <button type="button" onClick={() => setAmpliada(`data:${r.thumb_mime || "image/png"};base64,${r.thumb_b64}`)} className="shrink-0">
                        <img src={`data:${r.thumb_mime || "image/png"};base64,${r.thumb_b64}`} alt="" className="h-14 w-20 rounded bg-white object-contain" />
                      </button>
                    ) : (
                      <span className="h-14 w-20 shrink-0 rounded bg-surface-hover" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-ink" title={r.nombre}>
                        {r.nombre.split("/").pop()}
                      </span>
                      <span className="text-[11px] text-muted">
                        {r.subido_at ? new Date(r.subido_at).toLocaleString("es-CO") : ""}
                        {i === 0 && g.lista.length > 1 ? " · el más reciente" : ""}
                        {i > 0 ? " · versión anterior" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {ampliada && (
        <button type="button" onClick={() => setAmpliada(null)} className="fixed inset-0 z-[600] flex items-center justify-center bg-black/60 p-6" aria-label="Cerrar">
          <img src={ampliada} alt="" className="max-h-full max-w-full rounded bg-white" />
        </button>
      )}
    </div>
  );
}
