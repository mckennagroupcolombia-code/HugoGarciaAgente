import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../../stores/app";
import { calcCheck, generarEAN13 } from "../../lib/ean13";
import {
  BIMESTRE_LABEL,
  construirCodigo12,
  mesABimestre,
  siguienteNumeroProductoDisponible,
  sugerirPresentacionEan,
  useActualizarCodigoEan,
  useCodigosEan,
  useCrearCodigoEan,
  useEliminarCodigoEan,
  useImportarCombosEanSiigo,
  useSincronizarBarcodesEanSiigo,
  useEnlacesEanAlegra,
  useCargarEanEnAlegra,
  type EnlaceEanAlegra,
  type CodigoEan,
} from "../../lib/etiquetasCodigosEan";
import { Banner, Button, Card, IconButton, Modal, Spinner } from "./ui";
import { FotosProductoEanModal, MiniaturaFotoEan } from "./FotosProductoEan";

const CrearProductosSiigoPanel = lazy(() => import("../CrearProductosSiigoPanel"));

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function anioActualCorto(): number {
  return new Date().getFullYear() % 100;
}

/** Prefijo estándar de los SKU de combos Alegra (C-ACIASC250g, C-UREA500g…). */
const SKU_PREFIJO = "C-";

function sinPrefijoSku(sku: string): string {
  return sku.replace(/^c-\s*/i, "");
}

/** SKU tal como se guarda: con el prefijo de combo o exactamente lo escrito. */
function skuFinal(usarPrefijo: boolean, sku: string): string {
  const base = sku.trim();
  return usarPrefijo ? SKU_PREFIJO + sinPrefijoSku(base) : base;
}

/** Quita tildes para buscar «karite» ≈ «karité». */
function normBusqueda(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function coincideCodigoEan(c: CodigoEan, q: string): boolean {
  const t = normBusqueda(q);
  if (!t) return true;
  const blob = normBusqueda(
    [c.nombre_producto, c.sku, c.codigo, String(c.numero_producto).padStart(3, "0")].join(" "),
  );
  // Todas las palabras del query deben aparecer (orden libre).
  return t.split(/\s+/).filter(Boolean).every((palabra) => blob.includes(palabra));
}

export function CodigosEanPanel({ buscarInicial = "" }: {
  /** Abre la lista ya filtrada (p. ej. el SKU de un combo que ya tiene código, desde el taller). */
  buscarInicial?: string;
} = {}) {
  const { data: codigos, isLoading, error } = useCodigosEan();
  const crear = useCrearCodigoEan();
  const eliminar = useEliminarCodigoEan();
  const importarSiigo = useImportarCombosEanSiigo();
  const syncBarcodeSiigo = useSincronizarBarcodesEanSiigo();
  const enlacesAlegra = useEnlacesEanAlegra();
  const cargarAlegra = useCargarEanEnAlegra();
  const actualizarCodigo = useActualizarCodigoEan();
  const qc = useQueryClient();
  const enlacePorId = new Map((enlacesAlegra.data?.enlaces ?? []).map((e) => [e.id, e]));
  const cargaAlegra = enlacesAlegra.data?.ultima;
  const sinEnlace = (enlacesAlegra.data?.enlaces ?? []).filter((e) => e.estado !== "enlazado");

  const [filaEditandoId, setFilaEditandoId] = useState<string | null>(null);
  const [filaSeleccionadaId, setFilaSeleccionadaId] = useState<string | null>(null);
  /** Código cuyas fotos se están administrando (emergente). */
  const [fotosDe, setFotosDe] = useState<CodigoEan | null>(null);
  const [crearSiigoAbierto, setCrearSiigoAbierto] = useState(false);
  const [accionSiigo, setAccionSiigo] = useState<"crear" | "duplicar" | "ajustar">("crear");
  const [siigoInicial, setSiigoInicial] = useState<{ codigo: string; nombre: string } | null>(null);
  /** Código EAN al que se asocia el combo que se crea o duplica en la ventana de Alegra. */
  const [filaCombo, setFilaCombo] = useState<CodigoEan | null>(null);
  const [busquedaLista, setBusquedaLista] = useState(buscarInicial);
  const [sku, setSku] = useState("");
  /** El prefijo «C-» es el de los combos: se puede apagar para SKU que no lo llevan. */
  const [usarPrefijo, setUsarPrefijo] = useState(true);
  const [nombreProducto, setNombreProducto] = useState("");
  const [numeroProducto, setNumeroProducto] = useState("");
  const [presentacion, setPresentacion] = useState("000");
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(anioActualCorto());
  /** Si el usuario edita presentación a mano, no sobrescribirla al cambiar SKU. */
  const presentacionManual = useRef(false);

  const guardando = crear.isPending;
  const errorGuardar = crear.error;
  const huboError = crear.isError;

  // Menor número libre (rellena huecos de códigos eliminados).
  const siguienteNumero = useMemo(() => {
    return siguienteNumeroProductoDisponible(codigos ?? []) ?? 901;
  }, [codigos]);

  const huecosLibres = useMemo(() => {
    const usados = new Set(
      (codigos ?? [])
        .map((c) => Number(c.numero_producto))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 900),
    );
    if (usados.size === 0) return 0;
    const maxUsado = Math.max(...usados);
    let libres = 0;
    for (let n = 1; n <= maxUsado; n++) {
      if (!usados.has(n)) libres += 1;
    }
    return libres;
  }, [codigos]);

  // Autocompletar el consecutivo al abrir y tras cada registro; si el usuario
  // borra el campo para escribir otro número, no se vuelve a rellenar solo.
  const autoFillHecho = useRef(false);
  useEffect(() => {
    if (!codigos || autoFillHecho.current) return;
    if (numeroProducto === "" && siguienteNumero <= 900) {
      setNumeroProducto(String(siguienteNumero));
      autoFillHecho.current = true;
    }
  }, [codigos, siguienteNumero, numeroProducto]);

  // Llega desde Inventario → Combos con el combo ya elegido: se escribe en el formulario
  // y el número y la presentación se proponen solos (los dos efectos de alrededor).
  const eanPrefill = useAppStore((s) => s.eanPrefill);
  const setEanPrefill = useAppStore((s) => s.setEanPrefill);
  useEffect(() => {
    if (!eanPrefill) return;
    presentacionManual.current = false;
    const traePrefijo = eanPrefill.sku.trim().toUpperCase().startsWith(SKU_PREFIJO);
    setUsarPrefijo(traePrefijo);
    setSku(traePrefijo ? sinPrefijoSku(eanPrefill.sku) : eanPrefill.sku.trim());
    setNombreProducto(eanPrefill.nombre);
    setEanPrefill(null);
  }, [eanPrefill, setEanPrefill]);

  // Sugerir presentación (kg→001, 50→050, 100→100…) al escribir SKU/nombre.
  useEffect(() => {
    if (presentacionManual.current) return;
    const sugerida = sugerirPresentacionEan(skuFinal(usarPrefijo, sku), nombreProducto);
    setPresentacion(sugerida);
  }, [sku, usarPrefijo, nombreProducto]);

  const numeroValido = /^\d+$/.test(numeroProducto) && Number(numeroProducto) >= 1 && Number(numeroProducto) <= 900;
  const numeroDuplicado = useMemo(
    () =>
      numeroValido &&
      (codigos ?? []).some((c) => c.numero_producto === Number(numeroProducto)),
    [codigos, numeroProducto, numeroValido],
  );
  const bimestre = mesABimestre(mes);

  const preview = useMemo(() => {
    if (!numeroValido) return null;
    const d12 = construirCodigo12(Number(numeroProducto), presentacion, anio, bimestre);
    const check = calcCheck(d12);
    return generarEAN13(`${d12}${check}`);
  }, [numeroValido, numeroProducto, presentacion, anio, bimestre]);

  const listaFiltrada = useMemo(
    () => (codigos ?? []).filter((c) => coincideCodigoEan(c, busquedaLista)),
    [codigos, busquedaLista],
  );

  const seleccionado = useMemo(
    () => (codigos ?? []).find((c) => c.id === filaSeleccionadaId) ?? null,
    [codigos, filaSeleccionadaId],
  );

  const puedeGuardar = sku.trim().length > 0 && numeroValido && !numeroDuplicado && !guardando;

  function duplicar(c: CodigoEan) {
    presentacionManual.current = true;
    setSku(sinPrefijoSku(c.sku));
    setNombreProducto(c.nombre_producto || "");
    setNumeroProducto(siguienteNumero <= 900 ? String(siguienteNumero) : "");
    setPresentacion(c.presentacion);
    setMes(c.bimestre * 2 + 1);
    setAnio(c.anio % 100);
  }

  function onSkuChange(valor: string) {
    presentacionManual.current = false;
    setSku(usarPrefijo ? sinPrefijoSku(valor) : valor);
  }

  function alternarPrefijo() {
    presentacionManual.current = false;
    const siguiente = !usarPrefijo;
    setUsarPrefijo(siguiente);
    // Al encenderlo se quita un «C-» que el usuario hubiera escrito a mano (no se duplica).
    if (siguiente) setSku((s) => sinPrefijoSku(s));
  }

  function onNombreChange(valor: string) {
    presentacionManual.current = false;
    setNombreProducto(valor);
  }

  function onProductoSiigoCreado(info: { codigo: string; nombre: string }) {
    setCrearSiigoAbierto(false);
    setSiigoInicial(null);
    const fila = filaCombo;
    setFilaCombo(null);
    if (fila) {
      // Asociar: si el combo quedó con otro SKU, la fila del EAN pasa a llevar ese SKU;
      // luego se vuelve a verificar la columna «Alegra» (el catálogo local ya lo tiene).
      // Un producto (sin «C-») es el producto base del combo, nunca el SKU del EAN.
      const refrescar = () => void qc.invalidateQueries({ queryKey: ["etiquetas-codigos-ean-alegra"] });
      const esCombo = info.codigo.trim().toUpperCase().startsWith("C-");
      if (esCombo && info.codigo.trim() !== fila.sku.trim()) {
        actualizarCodigo.mutate(
          {
            id: fila.id,
            datos: {
              sku: info.codigo.trim(),
              nombre_producto: fila.nombre_producto || info.nombre,
              numero_producto: fila.numero_producto,
              presentacion: fila.presentacion,
              anio: fila.anio,
              mes: fila.bimestre * 2 + 1,
            },
          },
          { onSettled: refrescar },
        );
      } else {
        refrescar();
      }
      return;
    }
    if (info.codigo.toUpperCase().startsWith("C-")) {
      onSkuChange(info.codigo);
      onNombreChange(info.nombre);
    }
  }

  /** «Crear producto combo» sin fila elegida: con el SKU y el nombre del formulario de
   *  arriba (o vacío, en modo combo); al crearlo, el SKU queda en el formulario. */
  function abrirCrearCombo() {
    if (seleccionado) {
      abrirCrearSiigo("crear", seleccionado);
      return;
    }
    const escrito = sku.trim() ? skuFinal(usarPrefijo, sku) : "";
    setAccionSiigo("crear");
    setFilaCombo(null);
    setSiigoInicial({ codigo: escrito.toUpperCase().startsWith("C-") ? escrito : "C-", nombre: nombreProducto.trim() });
    setCrearSiigoAbierto(true);
  }

  function abrirCrearSiigo(accion: "crear" | "duplicar" = "crear", fila: CodigoEan | null = seleccionado) {
    if (!fila) return;
    setAccionSiigo(accion);
    setFilaCombo(fila);
    setSiigoInicial({
      codigo: fila.sku,
      nombre: fila.nombre_producto || "",
    });
    setCrearSiigoAbierto(true);
  }

  function cerrarCrearSiigo() {
    // Tras revisar o ajustar un combo, la columna «Alegra» se vuelve a verificar.
    if (filaCombo) void qc.invalidateQueries({ queryKey: ["etiquetas-codigos-ean-alegra"] });
    setCrearSiigoAbierto(false);
    setSiigoInicial(null);
    setFilaCombo(null);
  }

  /** Abre el combo existente de la fila (el de Alegra, aunque el SKU difiera en grafía) con sus componentes. */
  function revisarCombo(fila: CodigoEan, e: EnlaceEanAlegra) {
    setAccionSiigo("ajustar");
    setFilaCombo(fila);
    setSiigoInicial({ codigo: e.combo || fila.sku, nombre: e.combo_nombre || fila.nombre_producto || "" });
    setCrearSiigoAbierto(true);
  }

  function guardar() {
    if (!puedeGuardar) return;
    const datos = {
      sku: skuFinal(usarPrefijo, sku),
      nombre_producto: nombreProducto.trim(),
      numero_producto: Number(numeroProducto),
      presentacion,
      anio,
      mes,
    };
    crear.mutate(datos, {
      onSuccess: () => {
        setSku("");
        setNombreProducto("");
        setNumeroProducto("");
        setPresentacion("000");
        presentacionManual.current = false;
        autoFillHecho.current = false; // al refrescar la lista, propone el nuevo consecutivo
      },
    });
  }

  function importarCombos() {
    if (
      !window.confirm(
        "¿Registrar EAN para todos los combos Alegra (C-) que aún no estén en la planilla?\n" +
          "Se asignará el consecutivo siguiente y la presentación se inferirá del SKU (kg→001, 50→050, etc.).",
      )
    ) {
      return;
    }
    importarSiigo.mutate();
  }

  // Antes este botón llamaba a la subida de Siigo (el sistema anterior) aunque dijera
  // Alegra: en Alegra el campo seguía vacío. Ahora escribe en el campo adicional
  // «Código de barras» de cada combo; los códigos nuevos o corregidos ya se suben solos.
  function subirBarcodesSiigo() {
    if (
      !window.confirm(
        "¿Cargar el EAN en el campo «Código de barras» de cada combo enlazado en Alegra?\n" +
          "Solo se escribe ese campo. Tarda unos minutos; puedes seguir trabajando.",
      )
    ) {
      return;
    }
    cargarAlegra.mutate();
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <p className="text-sm font-bold text-ink">Registrar código EAN-13</p>
        <p className="text-xs text-muted">
          Estructura fija: 770 (país) + número de producto (001-900) + presentación (3 díg.) + año (2 díg.) + bimestre (1 díg.) + verificador.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">SKU</label>
            <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent">
              <button
                type="button"
                onClick={alternarPrefijo}
                aria-pressed={usarPrefijo}
                title={usarPrefijo ? "Quitar el prefijo C- (SKU que no son combo)" : "Volver a poner el prefijo C-"}
                className={`shrink-0 select-none border-r border-border px-2 py-1.5 font-mono text-sm font-semibold transition ${
                  usarPrefijo
                    ? "bg-surface-panel text-muted hover:text-ink"
                    : "bg-surface text-muted/50 line-through hover:text-muted"
                }`}
              >
                {SKU_PREFIJO}
              </button>
              <input
                type="text"
                value={sku}
                onChange={(e) => onSkuChange(e.target.value)}
                placeholder={usarPrefijo ? "ACIASC250g" : "ACIASC250g (sin prefijo)"}
                className="w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted">
              Se guarda como {skuFinal(usarPrefijo, sku) || "…"}
              {" · "}
              <button type="button" onClick={alternarPrefijo} className="underline underline-offset-2 hover:text-ink">
                {usarPrefijo ? "sin prefijo C-" : "con prefijo C-"}
              </button>
            </p>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Nombre del producto</label>
            <input
              type="text"
              value={nombreProducto}
              onChange={(e) => onNombreChange(e.target.value)}
              placeholder="Ácido Ascórbico 250g"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Número de producto (1-900)</label>
            <input
              type="text"
              inputMode="numeric"
              value={numeroProducto}
              onChange={(e) => setNumeroProducto(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="047"
              className={`w-full rounded-lg border bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent ${
                numeroProducto && !numeroValido ? "border-danger" : numeroDuplicado ? "border-danger" : "border-border"
              }`}
            />
            {numeroProducto && !numeroValido && (
              <p className="mt-1 text-[10px] text-danger">Debe ser un número entre 1 y 900.</p>
            )}
            {numeroDuplicado && (
              <p className="mt-1 text-[10px] text-danger">Ese número de producto ya está registrado.</p>
            )}
            {siguienteNumero <= 900 && (
              <p className="mt-1 text-[10px] text-muted">
                Siguiente disponible: <strong>{String(siguienteNumero).padStart(3, "0")}</strong>
                {huecosLibres > 0 && (
                  <span className="text-muted">
                    {" "}
                    · {huecosLibres} hueco{huecosLibres === 1 ? "" : "s"} libre
                    {huecosLibres === 1 ? "" : "s"} por reutilizar
                  </span>
                )}
                {Number(numeroProducto) !== siguienteNumero && (
                  <button
                    type="button"
                    onClick={() => setNumeroProducto(String(siguienteNumero))}
                    className="ml-1.5 font-semibold text-accent underline"
                  >
                    usar
                  </button>
                )}
              </p>
            )}
            {siguienteNumero > 900 && (
              <p className="mt-1 text-[10px] text-danger">
                No quedan números libres (001–900 están ocupados).
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Presentación</label>
            <input
              type="text"
              inputMode="numeric"
              value={presentacion}
              onChange={(e) => {
                presentacionManual.current = true;
                setPresentacion(e.target.value.replace(/\D/g, "").slice(0, 3));
              }}
              placeholder="000"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-[10px] text-muted">
              Auto: kg/1.000g→001 · 50g→050 · 100g→100 · 250→250
            </p>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Mes</label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-muted">Se codifica como bimestre: {BIMESTRE_LABEL[bimestre]} (dígito {bimestre}).</p>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Año</label>
            <input
              type="number"
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-[10px] text-muted">Se usan los últimos 2 dígitos.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <div className="flex min-h-[70px] w-full max-w-[280px] items-center justify-center overflow-hidden rounded-lg border border-border bg-white mck-paper-white p-2">
            {preview ? (
              <div
                className="w-full [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
            ) : (
              <span className="text-[10px] text-muted">Completa el número de producto</span>
            )}
          </div>
          <div className="flex-1 space-y-2">
            {preview && (
              <p className="font-mono text-xs tracking-widest text-muted">{preview.digits}</p>
            )}
            {huboError && (
              <Banner tone="danger" className="text-xs">{errorGuardar instanceof Error ? errorGuardar.message : "Error al guardar"}</Banner>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!puedeGuardar} loading={guardando} onClick={guardar}>
                Registrar código
              </Button>
              <Button
                variant="secondary"
                disabled={importarSiigo.isPending || syncBarcodeSiigo.isPending || guardando}
                loading={importarSiigo.isPending}
                onClick={importarCombos}
              >
                Importar combos Alegra faltantes
              </Button>
              <Button
                variant="secondary"
                disabled={importarSiigo.isPending || cargarAlegra.isPending || cargaAlegra?.estado === "corriendo" || guardando}
                loading={cargarAlegra.isPending || cargaAlegra?.estado === "corriendo"}
                onClick={subirBarcodesSiigo}
              >
                Cargar EAN en Alegra (código de barras)
              </Button>
            </div>
            {importarSiigo.isSuccess && (
              <Banner tone="success" className="text-xs">
                Importados {importarSiigo.data.creados} · omitidos {importarSiigo.data.omitidos}
                {importarSiigo.data.errores?.length
                  ? ` · avisos: ${importarSiigo.data.errores.join("; ")}`
                  : ""}
              </Banner>
            )}
            {importarSiigo.isError && (
              <Banner tone="danger" className="text-xs">
                {importarSiigo.error instanceof Error
                  ? importarSiigo.error.message
                  : "Error al importar combos Alegra"}
              </Banner>
            )}
            {cargaAlegra?.estado === "corriendo" && (
              <Banner tone="accent" className="text-xs">Cargando los EAN en Alegra… (unos minutos)</Banner>
            )}
            {cargaAlegra?.estado === "listo" && (
              <Banner tone={cargaAlegra.errores?.length ? "warning" : "success"} className="text-xs">
                Alegra: {cargaAlegra.cargados ?? 0} cargados · {cargaAlegra.sin_cambio ?? 0} ya lo tenían
                {cargaAlegra.errores?.length
                  ? ` · ${cargaAlegra.errores.length} con error: ${cargaAlegra.errores.slice(0, 3).map((e) => `${e.ref} (${e.msg})`).join("; ")}`
                  : ""}
              </Banner>
            )}
            {cargaAlegra?.estado === "error" && (
              <Banner tone="danger" className="text-xs">No se pudo cargar en Alegra: {cargaAlegra.msg}</Banner>
            )}
            {sinEnlace.length > 0 && (
              <Banner tone="warning" className="text-xs">
                {sinEnlace.length} código{sinEnlace.length === 1 ? "" : "s"} sin combo en Alegra (columna «Alegra»): su SKU no es
                el de ningún combo activo. Crea el combo en Alegra o corrige el SKU con el lápiz.
              </Banner>
            )}
            {syncBarcodeSiigo.isSuccess && (
              <Banner tone="success" className="text-xs">
                Alegra barcodes: actualizados {syncBarcodeSiigo.data.actualizados} · omitidos{" "}
                {syncBarcodeSiigo.data.omitidos}
                {syncBarcodeSiigo.data.errores?.length
                  ? ` · errores: ${syncBarcodeSiigo.data.errores.slice(0, 3).join("; ")}`
                  : ""}
              </Banner>
            )}
            {syncBarcodeSiigo.isError && (
              <Banner tone="danger" className="text-xs">
                {syncBarcodeSiigo.error instanceof Error
                  ? syncBarcodeSiigo.error.message
                  : "Error al subir barcodes a Alegra"}
              </Banner>
            )}
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-bold text-ink">
            Códigos registrados
            {codigos
              ? ` (${busquedaLista.trim() ? `${listaFiltrada.length} de ${codigos.length}` : codigos.length})`
              : ""}
          </p>
          <Button
            variant="primary"
            size="sm"
            icon="package"
            onClick={abrirCrearCombo}
            title={
              seleccionado
                ? `Crear el combo ${seleccionado.sku} en Alegra`
                : "Crear un producto combo en Alegra (usa el SKU y el nombre escritos arriba, si hay)"
            }
          >
            {seleccionado ? `Crear combo ${seleccionado.sku}` : "Crear producto combo"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={!seleccionado}
            onClick={() => abrirCrearSiigo("duplicar")}
            title={
              seleccionado
                ? `Duplicar un combo existente hacia ${seleccionado.sku}`
                : "Selecciona un producto del listado"
            }
          >
            Duplicar combo
          </Button>
          {seleccionado ? (
            <p className="max-w-[220px] truncate text-[11px] text-muted">
              Seleccionado: {seleccionado.nombre_producto || seleccionado.sku}
            </p>
          ) : (
            <p className="text-[11px] text-muted">Selecciona un producto del listado</p>
          )}
          <input
            type="search"
            value={busquedaLista}
            onChange={(e) => setBusquedaLista(e.target.value)}
            placeholder="Buscar por nombre, SKU o código…"
            className="ml-auto w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent sm:w-64"
            aria-label="Buscar códigos EAN por nombre"
          />
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
            <Spinner /> Cargando…
          </div>
        ) : error ? (
          <Banner tone="danger" className="m-4 text-xs">{error instanceof Error ? error.message : "Error al cargar"}</Banner>
        ) : !codigos || codigos.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Sin códigos registrados todavía.</p>
        ) : listaFiltrada.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            Sin coincidencias para «{busquedaLista.trim()}».
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead className="bg-surface-panel text-[10px] uppercase text-muted">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Seleccionar</span>
                  </th>
                  <th className="px-3 py-2">Foto</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Present.</th>
                  <th className="px-3 py-2">Año</th>
                  <th className="px-3 py-2">Bimestre</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2" title="¿El SKU es el de un combo activo en Alegra?">Alegra</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {listaFiltrada.map((c: CodigoEan) =>
                  filaEditandoId === c.id ? (
                    <FilaEdicionEan
                      key={c.id}
                      codigo={c}
                      codigos={codigos}
                      onCerrar={() => setFilaEditandoId(null)}
                    />
                  ) : (
                    <tr
                      key={c.id}
                      className={`cursor-pointer hover:bg-surface-hover ${
                        filaSeleccionadaId === c.id ? "bg-accent/10" : ""
                      }`}
                      aria-selected={filaSeleccionadaId === c.id}
                      onClick={() =>
                        setFilaSeleccionadaId((id) => (id === c.id ? null : c.id))
                      }
                    >
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          name="ean-seleccion-siigo"
                          checked={filaSeleccionadaId === c.id}
                          onChange={() => setFilaSeleccionadaId(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Seleccionar ${c.sku}`}
                          className="accent-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <MiniaturaFotoEan codigo={c} onAbrir={() => setFotosDe(c)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-accent">{c.sku}</td>
                      <td className="max-w-[220px] truncate px-3 py-2">{c.nombre_producto || "—"}</td>
                      <td className="px-3 py-2 font-mono">{String(c.numero_producto).padStart(3, "0")}</td>
                      <td className="px-3 py-2 font-mono">{c.presentacion}</td>
                      <td className="px-3 py-2 font-mono">{String(c.anio).padStart(2, "0")}</td>
                      <td className="px-3 py-2">{BIMESTRE_LABEL[c.bimestre] ?? c.bimestre}</td>
                      <td className="px-3 py-2 font-mono tracking-wide">{c.codigo}</td>
                      <td className="px-3 py-2">
                        <EnlaceAlegra
                          e={enlacePorId.get(c.id)}
                          asociando={actualizarCodigo.isPending && actualizarCodigo.variables?.id === c.id}
                          onCrear={() => abrirCrearSiigo("crear", c)}
                          onDuplicar={() => abrirCrearSiigo("duplicar", c)}
                          onRevisar={(e) => revisarCombo(c, e)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            icon="camera"
                            label={`Fotos de ${c.sku}`}
                            size="sm"
                            onClick={() => setFotosDe(c)}
                          />
                          <IconButton
                            icon="pencil"
                            label={`Editar código de ${c.sku}`}
                            size="sm"
                            onClick={() => setFilaEditandoId(c.id)}
                          />
                          <IconButton
                            icon="plus"
                            label={`Duplicar código de ${c.sku}`}
                            size="sm"
                            disabled={guardando}
                            onClick={() => duplicar(c)}
                          />
                          <IconButton
                            icon="trash"
                            label={`Eliminar código de ${c.sku}`}
                            size="sm"
                            tone="danger"
                            disabled={eliminar.isPending}
                            onClick={() => {
                              if (window.confirm(`¿Eliminar el código EAN de ${c.sku}?`)) {
                                if (filaEditandoId === c.id) setFilaEditandoId(null);
                                if (filaSeleccionadaId === c.id) setFilaSeleccionadaId(null);
                                eliminar.mutate(c.id);
                              }
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {fotosDe && <FotosProductoEanModal codigo={fotosDe} onClose={() => setFotosDe(null)} />}

      {crearSiigoAbierto && (
        <Modal
          title={
            siigoInicial
              ? accionSiigo === "duplicar"
                ? `Duplicar combo · ${siigoInicial.codigo}`
                : accionSiigo === "ajustar"
                  ? `Revisar combo · ${siigoInicial.codigo}`
                  : `Crear en Alegra · ${siigoInicial.codigo}`
              : "Crear producto o combo en Alegra"
          }
          onClose={cerrarCrearSiigo}
          maxWidthClassName="max-w-xl"
        >
          <div className="p-4">
            <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Cargando…</p>}>
              <CrearProductosSiigoPanel
                key={`${accionSiigo}|${siigoInicial?.codigo || "nuevo"}|${siigoInicial?.nombre || ""}`}
                compact
                inicial={siigoInicial}
                accion={accionSiigo}
                onCreado={onProductoSiigoCreado}
              />
            </Suspense>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Fila de la tabla en modo edición: todos los campos se editan ahí mismo, sin ir al formulario de arriba. */
function FilaEdicionEan({
  codigo,
  codigos,
  onCerrar,
}: {
  codigo: CodigoEan;
  codigos: CodigoEan[];
  onCerrar: () => void;
}) {
  const actualizar = useActualizarCodigoEan();

  const teniaPrefijo = (codigo.sku || "").trim().toUpperCase().startsWith(SKU_PREFIJO);
  const [usarPrefijo, setUsarPrefijo] = useState(teniaPrefijo);
  const [sku, setSku] = useState(teniaPrefijo ? sinPrefijoSku(codigo.sku) : (codigo.sku || "").trim());
  const [nombreProducto, setNombreProducto] = useState(codigo.nombre_producto || "");
  const [numeroProducto, setNumeroProducto] = useState(String(codigo.numero_producto));
  const [presentacion, setPresentacion] = useState(codigo.presentacion);
  const [mes, setMes] = useState(codigo.bimestre * 2 + 1);
  const [anio, setAnio] = useState(2000 + codigo.anio);

  const numeroValido = /^\d+$/.test(numeroProducto) && Number(numeroProducto) >= 1 && Number(numeroProducto) <= 900;
  const numeroDuplicado =
    numeroValido &&
    codigos.some((c) => c.numero_producto === Number(numeroProducto) && c.id !== codigo.id);
  const bimestre = mesABimestre(mes);

  const codigoPreview = useMemo(() => {
    if (!numeroValido) return null;
    const d12 = construirCodigo12(Number(numeroProducto), presentacion, anio, bimestre);
    return `${d12}${calcCheck(d12)}`;
  }, [numeroValido, numeroProducto, presentacion, anio, bimestre]);

  const puedeGuardar = sku.trim().length > 0 && numeroValido && !numeroDuplicado && !actualizar.isPending;

  function guardar() {
    if (!puedeGuardar) return;
    actualizar.mutate(
      {
        id: codigo.id,
        datos: {
          sku: skuFinal(usarPrefijo, sku),
          nombre_producto: nombreProducto.trim(),
          numero_producto: Number(numeroProducto),
          presentacion,
          anio,
          mes,
        },
      },
      { onSuccess: onCerrar },
    );
  }

  function onTeclas(e: KeyboardEvent) {
    if (e.key === "Enter") guardar();
    if (e.key === "Escape") onCerrar();
  }

  const inputCls =
    "w-full min-w-0 rounded border bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent";

  return (
    <>
      <tr className="bg-surface-panel">
        <td className="px-3 py-2" />
        <td className="px-3 py-2" />
        <td className="px-3 py-2">
          <div className="flex items-center overflow-hidden rounded border border-border bg-surface focus-within:border-accent">
            <button
              type="button"
              onClick={() => {
                const siguiente = !usarPrefijo;
                setUsarPrefijo(siguiente);
                if (siguiente) setSku((s) => sinPrefijoSku(s));
              }}
              aria-pressed={usarPrefijo}
              title={usarPrefijo ? "Quitar el prefijo C-" : "Volver a poner el prefijo C-"}
              className={`shrink-0 select-none border-r border-border px-1 py-1 font-mono text-xs font-semibold transition ${
                usarPrefijo ? "bg-surface-panel text-muted hover:text-ink" : "bg-surface text-muted/50 line-through hover:text-muted"
              }`}
            >
              {SKU_PREFIJO}
            </button>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(usarPrefijo ? sinPrefijoSku(e.target.value) : e.target.value)}
              onKeyDown={onTeclas}
              autoFocus
              className="w-full min-w-[90px] bg-transparent px-1.5 py-1 font-mono text-xs text-ink outline-none"
            />
          </div>
        </td>
        <td className="px-3 py-2">
          <input
            type="text"
            value={nombreProducto}
            onChange={(e) => setNombreProducto(e.target.value)}
            onKeyDown={onTeclas}
            className={`${inputCls} min-w-[140px] border-border`}
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="text"
            inputMode="numeric"
            value={numeroProducto}
            onChange={(e) => setNumeroProducto(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onKeyDown={onTeclas}
            className={`${inputCls} w-14 font-mono ${
              (numeroProducto && !numeroValido) || numeroDuplicado ? "border-danger" : "border-border"
            }`}
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="text"
            inputMode="numeric"
            value={presentacion}
            onChange={(e) => setPresentacion(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onKeyDown={onTeclas}
            className={`${inputCls} w-14 border-border font-mono`}
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="number"
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value) || 0)}
            onKeyDown={onTeclas}
            className={`${inputCls} w-16 border-border font-mono`}
          />
        </td>
        <td className="px-3 py-2">
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className={`${inputCls} w-auto border-border`}
          >
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2 font-mono tracking-wide">
          {codigoPreview ?? <span className="text-muted">—</span>}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1">
            <IconButton
              icon="check"
              label="Guardar cambios"
              size="sm"
              disabled={!puedeGuardar}
              onClick={guardar}
            />
            <IconButton
              icon="close"
              label="Cancelar edición"
              size="sm"
              disabled={actualizar.isPending}
              onClick={onCerrar}
            />
          </div>
        </td>
      </tr>
      {(numeroDuplicado || (numeroProducto && !numeroValido) || actualizar.isError) && (
        <tr className="bg-surface-panel">
          <td colSpan={10} className="px-3 pb-2 pt-0">
            <p className="text-[10px] text-danger">
              {actualizar.isError
                ? actualizar.error instanceof Error
                  ? actualizar.error.message
                  : "Error al guardar"
                : numeroDuplicado
                  ? "Ese número de producto ya está registrado en otro código."
                  : "El número debe estar entre 1 y 900."}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/** Estado del SKU de un código frente a los combos de Alegra. */
function EnlaceAlegra({
  e,
  asociando = false,
  onCrear,
  onDuplicar,
  onRevisar,
}: {
  e?: EnlaceEanAlegra;
  asociando?: boolean;
  /** Solo en «sin combo»: abre la ventana de Alegra para crear o duplicar el combo de esta fila. */
  onCrear?: () => void;
  onDuplicar?: () => void;
  /** Con combo en Alegra (✓ o ≈): abre el combo con sus componentes para revisarlo y ajustarlo. */
  onRevisar?: (e: EnlaceEanAlegra) => void;
}) {
  if (!e || asociando) return <span className="text-[11px] text-muted">…</span>;
  const estilo: Record<EnlaceEanAlegra["estado"], [string, string, string]> = {
    enlazado: ["✓ combo", "text-emerald-700 dark:text-emerald-300", `Combo de Alegra: ${e.combo_nombre}`],
    aproximado: ["≈ revisar", "text-amber-700 dark:text-amber-300", `En Alegra es «${e.combo}»: corrige el SKU con el lápiz`],
    producto: ["producto simple", "text-amber-700 dark:text-amber-300", "En Alegra existe como producto, no como combo (kit)"],
    sin_combo: ["sin combo", "text-red-600", "Ningún combo activo de Alegra tiene este SKU: créalo o corrige el SKU"],
  };
  const [txt, cls, title] = estilo[e.estado];
  const etiqueta = (
    <span className={`whitespace-nowrap text-[11px] font-semibold ${cls}`} title={title}>
      {txt}
    </span>
  );
  const btn =
    "mck-btn-no-fx rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:border-accent hover:text-accent";
  if ((e.estado === "enlazado" || e.estado === "aproximado") && onRevisar) {
    return (
      <div className="flex flex-col items-start gap-1" onClick={(ev) => ev.stopPropagation()}>
        {etiqueta}
        <button
          type="button"
          className={btn}
          onClick={() => onRevisar(e)}
          title={`Ver los componentes de ${e.combo} en Alegra y ajustarlos`}
        >
          Revisar
        </button>
      </div>
    );
  }
  // «producto simple»: el SKU existe en Alegra como producto, no como combo; también
  // se ofrece crear (o duplicar) el combo.
  if ((e.estado !== "sin_combo" && e.estado !== "producto") || (!onCrear && !onDuplicar)) return etiqueta;
  return (
    <div className="flex flex-col items-start gap-1" onClick={(ev) => ev.stopPropagation()}>
      {etiqueta}
      <div className="flex gap-1">
        {onCrear && (
          <button type="button" className={btn} onClick={onCrear} title={`Crear el combo ${e.sku} en Alegra y asociarlo`}>
            Crear
          </button>
        )}
        {onDuplicar && (
          <button type="button" className={btn} onClick={onDuplicar} title={`Duplicar un combo existente como ${e.sku} y asociarlo`}>
            Duplicar
          </button>
        )}
      </div>
    </div>
  );
}
