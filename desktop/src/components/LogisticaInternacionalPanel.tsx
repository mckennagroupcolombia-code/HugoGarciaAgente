import { useAppStore } from "../stores/app";
import { Icon } from "../icons";
import type { IconName } from "../icons/types";
import type { LogisticaPanel } from "../lib/logisticaAccess";
import ImportacionesPanel from "./ImportacionesPanel";
import ProveedoresPanel from "./ProveedoresPanel";

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
    descripcion: "Facturas de compra internacional, codificación Alegra y archivos Excel/XML.",
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
  if (seccion === "logistica-proveedores") {
    return <ProveedoresPanel />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-paper border border-border bg-surface-panel">
          <Icon name={def.icon} size={20} weight="bold" className="text-accent" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-ink">{def.titulo}</h1>
        </div>
      </div>

      <div className="mt-3 rounded-paper border border-border bg-surface-panel p-3">
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
