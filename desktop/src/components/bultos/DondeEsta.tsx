import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Ico } from "../../icons/Ico";
import { Miniatura, cantidadTexto, urlFotoBulto, useTokenSesion, type Bulto } from "./bultosComun";

/**
 * «¿Dónde está?» dentro de una solicitud: si el título o la descripción mencionan un
 * producto que tiene bultos registrados, muestra la foto y el lugar de cada uno — el
 * operario que va a «empacar quinua roja 500 g» ve el bulto sin preguntar en el grupo.
 * Si no hay coincidencias no dibuja nada. Backend: POST /api/bultos/en-texto (sin LLM).
 */

type Producto = { sku: string; nombre: string; bultos: Bulto[] };

export default function DondeEsta({ texto, compacto = false }: { texto: string; compacto?: boolean }) {
  const token = useTokenSesion();
  const limpio = (texto || "").trim().slice(0, 2000);
  const q = useQuery<{ productos: Producto[] }>({
    queryKey: ["bultos-en-texto", limpio],
    queryFn: () => api.post("/api/bultos/en-texto", { texto: limpio }),
    enabled: limpio.length >= 3 && Boolean(token),
    staleTime: 60_000,
    retry: false,
  });
  const productos = q.data?.productos ?? [];
  if (!productos.length) return null;

  return (
    <div className="space-y-1.5 rounded-xl border-2 border-accent/40 bg-accent/5 p-2.5" onClick={(e) => e.stopPropagation()}>
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-accent"><Ico e="📍" /> ¿Dónde está?</p>
      {productos.map((p) => (
        <div key={p.sku} className="space-y-1">
          <p className="text-[12.5px] font-bold text-ink">{p.nombre} <code className="text-[10.5px] font-normal text-muted">{p.sku}</code></p>
          <div className={`grid gap-1.5 ${compacto ? "" : "sm:grid-cols-2"}`}>
            {p.bultos.slice(0, compacto ? 2 : 4).map((b) => (
              <div key={b.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-1.5">
                {b.fotos[0]
                  ? <Miniatura src={urlFotoBulto(b.fotos[0].archivo, token)} tam={compacto ? 48 : 64}
                      pie={<><b>{b.nombre}</b> · {b.sede} · {b.ubicacion}</>} />
                  : null}
                <span className="min-w-0">
                  <span className="block text-[13px] font-extrabold leading-tight text-ink">{b.ubicacion}</span>
                  <span className="block text-[11px] text-muted">
                    {b.sede}{cantidadTexto(b) ? ` · ${cantidadTexto(b)}` : ""}{b.lote ? ` · lote ${b.lote}` : ""} · {b.codigo}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {p.bultos.length > (compacto ? 2 : 4) && (
            <p className="text-[11px] text-muted">+{p.bultos.length - (compacto ? 2 : 4)} bulto(s) más en Recepción → «Dónde está cada bulto».</p>
          )}
        </div>
      ))}
    </div>
  );
}
