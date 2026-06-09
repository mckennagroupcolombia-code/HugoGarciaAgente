import { useMemo, useState } from "react";
import { ProseTextarea } from "./ProseTextarea";
import {
  type ContratoPrestacionDatos,
  datosPrestacionVacios,
  generarArchivoContrato,
  generarTextoContratoPrestacion,
} from "../lib/contratoPrestacionServicios";

const GRID_2 = "grid gap-4 sm:grid-cols-2";

type Props = {
  onDatosChange: (datos: ContratoPrestacionDatos, archivo: File | null) => void;
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">
        {label}{required ? " *" : ""}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent";

export function ContratoPlantillaForm({ onDatosChange }: Props) {
  const [datos, setDatos] = useState<ContratoPrestacionDatos>(datosPrestacionVacios);
  const [archivoGen, setArchivoGen] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const preview = useMemo(() => generarTextoContratoPrestacion(datos), [datos]);

  function patch(p: Partial<ContratoPrestacionDatos>) {
    setDatos((prev) => {
      const next = { ...prev, ...p };
      onDatosChange(next, archivoGen);
      return next;
    });
  }

  function generarDocumento() {
    const f = generarArchivoContrato(datos);
    setArchivoGen(f);
    onDatosChange(datos, f);
  }

  function descargar() {
    const f = archivoGen ?? generarArchivoContrato(datos);
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 rounded-paper border-2 border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700/60 dark:bg-slate-950/30">
      <div>
        <h3 className="text-sm font-extrabold text-ink">Plantilla — Prestación de servicios</h3>
        <p className="mt-1 text-xs text-muted">
          Contrato entre particulares conforme a derecho colombiano (Código Civil, independencia laboral Ley 789/2002).
          Complete los campos, genere el documento y adjúntelo al registro.
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Contratante (McKenna)</p>
        <div className={GRID_2}>
          <Field label="Razón social">
            <input className={inputCls} value={datos.contratanteRazon}
              onChange={(e) => patch({ contratanteRazon: e.target.value })} />
          </Field>
          <Field label="NIT">
            <input className={inputCls} value={datos.contratanteNit}
              onChange={(e) => patch({ contratanteNit: e.target.value })} />
          </Field>
          <Field label="Representante legal">
            <input className={inputCls} value={datos.contratanteRepLegal}
              onChange={(e) => patch({ contratanteRepLegal: e.target.value })} />
          </Field>
          <Field label="Documento representante">
            <input className={inputCls} value={datos.contratanteRepId}
              onChange={(e) => patch({ contratanteRepId: e.target.value })} />
          </Field>
          <Field label="Dirección">
            <input className={inputCls} value={datos.contratanteDireccion}
              onChange={(e) => patch({ contratanteDireccion: e.target.value })} />
          </Field>
          <Field label="Correo">
            <input className={inputCls} type="email" value={datos.contratanteEmail}
              onChange={(e) => patch({ contratanteEmail: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Contratista</p>
        <div className={GRID_2}>
          <Field label="Nombre o razón social" required>
            <input className={inputCls} value={datos.contratistaRazon} required
              onChange={(e) => patch({ contratistaRazon: e.target.value })}
              placeholder="Ej: Juan Pérez / Empresa XYZ S.A.S." />
          </Field>
          <div className={GRID_2}>
            <Field label="Tipo ID" required>
              <select className={inputCls} value={datos.contratistaTipoId}
                onChange={(e) => patch({ contratistaTipoId: e.target.value as ContratoPrestacionDatos["contratistaTipoId"] })}>
                <option value="CC">C.C.</option>
                <option value="CE">C.E.</option>
                <option value="NIT">NIT</option>
                <option value="PA">Pasaporte</option>
              </select>
            </Field>
            <Field label="Número" required>
              <input className={inputCls} value={datos.contratistaId} required
                onChange={(e) => patch({ contratistaId: e.target.value })} />
            </Field>
          </div>
          <Field label="Dirección">
            <input className={inputCls} value={datos.contratistaDireccion}
              onChange={(e) => patch({ contratistaDireccion: e.target.value })} />
          </Field>
          <Field label="Ciudad">
            <input className={inputCls} value={datos.contratistaCiudad}
              onChange={(e) => patch({ contratistaCiudad: e.target.value })} />
          </Field>
          <Field label="Correo">
            <input className={inputCls} type="email" value={datos.contratistaEmail}
              onChange={(e) => patch({ contratistaEmail: e.target.value })} />
          </Field>
          <Field label="Teléfono">
            <input className={inputCls} value={datos.contratistaTelefono}
              onChange={(e) => patch({ contratistaTelefono: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Términos del contrato</p>
        <Field label="Objeto del contrato" required>
          <ProseTextarea className={`${inputCls} resize-none`} rows={3} required
            value={datos.objeto} onChange={(e) => patch({ objeto: e.target.value })}
            placeholder="Describa el servicio: alcance, entregables, lugar de ejecución…" />
        </Field>
        <Field label="Obligaciones del contratista">
          <ProseTextarea className={`${inputCls} resize-none`} rows={3}
            value={datos.obligacionesContratista}
            onChange={(e) => patch({ obligacionesContratista: e.target.value })} />
        </Field>
        <Field label="Obligaciones del contratante">
          <ProseTextarea className={`${inputCls} resize-none`} rows={2}
            value={datos.obligacionesContratante}
            onChange={(e) => patch({ obligacionesContratante: e.target.value })} />
        </Field>
        <div className={GRID_2}>
          <Field label="Fecha inicio" required>
            <input className={inputCls} type="date" required value={datos.fechaInicio}
              onChange={(e) => patch({ fechaInicio: e.target.value })} />
          </Field>
          <Field label="Fecha fin (opcional)">
            <input className={inputCls} type="date" value={datos.fechaFin}
              onChange={(e) => patch({ fechaFin: e.target.value })} />
          </Field>
          <Field label="Valor total (COP)" required>
            <input className={inputCls} value={datos.valorTotal} required
              onChange={(e) => patch({ valorTotal: e.target.value })}
              placeholder="Ej: 5000000" />
          </Field>
          <Field label="Ciudad de firma">
            <input className={inputCls} value={datos.ciudadFirma}
              onChange={(e) => patch({ ciudadFirma: e.target.value })} />
          </Field>
          <Field label="Fecha de firma">
            <input className={inputCls} type="date" value={datos.fechaFirma}
              onChange={(e) => patch({ fechaFirma: e.target.value })} />
          </Field>
        </div>
        <Field label="Forma de pago">
          <ProseTextarea className={`${inputCls} resize-none`} rows={2}
            value={datos.formaPago} onChange={(e) => patch({ formaPago: e.target.value })} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={generarDocumento}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
          Generar documento para adjuntar
        </button>
        <button type="button" onClick={() => setShowPreview((v) => !v)}
          className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
          {showPreview ? "Ocultar vista previa" : "Vista previa"}
        </button>
        {(archivoGen || datos.contratistaRazon) && (
          <button type="button" onClick={descargar}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-accent transition hover:bg-accent/10">
            Descargar .txt
          </button>
        )}
      </div>

      {archivoGen && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          Documento listo: <strong>{archivoGen.name}</strong> — se adjuntará al crear el registro.
        </div>
      )}

      {showPreview && (
        <div className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-panel p-4">
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink">{preview}</pre>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted">
        Incluye cláusulas de independencia laboral, confidencialidad, retenciones, terminación y jurisdicción colombiana.
        Revise con abogado antes de firmar.
      </p>
    </div>
  );
}
