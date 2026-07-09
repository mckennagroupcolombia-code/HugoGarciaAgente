import { useMemo, useState } from "react";
import { calcCheck, generarEAN13 } from "../../lib/ean13";
import {
  BIMESTRE_LABEL,
  construirCodigo12,
  mesABimestre,
  useCodigosEan,
  useCrearCodigoEan,
  useEliminarCodigoEan,
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

export function CodigosEanPanel() {
  const { data: codigos, isLoading, error } = useCodigosEan();
  const crear = useCrearCodigoEan();
  const eliminar = useEliminarCodigoEan();

  const [sku, setSku] = useState("");
  const [nombreProducto, setNombreProducto] = useState("");
  const [numeroProducto, setNumeroProducto] = useState("");
  const [presentacion, setPresentacion] = useState("000");
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(anioActualCorto());

  const numeroValido = /^\d+$/.test(numeroProducto) && Number(numeroProducto) >= 1 && Number(numeroProducto) <= 900;
  const numeroDuplicado = useMemo(
    () => numeroValido && (codigos ?? []).some((c) => c.numero_producto === Number(numeroProducto)),
    [codigos, numeroProducto, numeroValido],
  );
  const bimestre = mesABimestre(mes);

  const preview = useMemo(() => {
    if (!numeroValido) return null;
    const d12 = construirCodigo12(Number(numeroProducto), presentacion, anio, bimestre);
    const check = calcCheck(d12);
    return generarEAN13(`${d12}${check}`);
  }, [numeroValido, numeroProducto, presentacion, anio, bimestre]);

  const puedeRegistrar = sku.trim().length > 0 && numeroValido && !numeroDuplicado && !crear.isPending;

  function registrar() {
    if (!puedeRegistrar) return;
    crear.mutate(
      {
        sku: sku.trim(),
        nombre_producto: nombreProducto.trim(),
        numero_producto: Number(numeroProducto),
        presentacion,
        anio,
        mes,
      },
      {
        onSuccess: () => {
          setSku("");
          setNombreProducto("");
          setNumeroProducto("");
        },
      },
    );
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
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="AS-123"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Nombre del producto</label>
            <input
              type="text"
              value={nombreProducto}
              onChange={(e) => setNombreProducto(e.target.value)}
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
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Presentación</label>
            <input
              type="text"
              inputMode="numeric"
              value={presentacion}
              onChange={(e) => setPresentacion(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="000"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent"
            />
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
          <div className="flex min-h-[70px] w-full max-w-[280px] items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2">
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
            {crear.isError && (
              <Banner tone="danger" className="text-xs">{crear.error instanceof Error ? crear.error.message : "Error al registrar"}</Banner>
            )}
            <Button variant="primary" disabled={!puedeRegistrar} loading={crear.isPending} onClick={registrar}>
              Registrar código
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="border-b border-border px-4 py-2.5">
          <p className="text-sm font-bold text-ink">Códigos registrados{codigos ? ` (${codigos.length})` : ""}</p>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
            <Spinner /> Cargando…
          </div>
        ) : error ? (
          <Banner tone="danger" className="m-4 text-xs">{error instanceof Error ? error.message : "Error al cargar"}</Banner>
        ) : !codigos || codigos.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Sin códigos registrados todavía.</p>
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
                {codigos.map((c: CodigoEan) => (
                  <tr key={c.id} className="hover:bg-surface-hover">
                    <td className="px-3 py-2 font-mono text-accent">{c.sku}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">{c.nombre_producto || "—"}</td>
                    <td className="px-3 py-2 font-mono">{String(c.numero_producto).padStart(3, "0")}</td>
                    <td className="px-3 py-2 font-mono">{c.presentacion}</td>
                    <td className="px-3 py-2 font-mono">{String(c.anio).padStart(2, "0")}</td>
                    <td className="px-3 py-2">{BIMESTRE_LABEL[c.bimestre] ?? c.bimestre}</td>
                    <td className="px-3 py-2 font-mono tracking-wide">{c.codigo}</td>
                    <td className="px-3 py-2 text-right">
                      <IconButton
                        icon="trash"
                        label={`Eliminar código de ${c.sku}`}
                        size="sm"
                        tone="danger"
                        disabled={eliminar.isPending}
                        onClick={() => {
                          if (window.confirm(`¿Eliminar el código EAN de ${c.sku}?`)) {
                            eliminar.mutate(c.id);
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
