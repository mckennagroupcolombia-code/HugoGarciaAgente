import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAuthBlobUrl } from "../api/client";
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

type Pestana = "ficha" | "etiqueta" | "ean" | "png" | "fotos";
type Estado = Eslabon["estado"];
const CLAVE_REF = "mck-espacio-producto-ref";
const CLAVE_PESTANA = "mck-espacio-producto-pestana";

type Recurso = { nombre: string; subido_at?: string; thumb_b64?: string; thumb_mime?: string };
type Canal = "meli" | "web";
type Foto = { archivo: string; subido_at: string; por?: string; ancho?: number; alto?: number; miniatura?: string };
type ResumenFotos = Record<string, Partial<Record<Canal, number>>>;
const CANALES: { id: Canal; titulo: string }[] = [
  { id: "meli", titulo: "Mercado Libre" },
  { id: "web", titulo: "Página web" },
];

/** PNG de «Terminar y aprobar»: los dos (impresión y digital), uno o ninguno. */
function estadoPng(c: Combo): Estado {
  const e = c.eslabones.etiqueta;
  const n = Number(Boolean(e?.png)) + Number(Boolean(e?.png_digital));
  return n === 2 ? "ok" : n === 1 ? "aviso" : "falta";
}

/** Fotos y mockups: con foto en los dos canales, en uno o en ninguno. */
function estadoFotos(ref: string, resumen: ResumenFotos | undefined): Estado {
  const r = resumen?.[ref.toUpperCase()] ?? {};
  const n = Number((r.meli ?? 0) > 0) + Number((r.web ?? 0) > 0);
  return n === 2 ? "ok" : n === 1 ? "aviso" : "falta";
}

/** Punto de estado. Lo que falta titila en rojo: es lo que hay que ir a resolver. */
function Punto({ estado, titulo, grande }: { estado: Estado; titulo?: string; grande?: boolean }) {
  const tam = grande ? "h-2.5 w-2.5" : "h-2 w-2";
  return (
    <span
      title={titulo}
      className={`${tam} shrink-0 rounded-full ${estado === "falta" ? "mck-titila-rojo" : PUNTO[estado]}`}
    />
  );
}

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
  const fotosQ = useQuery({
    queryKey: ["fotos-producto-resumen"],
    queryFn: () => api.get<{ resumen: ResumenFotos }>("/api/mapa-sistema/fotos-producto"),
    staleTime: 30_000,
    retry: false,
  });
  const resumenFotos = fotosQ.data?.resumen;

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
                  <Punto
                    key={k}
                    grande
                    estado={c.eslabones[k]?.estado ?? "falta"}
                    titulo={`${c.eslabones[k]?.titulo ?? k}: ${c.eslabones[k]?.detalle ?? ""}`}
                  />
                ))}
                <Punto grande estado={estadoPng(c)} titulo="PNG aprobados (impresión y digital)" />
                {resumenFotos && <Punto grande estado={estadoFotos(c.ref, resumenFotos)} titulo="Fotos y mockups (Mercado Libre y web)" />}
              </button>
            </li>
          ))}
          {visibles.length === 0 && <li className="px-3 py-4 text-sm text-muted">Ningún producto coincide.</li>}
        </ul>
        <p className="text-[11px] text-muted">
          Puntos: documento técnico · etiqueta · código EAN · PNG aprobados · fotos y mockups (verde completo, ámbar a
          medias; lo que falta titila en rojo).
        </p>
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
  const PESTANAS: { id: Pestana; titulo: string; estado?: Estado; detalle?: string }[] = [
    { id: "ficha", titulo: "Ficha técnica", estado: doc?.estado ?? "falta", detalle: doc?.detalle },
    { id: "etiqueta", titulo: "Etiqueta", estado: eti?.estado ?? "falta", detalle: eti?.detalle },
    { id: "ean", titulo: "Código EAN", estado: ean?.estado ?? "falta", detalle: ean?.detalle },
    { id: "png", titulo: "PNG aprobados", estado: estadoPng(combo), detalle: "Impresión y digital de «Terminar y aprobar»" },
    {
      id: "fotos",
      titulo: "Fotos y mockups",
      estado: resumenFotos ? estadoFotos(combo.ref, resumenFotos) : undefined,
      detalle: "Una foto o mockup por canal: Mercado Libre y página web",
    },
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
              title={p.detalle ? `${p.titulo}: ${p.detalle}` : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                pestana === p.id ? "bg-accent text-white" : "text-ink hover:bg-surface-hover"
              }`}
            >
              {p.estado && <Punto estado={p.estado} />}
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
          {pestana === "fotos" && <FotosProducto combo={combo} />}
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
              <p className="mck-titila-rojo-borde rounded-lg border border-dashed border-border p-4 text-[12px] text-muted">
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

function imagenesDelPortapapeles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  if (!out.length) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith("image/")) out.push(f);
  return out;
}

/** Fotos y mockups hechos por fuera (estudio, Canva, Photoshop), por canal de venta.
 *  Se guardan como los PNG aprobados de las etiquetas —misma biblioteca, carpeta
 *  FOTOS PRODUCTO/<canal>— y se agregan solo con Ctrl+C en el programa y Ctrl+V aquí:
 *  lo pegado va a la columna seleccionada. Guardar no publica nada en MeLi ni en la web. */
function FotosProducto({ combo }: { combo: Combo }) {
  const qc = useQueryClient();
  const ruta = `/api/mapa-sistema/fotos-producto/${encodeURIComponent(combo.ref)}`;
  const q = useQuery({
    queryKey: ["fotos-producto", combo.ref],
    queryFn: () => api.get<{ canales: Record<Canal, Foto[]> }>(ruta),
    staleTime: 15_000,
  });
  const [destino, setDestino] = useState<Canal>("meli");
  const [subiendo, setSubiendo] = useState(0);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ampliada, setAmpliada] = useState<{ url: string; nombre: string } | null>(null);
  useEffect(() => setAviso(null), [combo.ref]);

  const subir = useCallback(
    async (files: File[], canal: Canal) => {
      if (!files.length) return;
      setAviso(null);
      setSubiendo((n) => n + files.length);
      let ok = 0;
      const errores: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append("canal", canal);
        form.append("archivo", f, f.name || "pegado.png");
        try {
          await api.upload(ruta, form, { timeoutMs: 60_000 });
          ok += 1;
        } catch (e) {
          errores.push((e as Error).message || "No se pudo guardar");
        } finally {
          setSubiendo((n) => n - 1);
        }
      }
      void qc.invalidateQueries({ queryKey: ["fotos-producto", combo.ref] });
      void qc.invalidateQueries({ queryKey: ["fotos-producto-resumen"] });
      const titulo = CANALES.find((c) => c.id === canal)?.titulo;
      setAviso(
        errores.length
          ? { ok: false, texto: `${ok ? `${ok} guardada(s); ` : ""}${errores[0]}` }
          : { ok: true, texto: `${ok === 1 ? "Imagen guardada" : `${ok} imágenes guardadas`} en ${titulo}.` },
      );
    },
    [combo.ref, qc, ruta],
  );

  useEffect(() => {
    const alPegar = (ev: ClipboardEvent) => {
      const files = imagenesDelPortapapeles(ev.clipboardData);
      if (!files.length) return;
      ev.preventDefault();
      void subir(files, destino);
    };
    window.addEventListener("paste", alPegar);
    return () => window.removeEventListener("paste", alPegar);
  }, [subir, destino]);

  // Para celular o si el teclado no está a mano: el mismo pegado, leyendo el portapapeles.
  const pegarConBoton = async (canal: Canal) => {
    setDestino(canal);
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items) {
        const tipo = it.types.find((t) => t.startsWith("image/"));
        if (tipo) files.push(new File([await it.getType(tipo)], `pegado.${tipo.split("/")[1]}`, { type: tipo }));
      }
      if (!files.length) setAviso({ ok: false, texto: "En el portapapeles no hay ninguna imagen. Cópiala primero (Ctrl+C)." });
      else void subir(files, canal);
    } catch {
      setAviso({ ok: false, texto: "El navegador no dejó leer el portapapeles: selecciona la columna y pega con Ctrl+V." });
    }
  };

  const ampliar = async (canal: Canal, f: Foto) => {
    const url = await fetchAuthBlobUrl(`${ruta}/archivo?canal=${canal}&archivo=${encodeURIComponent(f.archivo)}`);
    if (url) setAmpliada({ url, nombre: f.archivo });
    else setAviso({ ok: false, texto: "No se pudo abrir la imagen." });
  };
  const cerrar = () => {
    if (ampliada) URL.revokeObjectURL(ampliada.url);
    setAmpliada(null);
  };
  const quitar = async (canal: Canal, f: Foto) => {
    if (!window.confirm("¿Quitar esta imagen del producto? Queda guardada en una papelera.")) return;
    try {
      await api.delete(`${ruta}?canal=${canal}&archivo=${encodeURIComponent(f.archivo)}`);
      void qc.invalidateQueries({ queryKey: ["fotos-producto", combo.ref] });
      void qc.invalidateQueries({ queryKey: ["fotos-producto-resumen"] });
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message || "No se pudo quitar" });
    }
  };

  if (q.isLoading) return <p className="p-6 text-sm text-muted">Buscando fotos…</p>;
  if (q.isError) return <p className="p-6 text-sm text-red-600">{(q.error as Error)?.message || "No se pudieron leer las fotos."}</p>;
  const canales = q.data?.canales ?? { meli: [], web: [] };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-3 text-[12.5px] text-muted">
        Copia la foto o el mockup en el programa donde lo hiciste (<kbd className="font-mono">Ctrl+C</kbd>), toca la
        columna del canal y pégalo aquí con <kbd className="font-mono">Ctrl+V</kbd>. Guardarla no la publica en Mercado
        Libre ni en la web.
      </p>
      {(subiendo > 0 || aviso) && (
        <p
          role="status"
          className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-semibold ${
            subiendo > 0 ? "bg-surface-panel text-ink" : aviso?.ok ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"
          }`}
        >
          {subiendo > 0 ? `Guardando ${subiendo} imagen(es)…` : aviso?.texto}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {CANALES.map((c) => {
          const lista = canales[c.id] ?? [];
          const activo = destino === c.id;
          return (
            <section
              key={c.id}
              onClick={() => setDestino(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setDestino(c.id);
                void subir(imagenesDelPortapapeles(e.dataTransfer), c.id);
              }}
              className={`cursor-pointer rounded-xl border-2 p-3 ${activo ? "border-accent bg-accent/5" : "border-border bg-surface-panel"} ${
                lista.length === 0 ? "mck-titila-rojo-borde" : ""
              }`}
            >
              <header className="mb-2 flex items-center gap-2">
                <Punto estado={lista.length ? "ok" : "falta"} />
                <h2 className="text-sm font-bold text-ink">{c.titulo}</h2>
                <span className="text-[11px] text-muted">{lista.length} imagen(es)</span>
                <span className={`ml-auto text-[11px] font-semibold ${activo ? "text-accent" : "text-muted"}`}>
                  {activo ? "Ctrl+V pega aquí" : "Toca para pegar aquí"}
                </span>
              </header>
              {lista.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-[12px] text-muted">
                  Sin fotos ni mockups para {c.titulo}.
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void pegarConBoton(c.id);
                    }}
                    className="mt-2 block w-full text-[12px] font-semibold text-accent hover:underline"
                  >
                    Pegar desde el portapapeles
                  </button>
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {lista.map((f, i) => {
                    const chica = c.id === "meli" && f.ancho && f.alto && Math.min(f.ancho, f.alto) < 500;
                    return (
                      <li key={f.archivo} className="rounded-lg border border-border bg-surface p-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void ampliar(c.id, f);
                          }}
                          className="block w-full"
                          title="Ver en grande"
                        >
                          {f.miniatura ? (
                            <img src={`data:image/jpeg;base64,${f.miniatura}`} alt="" className="aspect-square w-full rounded bg-white object-contain" />
                          ) : (
                            <span className="block aspect-square w-full rounded bg-surface-hover" />
                          )}
                        </button>
                        <p className="mt-1 truncate text-[10.5px] text-muted" title={f.archivo}>
                          {i === 0 ? "La más reciente · " : ""}
                          {f.ancho && f.alto ? `${f.ancho}×${f.alto}` : ""}
                        </p>
                        <p className="truncate text-[10.5px] text-muted">
                          {new Date(f.subido_at).toLocaleDateString("es-CO")}
                          {f.por ? ` · ${f.por}` : ""}
                        </p>
                        {chica && <p className="text-[10.5px] font-semibold text-amber-600">MeLi pide mínimo 500 px</p>}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void quitar(c.id, f);
                          }}
                          className="mt-0.5 text-[10.5px] text-red-600 hover:underline"
                        >
                          Quitar
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {ampliada && (
        <div className="fixed inset-0 z-[600] flex flex-col items-center justify-center gap-3 bg-black/70 p-6" onClick={cerrar}>
          <img src={ampliada.url} alt="" className="max-h-[85vh] max-w-full rounded bg-white" />
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <a href={ampliada.url} download={ampliada.nombre} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white">
              Descargar
            </a>
            <button type="button" onClick={cerrar} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
