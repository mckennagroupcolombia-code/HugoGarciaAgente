import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useCodigosEan } from "../../lib/etiquetasCodigosEan";
import {
  aplicarBarcodeEan,
  aplicarCamposAPlantilla,
  aplicarLogoLinea,
  BLOQUES_FICHA_GRID,
  BLOQUES_SPECS,
  camposDesdeFichaTecnica,
  camposUsadosEnPlantilla,
  coincideConNombrePlantilla,
  contenidoNetoDesdeTexto,
  eanDesdeSrcBarcode,
  elementoPorRolCapa,
  filtrarCodigosEanPorTexto,
  logoLineaDesdeSrc,
  valoresActualesFormulario,
  type LogoLinea,
} from "../../lib/etiquetaFormulario";
import type { PlantillaVisualDoc } from "../../lib/plantillasVisuales";

interface FichaItem {
  id: string;
  titulo: string;
  archivo: string;
}

/**
 * Estado y acciones del Formulario de etiqueta, compartidos entre el panel
 * lateral (nombre/categoría/logo/peso/código de barras) y el panel de la
 * barra inferior (grids de Ficha/Especificaciones, que necesitan más ancho
 * horizontal del que da el sidebar de 340px). Una sola instancia del hook
 * en `VisualCanvasEditor` evita que ambos paneles diverjan en estado.
 */
export function useFormularioEtiqueta(
  doc: PlantillaVisualDoc,
  onChange: (doc: PlantillaVisualDoc) => void,
  activo: boolean,
) {
  const campos = useMemo(() => (activo ? camposUsadosEnPlantilla(doc) : []), [doc, activo]);
  const valores = useMemo(() => valoresActualesFormulario(doc), [doc]);
  const logoEl = useMemo(() => elementoPorRolCapa(doc, "logo"), [doc]);
  const barcodeEl = useMemo(() => elementoPorRolCapa(doc, "barcode"), [doc]);
  const logoActivo = logoEl ? logoLineaDesdeSrc(logoEl.src) : undefined;
  const eanActual = barcodeEl ? eanDesdeSrcBarcode(barcodeEl.src) : "";
  const [fichas, setFichas] = useState<FichaItem[]>([]);
  const [fichaId, setFichaId] = useState("");
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** Ficha con nombre distinto al de esta plantilla, a la espera de que el
   *  usuario confirme que sí quiere cargarla igual (ver `cargarFicha`). */
  const [pendiente, setPendiente] = useState<{
    next: Record<string, string>;
    sku: string;
    tituloFicha: string;
  } | null>(null);
  const [eanManual, setEanManual] = useState("");
  const { data: codigosEan } = useCodigosEan();

  useEffect(() => {
    setEanManual(eanActual);
  }, [eanActual]);

  useEffect(() => {
    if (!activo) return;
    let cancel = false;
    (async () => {
      try {
        const res = await api.get<{ items: FichaItem[] }>("/api/fichas/datos");
        if (!cancel) setFichas(res.items || []);
      } catch {
        if (!cancel) setFichas([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [activo]);

  const usados = useMemo(() => new Set(campos), [campos]);
  const fichaGrid = useMemo(() => BLOQUES_FICHA_GRID.filter((b) => usados.has(b.campo)), [usados]);
  const specs = useMemo(() => BLOQUES_SPECS.filter((b) => usados.has(b.campo)), [usados]);
  const qNombre = [valores.nombre, doc.nombre, doc.sku].filter(Boolean).join(" ");
  const eanSugeridos = useMemo(
    () => (qNombre.trim() ? filtrarCodigosEanPorTexto(codigosEan ?? [], qNombre, 8) : []),
    [codigosEan, qNombre],
  );
  // El SKU/nombre suele traer el contenido neto pegado (p. ej. "…1000g"):
  // se ofrece como sugerencia de un clic en vez de forzar a tipearlo de nuevo.
  const pesoSugerido = useMemo(
    () => contenidoNetoDesdeTexto(doc.sku || doc.nombre || ""),
    [doc.sku, doc.nombre],
  );

  const patchCampo = (campo: string, valor: string) => {
    onChange(aplicarCamposAPlantilla(doc, { [campo]: valor }));
  };

  const aplicarEan = (digits: string) => {
    const limpio = digits.replace(/\D/g, "").slice(0, 13);
    setEanManual(limpio);
    if (limpio.length >= 12) onChange(aplicarBarcodeEan(doc, limpio));
  };

  const aplicarLogo = (linea: LogoLinea) => onChange(aplicarLogoLinea(doc, linea));

  const aplicarCargaFicha = (next: Record<string, string>, sku: string) => {
    let updated = aplicarCamposAPlantilla(doc, next);
    const match =
      (codigosEan ?? []).find((c) => sku && c.sku.toLowerCase() === sku.toLowerCase())
      || eanSugeridos[0];
    if (match && barcodeEl) updated = aplicarBarcodeEan(updated, match.codigo);
    onChange(updated);
  };

  const cargarFicha = async () => {
    if (!fichaId) return;
    setCargando(true);
    setMsg(null);
    setPendiente(null);
    try {
      const res = await api.get<{ datos: Record<string, unknown> }>(
        `/api/fichas/datos/${encodeURIComponent(fichaId)}`,
      );
      const mapped = camposDesdeFichaTecnica(res.datos || {});
      const next = Object.fromEntries(
        Object.entries(mapped).filter(([k]) => usados.has(k as (typeof campos)[number])),
      );
      if (!Object.keys(next).length) {
        setMsg("Esa ficha no tiene datos mapeables a esta etiqueta.");
        return;
      }
      const sku = String((res.datos || {}).sku || doc.sku || "").trim();
      const tituloFicha = fichas.find((fi) => fi.id === fichaId)?.titulo || mapped.nombre || fichaId;
      const nombrePlantilla = doc.nombre || valores.nombre || "";
      // Esta plantilla ya existe con un nombre propio (p. ej. "MANTECA DE
      // CACAO REFINADA 1000g"); si la ficha elegida es de otro producto,
      // cargarla aquí y guardar sobrescribiría en silencio esa plantilla —
      // su nombre en la biblioteca nunca cambiaría para avisarlo. Frenar
      // antes de aplicar y pedir confirmación explícita.
      if (!coincideConNombrePlantilla(tituloFicha, nombrePlantilla)) {
        setPendiente({ next, sku, tituloFicha });
        setMsg(
          `"${tituloFicha}" no parece el mismo producto que "${nombrePlantilla}". Si guardas, sobrescribes esta plantilla con datos de otro producto — duplícala primero o confirma abajo si es intencional.`,
        );
        return;
      }
      aplicarCargaFicha(next, sku);
      setMsg(`Cargados ${Object.keys(next).length} campos. El formato no se movió.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo cargar la ficha");
    } finally {
      setCargando(false);
    }
  };

  const confirmarCargaPendiente = () => {
    if (!pendiente) return;
    aplicarCargaFicha(pendiente.next, pendiente.sku);
    setMsg(`Cargados ${Object.keys(pendiente.next).length} campos de "${pendiente.tituloFicha}" (confirmado). El formato no se movió.`);
    setPendiente(null);
  };

  const cancelarCargaPendiente = () => {
    setPendiente(null);
    setMsg(null);
  };

  const disponible = activo && (campos.length > 0 || !!logoEl || !!barcodeEl);

  return {
    disponible,
    campos,
    valores,
    logoEl,
    barcodeEl,
    logoActivo,
    eanActual,
    eanManual,
    fichas,
    fichaId,
    setFichaId,
    cargando,
    msg,
    cargarFicha,
    pendiente,
    confirmarCargaPendiente,
    cancelarCargaPendiente,
    fichaGrid,
    specs,
    eanSugeridos,
    pesoSugerido,
    patchCampo,
    aplicarEan,
    aplicarLogo,
  };
}

export type FormularioEtiqueta = ReturnType<typeof useFormularioEtiqueta>;
