import { useEffect, useState } from "react";
import { api } from "../api/client";

/** Selector de destino del bridge supervisor: contactos guardados o número escrito a mano.
 *  Compartido por «Enviar Voz» y «Grabar pantalla» (los dos salen por el bridge :3001). */

export interface ContactoSupervisor {
  nombre: string;
  numero: string;
}

const NUMERO_LIBRE = "__libre__";

export function formatNumeroWa(num: string | null): string {
  if (!num) return "—";
  const digits = num.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) {
    const local = digits.slice(2);
    return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  return `+${digits}`;
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function useDestinoSupervisor() {
  const [contactos, setContactos] = useState<ContactoSupervisor[]>([]);
  const [seleccion, setSeleccion] = useState("");
  const [numeroLibre, setNumeroLibre] = useState("");

  useEffect(() => {
    api.get<Record<string, string>>("/api/supervisor/bridge/contactos")
      .then((d) => {
        const lista = Object.entries(d)
          .filter(([k]) => !k.startsWith("_"))
          .map(([nombre, numero]) => ({ nombre, numero }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
        setContactos(lista);
        if (lista.length > 0) setSeleccion(lista[0].nombre);
      })
      .catch(() => {});
  }, []);

  const contacto = contactos.find((c) => c.nombre === seleccion);

  // El bridge solo entiende números — resolvemos el número real del contacto
  const numero = seleccion === NUMERO_LIBRE
    ? numeroLibre.trim()
    : (contacto?.numero ?? seleccion);

  const etiqueta = seleccion === NUMERO_LIBRE
    ? numeroLibre.trim()
    : contacto
      ? `${capitalizar(contacto.nombre)} (${formatNumeroWa(contacto.numero)})`
      : seleccion;

  return { contactos, seleccion, setSeleccion, numeroLibre, setNumeroLibre, numero, etiqueta };
}

export function SelectorDestino({ destino }: { destino: ReturnType<typeof useDestinoSupervisor> }) {
  const { contactos, seleccion, setSeleccion, numeroLibre, setNumeroLibre } = destino;
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted uppercase tracking-wide">
        Destino
      </label>

      {contactos.length === 0 ? (
        <p className="text-xs text-muted">
          Sin contactos guardados. Agrégalos en la pestaña <strong>Contactos</strong>.
        </p>
      ) : (
        <select
          value={seleccion}
          onChange={(e) => setSeleccion(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent appearance-none cursor-pointer"
        >
          {contactos.map((c) => (
            <option key={c.nombre} value={c.nombre}>
              {capitalizar(c.nombre)}
              {" — "}
              {formatNumeroWa(c.numero)}
            </option>
          ))}
          <option value={NUMERO_LIBRE}>✏️  Escribir número manualmente…</option>
        </select>
      )}

      {(seleccion === NUMERO_LIBRE || contactos.length === 0) && (
        <input
          type="tel"
          value={numeroLibre}
          onChange={(e) => {
            setNumeroLibre(e.target.value);
            if (contactos.length === 0) setSeleccion(NUMERO_LIBRE);
          }}
          placeholder="573001234567"
          autoFocus={contactos.length > 0}
          className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:border-accent mt-1"
        />
      )}
    </div>
  );
}
