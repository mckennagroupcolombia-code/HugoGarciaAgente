/**
 * Carga de una ficha técnica (`/api/fichas/datos`) como parche de la Ficha
 * de etiqueta (`ProductLabelData`). Compartido por el buscador manual de la
 * cabecera (lupa junto al nombre) y por el enlace automático que se dispara
 * al elegir un código de barras — una sola lógica de extracción.
 */
import { api } from "../api/client";
import { CAMPOS_PLANTILLA, type ProductLabelData } from "../components/etiqueta-ficha/productLabelTypes";
import { camposDesdeFichaTecnica, FICHA_SIN_DATO } from "./fichaTecnicaCampos";
import type { CandidataFicha } from "./fichaTecnicaMatch";

export interface FichaTecnicaItem extends CandidataFicha {
  archivo: string;
  guardado_at?: string;
}

/** `camposDesdeFichaTecnica` habla el vocabulario del viejo Formulario de
 *  etiqueta física; esta ficha usa nombres en inglés — un solo mapa entre
 *  los dos para no duplicar la lógica de extracción. */
const MAPA_A_PRODUCT_LABEL: Partial<Record<string, keyof ProductLabelData>> = {
  nombre: "productName",
  tagline: "classification",
  concentracionValor: "concentration",
  casNumero: "cas",
  origen: "origin",
  apariencia: "appearance",
  olor: "odor",
  composicion: "composition",
  grado: "grade",
  almacenamiento: "storage",
  alergenos: "alergenos",
  descripcion: "descripcionProducto",
  aplicaciones: "aplicaciones",
  modoUso: "modoUso",
  beneficio1: "beneficio1",
  beneficio2: "beneficio2",
  peso: "netContent",
  ghs: "ghs",
  clasificacionSga: "clasificacionTexto",
};

const LISTA_TTL_MS = 5 * 60_000;
let listaCache: { ts: number; items: FichaTecnicaItem[] } | null = null;
let listaEnCurso: Promise<FichaTecnicaItem[]> | null = null;

/** Lista de fichas técnicas (id + título), cacheada 5 min en memoria. */
export async function listarFichasTecnicas(forzar = false): Promise<FichaTecnicaItem[]> {
  if (!forzar && listaCache && Date.now() - listaCache.ts < LISTA_TTL_MS) return listaCache.items;
  if (!listaEnCurso) {
    listaEnCurso = api
      .get<{ items: FichaTecnicaItem[] }>("/api/fichas/datos")
      .then((res) => {
        const items = res.items || [];
        listaCache = { ts: Date.now(), items };
        return items;
      })
      .finally(() => {
        listaEnCurso = null;
      });
  }
  return listaEnCurso;
}

/** Documento técnico de un SKU por código (receta del combo → SKU que declara el
 *  documento), antes que por parecido de título. null si no hay o el servidor no
 *  responde: entonces se busca por título como siempre. */
export async function fichaPorSku(sku: string): Promise<{ id: string; titulo: string } | null> {
  const s = (sku || "").trim();
  if (!s) return null;
  try {
    const r = await api.get<{ id: string; titulo: string }>(`/api/fichas/por-sku/${encodeURIComponent(s)}`);
    return r?.id ? { id: r.id, titulo: r.titulo } : null;
  } catch {
    return null;
  }
}

/** Campos de la PLANTILLA (alérgenos, contacto, web…): la ficha los pisa si
 *  los trae, pero si no, se dejan como están — son el valor de la familia,
 *  no un dato suelto de otro producto. Los de producto sí se vacían. */
const ES_CAMPO_PLANTILLA = new Set<string>(CAMPOS_PLANTILLA);

/** Parche con los campos mapeados. Lo que la ficha no trae queda en blanco
 *  (no se conserva texto de otra ficha ni el ejemplo de fábrica), salvo los
 *  campos de plantilla. */
/** Documento técnico guardado → sus cambios a TODAS las etiquetas enlazadas
 *  (antes solo cambiaba la que se abriera en el editor). Misma regla que al
 *  abrir una etiqueta: no pisa lo ajustado a mano (ver lib/fichaTecnicaSync).
 *  `ids[0]` es el documento vigente; las enlazadas a los demás pasan a él. */
export async function propagarFichaTecnicaAEtiquetas(
  ids: string[],
): Promise<{ id: string; nombre: string; campos: string[] }[]> {
  const vigente = ids.find(Boolean);
  if (!vigente) return [];
  const { fotoFicha } = await import("./fichaTecnicaSync");
  const foto = fotoFicha(await cargarPatchDesdeFichaTecnica(vigente));
  const r = await api.post<{ etiquetas: { id: string; nombre: string; campos: string[] }[] }>(
    "/api/etiquetas/fichas/sincronizar-ficha-tecnica",
    { ids: [...new Set(ids.filter(Boolean))], foto },
  );
  return r.etiquetas ?? [];
}

export async function cargarPatchDesdeFichaTecnica(fichaId: string): Promise<Partial<ProductLabelData>> {
  const res = await api.get<{ datos: Record<string, unknown> }>(
    `/api/fichas/datos/${encodeURIComponent(fichaId)}`,
  );
  return patchDesdeDatos(res.datos || {});
}

/** Campos de la etiqueta que salen de los datos de un documento técnico. */
export function patchDesdeDatos(datos: Record<string, unknown>): Partial<ProductLabelData> {
  const mapeado = camposDesdeFichaTecnica(datos);
  const patch: Partial<ProductLabelData> = {};
  const destinoTexto = patch as unknown as Record<keyof ProductLabelData, string>;
  for (const [origenId, destino] of Object.entries(MAPA_A_PRODUCT_LABEL)) {
    if (!destino) continue;
    const valor = mapeado[origenId];
    // Un valor que CONTIENE el marcador (p. ej. la clasificación armada
    // como "MATERIA PRIMA GRADO — completar —") también cuenta como vacío.
    const tieneValor =
      Boolean(valor) && !String(valor).toLowerCase().includes(FICHA_SIN_DATO.toLowerCase());
    if (!tieneValor && ES_CAMPO_PLANTILLA.has(destino)) continue;
    destinoTexto[destino] = tieneValor ? (valor as string) : "";
  }
  // Casilla de composición: si la ficha trae fórmula molecular, la casilla
  // MUESTRA esa fórmula y se titula "Fórmula molecular" — es el mismo dato de
  // la fila del documento técnico, ya con subíndices. Sin fórmula (mezclas,
  // alimentos) vuelve a ser la lista de componentes bajo "Composición".
  const formula = mapeado.formulaMolecular;
  // "No aplica" es la respuesta correcta para alimentos y mezclas, pero en la
  // etiqueta no se imprime como si fuera una fórmula: esa casilla vuelve a ser
  // la Composición.
  const hayFormula =
    Boolean(formula)
    && !formula.toLowerCase().includes(FICHA_SIN_DATO.toLowerCase())
    && !/^\s*no\s+aplica/i.test(formula);
  if (hayFormula) {
    patch.composition = formula;
    patch.compositionTitulo = "Fórmula molecular";
  } else if (patch.composition) {
    patch.compositionTitulo = "Composición";
  }
  // El pictograma lo decide el código GHS de ESTA ficha: se quita el que se
  // hubiera elegido a mano en la galería (podía ser de otro producto).
  patch.ghsIconSvg = "";
  return patch;
}
