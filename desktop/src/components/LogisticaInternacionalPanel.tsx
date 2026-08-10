import { useAppStore } from "../stores/app";
import { Icon } from "../icons";
import type { IconName } from "../icons/types";
import type { LogisticaPanel } from "../lib/logisticaAccess";
import ImportacionesPanel from "./ImportacionesPanel";

interface SeccionDef {
  id: LogisticaPanel;
  titulo: string;
  descripcion: string;
  icon: IconName;
  proximamente: string[];
}

const SECCIONES: Record<LogisticaPanel, SeccionDef> = {
  "logistica-importaciones": {
    id: "logistica-importaciones",
    titulo: "Importaciones",
    descripcion: "Facturas de compra internacional, codificación SIIGO y archivos Excel/XML.",
    icon: "logistica-importaciones",
    proximamente: [
      "Cola de facturas XML desde Gmail",
      "Generación de registro de productos",
      "Historial de importaciones procesadas",
    ],
  },
  "logistica-embarques": {
    id: "logistica-embarques",
    titulo: "Embarques",
    descripcion: "Registro de envíos marítimos y aéreos desde origen hasta llegada a bodega.",
    icon: "logistica-embarques",
    proximamente: [
      "Crear y editar embarques por proveedor",
      "ETD / ETA y estado del contenedor",
      "Alertas de llegada próxima",
    ],
  },
  "logistica-aduanas": {
    id: "logistica-aduanas",
    titulo: "Aduana",
    descripcion: "Declaraciones de importación, DIM, levante y documentación DIAN.",
    icon: "logistica-aduanas",
    proximamente: [
      "Checklist documental por embarque",
      "Registro de número de declaración",
      "Estado de levante y pagos arancelarios",
    ],
  },
  "logistica-proveedores": {
    id: "logistica-proveedores",
    titulo: "Proveedores",
    descripcion: "Directorio de proveedores internacionales y condiciones de compra.",
    icon: "logistica-proveedores",
    proximamente: [
      "Ficha por proveedor (país, incoterm, moneda)",
      "Contactos y términos de pago",
      "Vinculación con facturas y embarques",
    ],
  },
  "logistica-seguimiento": {
    id: "logistica-seguimiento",
    titulo: "Seguimiento",
    descripcion: "Línea de tiempo unificada: orden → embarque → aduana → ingreso a inventario.",
    icon: "logistica-seguimiento",
    proximamente: [
      "Vista kanban por etapa",
      "Búsqueda por factura, BL o contenedor",
      "Integración con tickets de logística",
    ],
  },
};

function panelActivo(raw: string): LogisticaPanel {
  if (raw in SECCIONES) return raw as LogisticaPanel;
  return "logistica-importaciones";
}

export default function LogisticaInternacionalPanel() {
  const panel = useAppStore((s) => s.panel);
  const seccion = panelActivo(panel);
  const def = SECCIONES[seccion];

  if (seccion === "logistica-importaciones") {
    return <ImportacionesPanel />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-paper border-2 border-border bg-surface-panel shadow-paper-sm">
          <Icon name={def.icon} size={28} weight="bold" className="text-accent" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
            Logística Internacional
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{def.titulo}</h1>
          <p className="mt-1 text-sm text-muted">{def.descripcion}</p>
        </div>
      </div>

      <div className="mt-8 rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-sm">
        <h2 className="text-base font-bold text-ink">Próximamente</h2>
        <ul className="mt-3 space-y-2">
          {def.proximamente.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-ink-secondary">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
