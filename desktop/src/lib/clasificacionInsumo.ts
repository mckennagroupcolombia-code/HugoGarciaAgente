/**
 * Clasificación del insumo en la ficha técnica (FT + COA + SDS) y qué casillas
 * de identificación le aplican. Una sola regla para el formulario y, luego, para
 * la etiqueta:
 *
 *   A · definida  → CAS + EINECS + fórmula molecular
 *   B · natural   → CAS + EINECS + composición (aceites, mantecas, ceras, extractos, polímeros)
 *   C · mezcla    → sin CAS/EINECS únicos; composición con cada componente
 *   D · alimento  → sin CAS/EINECS/INCI/INS; composición nutricional
 *
 * El grado decide el nombre: cosmético → INCI; aditivo de alimentos → INS.
 */

export type TipoInsumo = "definida" | "natural" | "mezcla" | "alimento";

export const TIPOS_INSUMO: { id: TipoInsumo; letra: string; nombre: string; ejemplos: string }[] = [
  { id: "definida", letra: "A", nombre: "Sustancia definida", ejemplos: "Ácidos, sales, aminoácidos, mentol, glicerina" },
  { id: "natural", letra: "B", nombre: "Natural o polímero", ejemplos: "Aceites, mantecas, ceras, arcillas, extractos, gomas, proteínas" },
  { id: "mezcla", letra: "C", nombre: "Mezcla", ejemplos: "BCAA, papaína con maltodextrina, vitamina E en aceite" },
  { id: "alimento", letra: "D", nombre: "Alimento", ejemplos: "Frutos secos, deshidratados, semillas, flores secas" },
];

export const GRADOS_SUGERIDOS = ["Cosmético", "Alimentos", "Farmacéutico (USP)", "Industrial", "Grasas y Ceras", "Agro"] as const;

export function esTipoInsumo(v: unknown): v is TipoInsumo {
  return v === "definida" || v === "natural" || v === "mezcla" || v === "alimento";
}

function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Grados reconocidos dentro del texto libre del grado del COA ("Alimentos / Cosmético"). */
export function gradosDesdeTexto(grado: string): { cosmetico: boolean; alimentos: boolean; farmaceutico: boolean } {
  const g = sinTildes(grado || "");
  return {
    cosmetico: /cosmet/.test(g),
    alimentos: /aliment/.test(g),
    farmaceutico: /farma|\busp\b|\bbp\b|ph\.?\s*eur/.test(g),
  };
}

/** Activa o quita un grado del texto compuesto "A / B", respetando lo escrito a mano. */
export function alternarGrado(grado: string, opcion: string): string {
  const partes = (grado || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const i = partes.findIndex((p) => sinTildes(p) === sinTildes(opcion));
  if (i >= 0) partes.splice(i, 1);
  else partes.push(opcion);
  return partes.join(" / ");
}

export function gradoIncluye(grado: string, opcion: string): boolean {
  return (grado || "")
    .split("/")
    .some((p) => sinTildes(p.trim()) === sinTildes(opcion));
}

export interface CasillasInsumo {
  /** Motivo por el que NO aplica; `null` = la casilla se habilita. */
  cas: string | null;
  einecs: string | null;
  inci: string | null;
  ins: string | null;
  formula: string | null;
  /** La composición es obligatoria (B, C, D) o solo complementaria (A). */
  composicionRequerida: boolean;
}

/**
 * Qué casillas se habilitan según la clasificación. Sin tipo elegido todo queda
 * habilitado (fichas anteriores a la clasificación).
 */
export function casillasPorClasificacion(tipo: TipoInsumo | "", grado: string): CasillasInsumo {
  const g = gradosDesdeTexto(grado);
  if (!tipo) {
    return { cas: null, einecs: null, inci: null, ins: null, formula: null, composicionRequerida: false };
  }
  const sinNumero =
    tipo === "mezcla" ? "una mezcla no tiene un número único" : tipo === "alimento" ? "alimento" : null;
  return {
    cas: sinNumero,
    einecs: sinNumero,
    inci:
      tipo === "alimento"
        ? "alimento"
        : g.cosmetico
          ? null
          : "solo para grado cosmético",
    ins:
      tipo === "alimento"
        ? "alimento"
        : g.alimentos
          ? null
          : "solo para aditivos de grado alimentos",
    formula: tipo === "definida" ? null : "este tipo de insumo usa Composición (SDS, sección 3)",
    composicionRequerida: tipo !== "definida",
  };
}

/** Valor que se guarda para una casilla que no aplica. */
export function valorSiNoAplica(motivo: string | null, valor: string, vacio: "No aplica" | ""): string {
  return motivo ? vacio : valor;
}
