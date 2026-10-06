/** Formas que devuelve /api/contabilidad/expediente/* (app/services/expediente_contable.py). */

export type Periodo = {
  periodo: string; tipo: "libro_propio" | "periodo_contador"; en_curso: boolean;
  asientos: number; extracto: boolean; dian: boolean; declaraciones: number;
  observaciones_abiertas: number; paquete: string;
};

export type Banco = {
  extractos: { id: number; nombre: string; archivo_nombre: string; desde: string; hasta: string; lineas: number }[];
  lineas: number; vinculadas: number; sin_vincular: number; abonos: number; cargos: number; cobertura_hasta: string;
  saldo_extracto_inicial: number | null; saldo_extracto_final: number | null; saldo_metodo: string;
  saldo_libro_inicial: number; saldo_libro_final: number; diferencia: number | null; libro_sin_banco: number; cuadra: boolean;
};

export type TotalesCruce = {
  dian: number; libro: number; en_ambos: number; cuadran: number; difieren: number; solo_dian: number; solo_libro: number;
  valor_dian: number; valor_libro: number; diferencia: number;
};

export type Declarado = {
  valor: number | null; numero?: string; fecha?: string; ref?: string | null; periodo?: string; fuente?: string;
  total_formulario?: number; descontable?: number;
};

export type Impuesto = {
  cuenta: string; nombre: string; formulario: string; concepto: string;
  saldo_inicial: number; causado: number; pagado: number; saldo_final: number;
  declarado: Declarado | null; veredicto: "cuadra" | "difiere" | "pendiente" | "presentada" | "sin_declaracion"; nota: string;
};

export type Verificacion = {
  asientos: number; con_soporte: number; sin_soporte: number;
  banco: { vinculados: number; sin_vincular: number } | null;
  alegra: { espejados: number } | null;
  dian: { en_ambos: number; cuadran: number; difieren: number; solo_libro: number; solo_dian: number } | null;
  declaracion: { formulario: string; declarado: Declarado | null; veredicto: Impuesto["veredicto"]; causado: number; pagado: number; nota: string } | null;
  observaciones: { abiertas: number; revisado: boolean; revisado_por?: string | null };
  pendiente: boolean; motivos: string[]; fuentes: string[]; fuente_externa?: null;
};

export type Cuenta = {
  codigo: string; nombre: string; nivel: string; tipo: string; naturaleza: string; cuenta_id: number | null;
  es_movimiento: boolean; descripcion?: string; saldo_inicial: number; debito: number; credito: number; lineas: number;
  saldo_final: number; verificacion: Verificacion; clave: boolean;
};

export type Fuente = { ref: string; tipo: string; titulo: string; detalle: string; cuentas: string[]; disponible_local: boolean };

export type Expediente = {
  periodo: string; desde: string; hasta: string; tipo: Periodo["tipo"]; corte: string; generado_en: string;
  veredicto: { nivel: "verde" | "amarillo" | "rojo" | "neutro"; titulo: string; frase: string };
  estado: {
    tipo: string; cuadra: boolean; total_debito: number; total_credito: number; asientos: number; anulados: number;
    banco: Banco;
    mercadopago: { saldo_libro_inicial: number | null; saldo_libro_final: number | null; fuente: null; nota: string };
    dian: { listado: boolean; error?: string; emitidos?: TotalesCruce; notas_credito?: TotalesCruce; documentos_soporte?: TotalesCruce; recibidos?: TotalesCruce };
    impuestos: Impuesto[];
    observaciones: { total: number; abiertas: number; revisados: number };
    paquete: { estado: string; generado_en?: string; bytes?: number; firma_vigente?: boolean };
    cuentas_con_movimiento: number; cuentas_por_revisar: number;
    libro?: { informativo: boolean; asientos: number; nota: string };
  };
  cuentas: Cuenta[]; cuentas_clave: string[]; fuentes: Fuente[];
};

export type VerifFila = {
  banco: { estado: "vinculado" | "sin_banco" | "no_aplica"; linea_id?: number; extracto_id?: number; fecha_banco?: string; monto_banco?: number; descripcion_banco?: string };
  dian: { estado: string; documento?: string; cufe?: string; total_dian?: number; diferencia?: number };
  soporte: { estado: "si" | "no"; n: number };
  alegra: { journal_id: string; url: string } | null;
  observacion: { abiertas: number; revisado: boolean } | null;
};

export type FilaAuxiliar = {
  linea_id: number; movimiento_id: number; fecha: string; concepto: string; referencia: string; tipo_origen: string;
  descripcion: string; tercero_id: number | null; tercero_nombre: string; cuenta_codigo: string; cuenta_nombre: string;
  debito: number; credito: number; saldo: number;
  contrapartida: { codigo: string; nombre: string; valor: number; lado: string }[];
  nit?: string; documento?: string; cufe?: string; soporte_nombre?: string;
  verificaciones: VerifFila;
};

export type Auxiliar = {
  periodo: string; cuenta: { id: number; codigo: string; nombre: string; naturaleza: string };
  saldo_inicial: number; saldo_final: number; total_debito: number; total_credito: number; truncado: boolean;
  total: number; offset: number; limite: number; filas: FilaAuxiliar[];
  por_dia: { fecha: string; n: number; debito: number; credito: number; saldo: number; con_soporte: number; sin_banco: number; dian_solo_libro: number }[] | null;
  por_tercero: { tercero_id: number | null; nombre: string; debito: number; credito: number; movimientos: number; saldo: number }[];
};

export type Documento = {
  ref: string; tipo: string; titulo: string; origen: "local" | "alegra" | "dian" | "banco" | "contador";
  disponible_local: boolean; archivo: string | null; mime: string | null; bytes: number | null; sha256: string | null;
  enlace_externo: string | null; nota: string;
};

export type Asiento = {
  movimiento: { id: number; fecha: string; concepto: string; tipo_origen: string; referencia: string; estado: string;
    tercero: { id: number; nombre: string; identificacion?: string } | null; total_debito: number; total_credito: number };
  lineas: { cuenta_codigo: string; cuenta_nombre: string; debito: number; credito: number; descripcion: string; tercero_nombre: string }[];
  cuadra: boolean; documentos: Documento[];
  banco_linea: { extracto_mov_id: number; extracto_id: number; fecha: string; descripcion: string; monto: number; tipo: string; notas: string } | null;
  dian: VerifFila["dian"] | null; alegra: VerifFila["alegra"]; soporte: VerifFila["soporte"] | null;
  observaciones: { id: number; estado: string; texto: string; por: string; created_at: string; respuesta?: string; resuelto_en?: string | null }[];
};

export function cop(n: number | null | undefined, dec = 0): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function mesCorto(p: string): string {
  const [a, m] = p.split("-");
  return `${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

export function mesLargo(p: string): string {
  const [a, m] = p.split("-");
  return `${MESES_LARGO[Number(m) - 1] ?? m} de ${a}`;
}

export function pct(parte: number, total: number): string {
  return total ? `${Math.round((parte / total) * 100)} %` : "—";
}
