/** Plantilla de contrato de prestación de servicios — derecho colombiano (partes privadas). */

export type ContratoPrestacionDatos = {
  /** Contratante (McKenna por defecto) */
  contratanteRazon: string;
  contratanteNit: string;
  contratanteRepLegal: string;
  contratanteRepId: string;
  contratanteDireccion: string;
  contratanteCiudad: string;
  contratanteEmail: string;
  /** Contratista */
  contratistaRazon: string;
  contratistaTipoId: "CC" | "CE" | "NIT" | "PA";
  contratistaId: string;
  contratistaDireccion: string;
  contratistaCiudad: string;
  contratistaEmail: string;
  contratistaTelefono: string;
  /** Contrato */
  objeto: string;
  obligacionesContratista: string;
  obligacionesContratante: string;
  fechaInicio: string;
  fechaFin: string;
  valorTotal: string;
  formaPago: string;
  ciudadFirma: string;
  fechaFirma: string;
};

export const CONTRATANTE_MCKENNA_DEFAULT: Pick<
  ContratoPrestacionDatos,
  | "contratanteRazon"
  | "contratanteNit"
  | "contratanteRepLegal"
  | "contratanteRepId"
  | "contratanteDireccion"
  | "contratanteCiudad"
  | "contratanteEmail"
> = {
  contratanteRazon: "McKenna Group S.A.S.",
  contratanteNit: "901.234.567-8",
  contratanteRepLegal: "[Nombre representante legal]",
  contratanteRepId: "[C.C. representante]",
  contratanteDireccion: "[Dirección sede principal], Bogotá D.C.",
  contratanteCiudad: "Bogotá D.C.",
  contratanteEmail: "contacto@mckennagroup.co",
};

export function datosPrestacionVacios(): ContratoPrestacionDatos {
  const hoy = new Date().toISOString().slice(0, 10);
  return {
    ...CONTRATANTE_MCKENNA_DEFAULT,
    contratistaRazon: "",
    contratistaTipoId: "CC",
    contratistaId: "",
    contratistaDireccion: "",
    contratistaCiudad: "Bogotá D.C.",
    contratistaEmail: "",
    contratistaTelefono: "",
    objeto: "",
    obligacionesContratista:
      "Ejecutar el objeto del contrato con diligencia y oportunidad; cumplir las normas aplicables a su actividad; entregar informes o productos pactados; mantener confidencialidad sobre la información de la CONTRATANTE.",
    obligacionesContratante:
      "Pagar oportunamente el valor pactado; suministrar la información y accesos razonables necesarios para la ejecución; recibir a satisfacción los entregables conforme al objeto.",
    fechaInicio: hoy,
    fechaFin: "",
    valorTotal: "",
    formaPago: "Transferencia bancaria a cuenta indicada por el CONTRATISTA, contra cumplimiento de las obligaciones de cada periodo.",
    ciudadFirma: "Bogotá D.C.",
    fechaFirma: hoy,
  };
}

function fmtFecha(iso: string): string {
  if (!iso) return "[fecha]";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const mi = Number(m) - 1;
  return `${Number(d)} de ${meses[mi] ?? m} de ${y}`;
}

function fmtCOP(valor: string): string {
  const n = Number(valor.replace(/[^\d]/g, ""));
  if (!n) return valor || "[valor en pesos COP]";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

export function tituloDesdeContrato(d: ContratoPrestacionDatos): string {
  const nombre = d.contratistaRazon.trim() || "Contratista";
  return `Contrato prestación de servicios — ${nombre}`.slice(0, 150);
}

export function generarTextoContratoPrestacion(d: ContratoPrestacionDatos): string {
  const contratistaId = `${d.contratistaTipoId} ${d.contratistaId}`.trim();
  const vigencia = d.fechaFin
    ? `desde el ${fmtFecha(d.fechaInicio)} hasta el ${fmtFecha(d.fechaFin)}`
    : `a partir del ${fmtFecha(d.fechaInicio)} por el término que dure la ejecución del objeto`;

  return `CONTRATO DE PRESTACIÓN DE SERVICIOS

En ${d.ciudadFirma || "Bogotá D.C."}, a los ${fmtFecha(d.fechaFirma)}, comparecen:

CONTRATANTE: ${d.contratanteRazon}, identificada con NIT ${d.contratanteNit}, representada legalmente por ${d.contratanteRepLegal}, identificado(a) con ${d.contratanteRepId}, con domicilio en ${d.contratanteDireccion}, correo ${d.contratanteEmail}, quien en adelante se denominará "LA CONTRATANTE".

CONTRATISTA: ${d.contratistaRazon || "[Nombre o razón social del contratista]"}, identificado(a) con ${contratistaId || "[tipo y número de documento]"}, con domicilio en ${d.contratistaDireccion || "[dirección]"}, ${d.contratistaCiudad || "[ciudad]"}, correo ${d.contratistaEmail || "[correo]"}, teléfono ${d.contratistaTelefono || "[teléfono]"}, quien en adelante se denominará "EL CONTRATISTA".

Las partes, mayores de edad y hábiles para contratar, acuerdan celebrar el presente contrato de prestación de servicios, sujeto a la legislación colombiana, en especial al Código Civil, al Código de Comercio y a la Ley 527 de 1999 en lo pertinente, bajo las siguientes cláusulas:

PRIMERA. OBJETO. EL CONTRATISTA se obliga a prestar a favor de LA CONTRATANTE los siguientes servicios:

${d.objeto || "[Describir detalladamente el objeto del contrato]"}

SEGUNDA. OBLIGACIONES DEL CONTRATISTA. Sin perjuicio de las demás obligaciones legales y contractuales, EL CONTRATISTA deberá:

${d.obligacionesContratista}

TERCERA. OBLIGACIONES DE LA CONTRATANTE. LA CONTRATANTE deberá:

${d.obligacionesContratante}

CUARTA. PLAZO Y VIGENCIA. El presente contrato tendrá vigencia ${vigencia}, salvo terminación anticipada conforme a este documento.

QUINTA. VALOR Y FORMA DE PAGO. El valor total del contrato es de ${fmtCOP(d.valorTotal)}. ${d.formaPago}

SEXTA. RETENCIONES Y TRIBUTOS. Cada parte asumirá los impuestos, retenciones y aportes de ley que le correspondan conforme a la normatividad tributaria y de seguridad social vigente en Colombia, incluyendo, cuando aplique, retención en la fuente por pagos a título de honorarios o servicios, IVA y demás gravámenes. EL CONTRATISTA declara que actúa de manera independiente y que es responsable del pago de sus obligaciones fiscales y de seguridad social derivadas de la actividad contratada.

SÉPTIMA. INDEPENDENCIA LABORAL. Las partes declaran expresamente que el presente contrato no constituye relación laboral entre LA CONTRATANTE y EL CONTRATISTA, de conformidad con el artículo 23 del Código Sustantivo del Trabajo y el artículo 33 de la Ley 789 de 2002. EL CONTRATISTA conserva autonomía técnica, administrativa y financiera en la ejecución del objeto; no existe subordinación, horario fijo impuesto por LA CONTRATANTE ni prestación personal continua e indispensable de servicios propios del giro ordinario de la empresa.

OCTAVA. CONFIDENCIALIDAD. EL CONTRATISTA se obliga a mantener reserva sobre la información comercial, técnica, financiera y personal a la que acceda con ocasión del contrato, incluso después de su terminación, salvo autorización escrita de LA CONTRATANTE o mandato legal.

NOVENA. PROPIEDAD INTELECTUAL. Los resultados, entregables, documentos, desarrollos o materiales producidos por EL CONTRATISTA en ejecución del contrato y pagados por LA CONTRATANTE serán de propiedad de LA CONTRATANTE, salvo pacto escrito en contrario.

DÉCIMA. TERMINACIÓN. El contrato podrá darse por terminado: (i) por mutuo acuerdo; (ii) por incumplimiento grave de cualquiera de las partes, previo requerimiento escrito y término razonable para subsanar, cuando ello sea posible; (iii) por vencimiento del plazo; o (iv) por cualquier causa legal aplicable. La terminación no exime del pago de obligaciones causadas hasta la fecha ni de las responsabilidades derivadas del incumplimiento.

UNDÉCIMA. CLÁUSULA PENAL Y MORA. En caso de mora en el pago de sumas líquidas y exigibles, LA CONTRATANTE reconocerá intereses moratorios conforme a la tasa máxima legal vigente. En caso de incumplimiento grave, la parte afectada podrá exigir el cumplimiento y/o la indemnización de perjuicios demostrados.

DUODÉCIMA. SOLUCIÓN DE CONFLICTOS. Las diferencias derivadas del presente contrato se resolverán, en primer lugar, mediante conciliación ante centro de conciliación en ${d.ciudadFirma || "Bogotá D.C."}. Si no hubiere acuerdo, las partes se someten a la jurisdicción ordinaria de los jueces de la República de Colombia, con domicilio contractual en ${d.ciudadFirma || "Bogotá D.C."}.

DÉCIMO TERCERA. NOTIFICACIONES. Toda comunicación relacionada con este contrato se entenderá válidamente efectuada al correo electrónico o dirección física registrada por cada parte en el encabezado, salvo que una parte notifique por escrito un cambio.

DÉCIMO CUARTA. PERFECCIONAMIENTO. El presente contrato se perfecciona con la firma de las partes y surte efectos desde la fecha de inicio indicada, o desde la firma si no hubiere fecha distinta.

En constancia se firma en dos (2) ejemplares del mismo tenor, el ${fmtFecha(d.fechaFirma)}.


_______________________________          _______________________________
${d.contratanteRepLegal}                   ${d.contratistaRazon || "CONTRATISTA"}
Representante Legal                      Contratista
${d.contratanteRazon}                    ${contratistaId || ""}
NIT ${d.contratanteNit}


NOTA: Plantilla orientativa conforme a derecho colombiano para contratos entre particulares.
Revise con abogado antes de firmar. Ajuste datos del representante legal y NIT si aplica.
`;
}

export function generarArchivoContrato(d: ContratoPrestacionDatos): File {
  const texto = generarTextoContratoPrestacion(d);
  const slug = (d.contratistaRazon || "contratista")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "contratista";
  const nombre = `Contrato_Prestacion_Servicios_${slug}.txt`;
  return new File([texto], nombre, { type: "text/plain;charset=utf-8" });
}

export function resumenContrato(d: ContratoPrestacionDatos): string {
  return [
    `Tipo: Prestación de servicios (Colombia)`,
    `Contratista: ${d.contratistaRazon || "—"} (${d.contratistaTipoId} ${d.contratistaId || "—"})`,
    `Objeto: ${d.objeto || "—"}`,
    `Vigencia: ${fmtFecha(d.fechaInicio)}${d.fechaFin ? ` → ${fmtFecha(d.fechaFin)}` : ""}`,
    `Valor: ${fmtCOP(d.valorTotal)}`,
    `Ciudad firma: ${d.ciudadFirma}`,
  ].join("\n");
}
