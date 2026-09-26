/**
 * Catálogo de permisos para "Gestión de usuarios → Accesos al panel".
 *
 * NO es una lista escrita a mano: se DERIVA de `NAV_SECTIONS` (las secciones
 * reales del menú) y se valida contra `puedeVerSeccionPanel` (la función que
 * decide el acceso). Así, un panel nuevo aparece como casilla sin que nadie se
 * acuerde de agregarlo acá.
 *
 * Nació de un problema real (15-sep-2026): la lista estaba escrita a mano y
 * ofrecía 22 de los 48 permisos que el código honra. Faltaban, entre otros,
 * `pagos` (Solicitudes de pago), `prestamos`, `socios`,
 * `conciliacion-contador`, `whatsapp` (Agente WA) y `guias-envio`: no había
 * forma de darle a nadie esos accesos desde el panel — el permiso existía en
 * el código y en la base, pero no en la UI que lo otorga.
 */
import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import { PANEL_INFO } from "./panelInfo";
import { NAV_SECTIONS, NAV_CATEGORY_LABEL, type NavCategory } from "./navStructure";
import { puedeVerSeccionPanel } from "./panelAccess";
import { LOGISTICA_PERMISO } from "./logisticaAccess";

export interface PermisoDef {
  /** Clave que se guarda en `usuarios.permisos_secciones`. */
  id: string;
  label: string;
  /** De dónde más se hereda, o por qué es estricto. */
  nota?: string;
}

export interface PermisoGrupo {
  id: string;
  label: string;
  permisos: PermisoDef[];
}

/** Usuario de sondeo: operario sin privilegios especiales ni elevaciones por id/email. */
const SONDA: TicketsUser = {
  id: -1,
  nombre: "Sonda de permisos",
  username: "__sonda_permisos__",
  activo: 1,
  foto: null,
  rol: { id: 0, nombre: "Operario", nivel: 1 },
  departamento: null,
  permisos_secciones: {},
};

function conClave(clave: string): TicketsUser {
  return { ...SONDA, permisos_secciones: { [clave]: true } };
}

/** El panel se ve sin ningún permiso (Etiquetas, Empaque, Ajustes…): no necesita casilla. */
function esLibre(seccion: string): boolean {
  return puedeVerSeccionPanel({ ...SONDA, permisos_secciones: {} }, seccion);
}

/** Paneles cuya clave de permiso no es su propio id. */
const CLAVES_ALTERNAS: Partial<Record<string, string[]>> = {
  hugo: ["tickets"],
  // El expediente de anulaciones tiene la sensibilidad del Libro Mayor y usa
  // su mismo permiso a propósito (ver contabilidadAccess).
  anulaciones: ["libro-mayor"],
  "logistica-importaciones": [LOGISTICA_PERMISO],
  "logistica-embarques": [LOGISTICA_PERMISO],
  "logistica-aduanas": [LOGISTICA_PERMISO],
  "logistica-proveedores": [LOGISTICA_PERMISO],
  "logistica-seguimiento": [LOGISTICA_PERMISO],
};

/** Paneles sin casilla propia: se abren con cualquier permiso del hub. */
const SIN_CASILLA = new Set<string>(["contabilidad-inicio"]);

const NOTAS: Record<string, string> = {
  postventa: "también se abre con Preventa MeLi",
  "ventas-email": "también se abre con Preventa MeLi",
  "vitrina-web": "también se abre con Publicaciones",
  "canales-producto": "también se abre con Publicaciones o Mapa del sistema",
  "recepcion-mercancia": "también se abre con Pedidos, Empaque, Control de inventario o Stock",
  "chat-equipo": "abierto a todo el equipo interno; cada canal define sus miembros",
  "guias-envio": "también se abre con Pedidos Web o Empaque",
  "entregas-flex": "también se abre con Pedidos Web, Empaque o Guías de envío",
  "mapa-sistema": "vista de administración: sin este permiso solo la ve un administrador",
  colaboradores: "diagramas compartidos con colaboradores externos (el anfitrión es Armando)",
  arquitectura: "solo administrador: es el mapa interno del sistema y con él se planean borrados",
  combos: "también abre el Mapa del sistema en la API",
  producto: "también se abre con Combos o Mapa del sistema",
  "libro-mayor": "permiso propio: no se hereda de Facturación ni Sync",
  pagos: "mueve plata y crea asientos — permiso propio",
  prestamos: "datos de socios y familiares — permiso propio",
  socios: "expediente fiscal del socio — cada uno ve solo el suyo",
  "conciliacion-contador": "retenciones por tercero — como Libro Mayor",
  "cotizar-facturar": "emite facturas DIAN reales — permiso propio",
  mensajeria: "también se abre con Servicios, Operativos o Pedidos Web",
  operativos: "incluye RR.HH., Impuestos, Servicios y Mensajería",
  facturacion: "también se abre con Facturas de compra o Sincronización",
  [LOGISTICA_PERMISO]: "cubre importaciones, embarques, aduanas y proveedores",
};

/** Permisos que no tienen panel propio en el menú (subvistas y módulos sin botón). */
const EXTRAS: Partial<Record<NavCategory, PermisoDef[]>> = {
  inicio: [
    {
      id: "colaborador_externo",
      label: "Colaborador externo (solo Colaboradores + Agenda con Armando)",
      nota: "no ve a los demás usuarios ni el resto de la app",
    },
    {
      id: "tickets_protocolos_crear",
      label: "Crear protocolos",
      nota: "acción dentro de Agenda, no un panel",
    },
  ],
  contabilidad: [
    { id: "impuestos", label: "Pagos de impuestos" },
    { id: "servicios", label: "Servicios" },
    { id: "mensajeria", label: "Pagos de mensajería / envíos" },
    { id: "rrhh", label: "RR.HH. · Compensaciones", nota: "vive dentro de Operativos" },
    { id: "productos-siigo", label: "Productos Alegra (crear/editar)" },
    {
      id: "contador",
      label: "Contador externo (solo consulta)",
      nota: "ve todo el Libro Mayor y comenta en el historial de terceros; no modifica nada ni ve el resto de la app",
    },
  ],
  facturacion: [
    { id: "facturas", label: "Facturas de compra" },
    { id: "sync", label: "Sincronización MeLi ↔ Alegra" },
    { id: "astro-killer", label: "Astro Killer (trazabilidad venta → factura)" },
    { id: "cotizar-facturar", label: "Cotizar / Facturar directo" },
  ],
};

/** Grupos que no salen de NAV_SECTIONS (módulos sin sección en el menú). */
const GRUPOS_EXTRA: PermisoGrupo[] = [
  {
    id: "logistica",
    label: "Logística Internacional",
    permisos: [{ id: LOGISTICA_PERMISO, label: "Logística Internacional", nota: NOTAS[LOGISTICA_PERMISO] }],
  },
];

function claveDePanel(panel: Panel): string | null {
  const candidatas = [panel as string, ...(CLAVES_ALTERNAS[panel] ?? [])];
  for (const clave of candidatas) {
    if (puedeVerSeccionPanel(conClave(clave), panel)) return clave;
  }
  return null;
}

/**
 * Casillas de "Accesos al panel", agrupadas como el menú.
 * Cada clave está verificada: activarla abre de verdad ese panel.
 */
export function catalogoPermisos(): PermisoGrupo[] {
  const vistos = new Set<string>();
  const grupos: PermisoGrupo[] = [];

  for (const seccion of NAV_SECTIONS) {
    const permisos: PermisoDef[] = [];
    for (const item of seccion.items) {
      const panel = item.panel;
      if (SIN_CASILLA.has(panel) || esLibre(panel)) continue;
      const clave = claveDePanel(panel);
      if (!clave || vistos.has(clave)) continue;
      vistos.add(clave);
      const label = PANEL_INFO[panel]?.label ?? panel;
      permisos.push({ id: clave, label, nota: NOTAS[clave] });
    }
    for (const extra of EXTRAS[seccion.id] ?? []) {
      if (vistos.has(extra.id)) continue;
      vistos.add(extra.id);
      permisos.push({ ...extra, nota: extra.nota ?? NOTAS[extra.id] });
    }
    if (permisos.length) {
      grupos.push({ id: seccion.id, label: NAV_CATEGORY_LABEL[seccion.id], permisos });
    }
  }

  for (const grupo of GRUPOS_EXTRA) {
    const permisos = grupo.permisos.filter((p) => !vistos.has(p.id));
    permisos.forEach((p) => vistos.add(p.id));
    if (permisos.length) grupos.push({ ...grupo, permisos });
  }

  return grupos;
}

/**
 * Claves guardadas que hoy no controlan nada: ni tienen casilla ni las lee el
 * código (p. ej. los `tickets_*` de la primera versión del panel). No cuentan
 * como legado las de paneles abiertos para todos (Etiquetas, Empaque, Ajustes):
 * ahí el permiso es redundante, no huérfano.
 */
export function permisosDesconocidos(permisos: Record<string, boolean> | null | undefined): string[] {
  if (!permisos) return [];
  const vivos = new Set(catalogoPermisos().flatMap((g) => g.permisos.map((p) => p.id)));
  for (const seccion of NAV_SECTIONS) {
    for (const item of seccion.items) if (esLibre(item.panel)) vivos.add(item.panel);
  }
  vivos.add("settings");
  vivos.add("perfil");
  return Object.keys(permisos).filter((k) => !vivos.has(k) && permisos[k]);
}
