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

/** Campos de la PLANTILLA (alérgenos, contacto, web…): la ficha los pisa si
 *  los trae, pero si no, se dejan como están — son el valor de la familia,
 *  no un dato suelto de otro producto. Los de producto sí se vacían. */
const ES_CAMPO_PLANTILLA = new Set<string>(CAMPOS_PLANTILLA);

/** Parche con los campos mapeados. Lo que la ficha no trae queda en blanco
 *  (no se conserva texto de otra ficha ni el ejemplo de fábrica), salvo los
 *  campos de plantilla. */
export async function cargarPatchDesdeFichaTecnica(fichaId: string): Promise<Partial<ProductLabelData>> {
  const res = await api.get<{ datos: Record<string, unknown> }>(
    `/api/fichas/datos/${encodeURIComponent(fichaId)}`,
  );
  const mapeado = camposDesdeFichaTecnica(res.datos || {});
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
