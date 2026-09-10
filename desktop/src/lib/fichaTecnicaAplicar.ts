/**
 * Carga de una ficha técnica (`/api/fichas/datos`) como parche de la Ficha
 * de etiqueta (`ProductLabelData`). Compartido por el buscador manual de la
 * cabecera (lupa junto al nombre) y por el enlace automático que se dispara
 * al elegir un código de barras — una sola lógica de extracción.
 */
import { api } from "../api/client";
import type { ProductLabelData } from "../components/etiqueta-ficha/productLabelTypes";
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
  peso: "netContent",
  ghs: "ghs",
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

/** Parche con los 12 campos mapeados. Lo que la ficha no trae queda en
 *  blanco (no se conserva texto de otra ficha ni el ejemplo de fábrica). */
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
    destinoTexto[destino] = tieneValor ? (valor as string) : "";
  }
  return patch;
}
