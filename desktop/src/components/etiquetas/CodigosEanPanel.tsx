import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  type CodigoEan,
} from "../../lib/etiquetasCodigosEan";
import { Banner, Button, Card, IconButton, Spinner } from "./ui";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function anioActualCorto(): number {
  return new Date().getFullYear() % 100;
}

/** Prefijo estándar de los SKU de combos SIIGO (C-ACIASC250g, C-UREA500g…). */
const SKU_PREFIJO = "C-";

function sinPrefijoSku(sku: string): string {
  return sku.replace(/^c-\s*/i, "");
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

export function CodigosEanPanel() {
  const { data: codigos, isLoading, error } = useCodigosEan();
  const crear = useCrearCodigoEan();
  const eliminar = useEliminarCodigoEan();
  const importarSiigo = useImportarCombosEanSiigo();
  const syncBarcodeSiigo = useSincronizarBarcodesEanSiigo();

  const [filaEditandoId, setFilaEditandoId] = useState<string | null>(null);
  const [busquedaLista, setBusquedaLista] = useState("");
  const [sku, setSku] = useState("");
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

  // Sugerir presentación (kg→001, 50→050, 100→100…) al escribir SKU/nombre.
  useEffect(() => {
    if (presentacionManual.current) return;
    const sugerida = sugerirPresentacionEan(SKU_PREFIJO + sinPrefijoSku(sku), nombreProducto);
    setPresentacion(sugerida);
  }, [sku, nombreProducto]);

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
    setSku(sinPrefijoSku(valor));
  }

  function onNombreChange(valor: string) {
    presentacionManual.current = false;
    setNombreProducto(valor);
  }

  function guardar() {
    if (!puedeGuardar) return;
    const datos = {
      sku: SKU_PREFIJO + sinPrefijoSku(sku.trim()),
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
        "¿Registrar EAN para todos los combos SIIGO (C-) que aún no estén en la planilla?\n" +
          "Se asignará el consecutivo siguiente y la presentación se inferirá del SKU (kg→001, 50→050, etc.).",
      )
    ) {
      return;
    }
    importarSiigo.mutate();
  }

  function subirBarcodesSiigo() {
    if (
      !window.confirm(
        "¿Subir los EAN de la planilla al campo «Código de barras» de cada combo en SIIGO?\n" +
          "Solo se llenan los que estén vacíos. Puede tardar varios minutos.",
      )
    ) {
      return;
    }
    syncBarcodeSiigo.mutate({ solo_vacios: true });
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
              <span className="shrink-0 select-none border-r border-border bg-surface-panel px-2 py-1.5 font-mono text-sm font-semibold text-muted">
                {SKU_PREFIJO}
              </span>
              <input
                type="text"
                value={sku}
                onChange={(e) => onSkuChange(e.target.value)}
                placeholder="ACIASC250g"
                className="w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted">Se guarda como {SKU_PREFIJO}{sku.trim() || "…"}</p>
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
                Importar combos SIIGO faltantes
              </Button>
              <Button
                variant="secondary"
                disabled={importarSiigo.isPending || syncBarcodeSiigo.isPending || guardando}
                loading={syncBarcodeSiigo.isPending}
                onClick={subirBarcodesSiigo}
              >
                Subir EAN a SIIGO (código de barras)
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
                  : "Error al importar combos SIIGO"}
              </Banner>
            )}
            {syncBarcodeSiigo.isSuccess && (
              <Banner tone="success" className="text-xs">
                SIIGO barcodes: actualizados {syncBarcodeSiigo.data.actualizados} · omitidos{" "}
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
                  : "Error al subir barcodes a SIIGO"}
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
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-surface-panel text-[10px] uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Present.</th>
                  <th className="px-3 py-2">Año</th>
                  <th className="px-3 py-2">Bimestre</th>
                  <th className="px-3 py-2">Código</th>
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
                    <tr key={c.id} className="hover:bg-surface-hover">
                      <td className="px-3 py-2 font-mono text-accent">{c.sku}</td>
                      <td className="max-w-[220px] truncate px-3 py-2">{c.nombre_producto || "—"}</td>
                      <td className="px-3 py-2 font-mono">{String(c.numero_producto).padStart(3, "0")}</td>
                      <td className="px-3 py-2 font-mono">{c.presentacion}</td>
                      <td className="px-3 py-2 font-mono">{String(c.anio).padStart(2, "0")}</td>
                      <td className="px-3 py-2">{BIMESTRE_LABEL[c.bimestre] ?? c.bimestre}</td>
                      <td className="px-3 py-2 font-mono tracking-wide">{c.codigo}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
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

  const [sku, setSku] = useState(sinPrefijoSku(codigo.sku));
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
          sku: SKU_PREFIJO + sinPrefijoSku(sku.trim()),
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
        <td className="px-3 py-2">
          <div className="flex items-center overflow-hidden rounded border border-border bg-surface focus-within:border-accent">
            <span className="shrink-0 select-none border-r border-border bg-surface-panel px-1 py-1 font-mono text-xs font-semibold text-muted">
              {SKU_PREFIJO}
            </span>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(sinPrefijoSku(e.target.value))}
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
          <td colSpan={8} className="px-3 pb-2 pt-0">
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
