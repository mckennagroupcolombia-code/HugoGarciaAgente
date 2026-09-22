import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

/**
 * Arquitectura del código: qué depende de qué, y qué código no usa nadie.
 *
 * Lo derivado del código real, no dibujado a mano. El Mapa del sistema cuenta
 * el flujo del negocio (combo → documento → etiqueta → publicación); esto
 * cuenta el flujo de las llamadas entre archivos, que es otra pregunta: dónde
 * se concentran las dependencias y qué se puede borrar sin romper nada.
 *
 * Lee `/api/arquitectura/*` (app/routes_arquitectura.py), que a su vez sirve
 * los JSON de scripts/arquitectura_cbm.py. Sin LLM y sin salir a Alegra ni a
 * MeLi: se puede dejar abierto. Como es un snapshot y no una consulta viva,
 * cada pestaña muestra de cuándo son los datos.
 *
 * EL NÚMERO DE CÓDIGO MUERTO NO ES UNA ORDEN DE BORRAR. El embudo está a la
 * vista justamente para eso: el grafo marca ~2.900 funciones sin llamadores y
 * casi todas son falsos positivos (referencias JSX y rutas Flask, que no
 * generan arista de llamada). Lo que queda son funciones con una sola mención
 * en todo el repo —su propia definición—, pero revisa antes de borrar.
 */

type Tabla = { cols: string[]; rows: (string | number)[][] };

type Resumen = {
  proyecto: string;
  nodos: number;
  aristas: number;
  generado: string;
  lenguajes: Tabla;
  etiquetas: Tabla;
  tipos_arista: Tabla;
  hotspots: Tabla;
  capas: Tabla;
  paquetes: Tabla;
  rutas: Tabla;
  entry_points: Tabla;
  error?: string;
  mensaje?: string;
};

type FuncionMuerta = { nombre: string; archivo: string; linea: number; lenguaje: string };

type CodigoMuerto = {
  generado: string;
  embudo: {
    sin_llamadores: number;
    candidatos: number;
    descartadas_por_mencion: number;
    descartadas_por_decorador: number;
    confirmadas: number;
  };
  archivos_escaneados: number;
  por_archivo: { archivo: string; muertas: number }[];
  por_lenguaje: { lenguaje: string; muertas: number }[];
  funciones: FuncionMuerta[];
  error?: string;
  mensaje?: string;
};

type NodoGrafo = {
  archivo: string;
  modulo: string;
  lenguaje: string;
  sale: number;
  entra: number;
  interno: number;
};
type AristaGrafo = { origen: string; destino: string; llamadas: number };
type Grafo = {
  generado: string;
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  error?: string;
  mensaje?: string;
};

type Pestana = "diagrama" | "mapa" | "muerto" | "resumen" | "grafo3d";

type Visor = { activo: boolean; url: string; version?: string; upstream?: string; comando?: string; motivo?: string };

const COLOR_MODULO: Record<string, string> = {
  app: "#2563eb",
  desktop: "#7c3aed",
  PAGINA_WEB: "#0d9488",
  tests: "#a16207",
  scripts: "#be185d",
};

function colorDe(modulo: string): string {
  return COLOR_MODULO[modulo] ?? "#64748b";
}

function fecha(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Mensaje de "todavía no hay snapshot", con el comando exacto para generarlo. */
function SinSnapshot({ mensaje }: { mensaje?: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Todavía no hay snapshot de arquitectura.</p>
      <p className="mt-1">{mensaje ?? "Genéralo y vuelve a abrir este panel."}</p>
      <pre className="mt-2 overflow-x-auto rounded bg-amber-100 p-2 text-xs">
        python3 scripts/arquitectura_cbm.py
      </pre>
    </div>
  );
}

/**
 * El grafo como matriz de dependencias, no como nube de puntos.
 *
 * Una nube de 600 nodos se ve impresionante y no se lee. Esto ordena los
 * archivos por cuánto los llaman y muestra, de cada uno, quién lo llama y a
 * quién llama: la pregunta que uno trae cuando va a tocar un archivo.
 */
function MapaDependencias({ grafo }: { grafo: Grafo }) {
  const [modulo, setModulo] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);

  const modulos = useMemo(
    () => Array.from(new Set(grafo.nodos.map((n) => n.modulo))).sort(),
    [grafo.nodos],
  );

  const nodos = useMemo(() => {
    const base = modulo ? grafo.nodos.filter((n) => n.modulo === modulo) : grafo.nodos;
    return [...base].sort((a, b) => b.entra + b.sale - (a.entra + a.sale)).slice(0, 60);
  }, [grafo.nodos, modulo]);

  const { llamanA, llamaDesde } = useMemo(() => {
    if (!sel) return { llamanA: [] as AristaGrafo[], llamaDesde: [] as AristaGrafo[] };
    return {
      llamanA: grafo.aristas.filter((a) => a.destino === sel).sort((x, y) => y.llamadas - x.llamadas),
      llamaDesde: grafo.aristas.filter((a) => a.origen === sel).sort((x, y) => y.llamadas - x.llamadas),
    };
  }, [grafo.aristas, sel]);

  const max = Math.max(1, ...nodos.map((n) => n.entra + n.sale));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setModulo("")}
          className={`rounded-full px-3 py-1 text-xs ${modulo === "" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}
        >
          Todos ({grafo.nodos.length})
        </button>
        {modulos.map((m) => (
          <button
            key={m}
            onClick={() => setModulo(m)}
            className={`rounded-full px-3 py-1 text-xs ${modulo === m ? "text-white" : "bg-slate-100 text-slate-700"}`}
            style={modulo === m ? { backgroundColor: colorDe(m) } : undefined}
          >
            {m}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Los {nodos.length} archivos más conectados. La barra es cuántas llamadas entran y salen;
        toca uno para ver de dónde le llegan y a dónde van.
      </p>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-1">
          {nodos.map((n) => {
            const total = n.entra + n.sale;
            const activo = sel === n.archivo;
            return (
              <button
                key={n.archivo}
                onClick={() => setSel(activo ? null : n.archivo)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-50 ${activo ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorDe(n.modulo) }}
                />
                <span className="w-[55%] truncate font-mono" title={n.archivo}>
                  {n.archivo}
                </span>
                <span className="flex-1">
                  <span
                    className="block h-2 rounded"
                    style={{ width: `${(total / max) * 100}%`, backgroundColor: colorDe(n.modulo), opacity: 0.55 }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums text-slate-500">
                  ↓{n.entra} ↑{n.sale}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-slate-200 p-3 text-xs">
          {!sel ? (
            <p className="text-slate-500">Selecciona un archivo para ver sus dependencias.</p>
          ) : (
            <div className="space-y-3">
              <p className="break-all font-mono text-[11px] font-medium text-slate-800">{sel}</p>
              <div>
                <p className="mb-1 font-medium text-slate-600">Lo llaman ({llamanA.length})</p>
                {llamanA.length === 0 ? (
                  <p className="text-slate-400">Nadie, según el grafo.</p>
                ) : (
                  llamanA.slice(0, 12).map((a) => (
                    <p key={a.origen} className="truncate font-mono text-[11px] text-slate-600" title={a.origen}>
                      <span className="tabular-nums text-slate-400">{a.llamadas}×</span> {a.origen}
                    </p>
                  ))
                )}
              </div>
              <div>
                <p className="mb-1 font-medium text-slate-600">Llama a ({llamaDesde.length})</p>
                {llamaDesde.length === 0 ? (
                  <p className="text-slate-400">A nadie del repo.</p>
                ) : (
                  llamaDesde.slice(0, 12).map((a) => (
                    <p key={a.destino} className="truncate font-mono text-[11px] text-slate-600" title={a.destino}>
                      <span className="tabular-nums text-slate-400">{a.llamadas}×</span> {a.destino}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** El embudo del filtrado, visible siempre: sin él el número final no se puede juzgar. */
function Embudo({ e }: { e: CodigoMuerto["embudo"] }) {
  const pasos = [
    { etiqueta: "Sin llamadores en el grafo", n: e.sin_llamadores, nota: "crudo, lleno de falsos positivos" },
    { etiqueta: "Quitando tests y entry points", n: e.candidatos, nota: "candidatos a revisar" },
    { etiqueta: "Referenciadas en otro lugar", n: -e.descartadas_por_mencion, nota: "descartadas: aparecen 2+ veces en el repo" },
    { etiqueta: "Invocadas por decorador", n: -e.descartadas_por_decorador, nota: "descartadas: @app.route y similares" },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-medium text-slate-700">Cómo se llegó al número</p>
      <div className="space-y-1 text-xs">
        {pasos.map((p) => (
          <div key={p.etiqueta} className="flex items-baseline gap-2">
            <span className={`w-16 shrink-0 text-right font-mono tabular-nums ${p.n < 0 ? "text-rose-600" : "text-slate-700"}`}>
              {p.n < 0 ? p.n : p.n}
            </span>
            <span className="text-slate-700">{p.etiqueta}</span>
            <span className="text-slate-400">— {p.nota}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-2 border-t border-slate-300 pt-1">
          <span className="w-16 shrink-0 text-right font-mono text-base font-semibold tabular-nums text-slate-900">
            {e.confirmadas}
          </span>
          <span className="font-medium text-slate-800">con una sola mención: su definición</span>
        </div>
      </div>
    </div>
  );
}

function CodigoMuertoVista({ datos }: { datos: CodigoMuerto }) {
  const [lenguaje, setLenguaje] = useState<string>("");
  const lista = useMemo(
    () => (lenguaje ? datos.funciones.filter((f) => f.lenguaje === lenguaje) : datos.funciones),
    [datos.funciones, lenguaje],
  );

  return (
    <div className="space-y-3">
      <Embudo e={datos.embudo} />

      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        Esto <span className="font-medium">no es una orden de borrar</span>. Es una lista de
        candidatos verificados contra los {datos.archivos_escaneados} archivos fuente versionados.
        Antes de borrar, confirma que no se invoque por un camino que el grafo no ve: reflexión,
        <code className="mx-1 rounded bg-slate-100 px-1">getattr</code>, registros por nombre o
        llamadas desde una plantilla.
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setLenguaje("")}
          className={`rounded-full px-3 py-1 text-xs ${lenguaje === "" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}
        >
          Todas ({datos.embudo.confirmadas})
        </button>
        {datos.por_lenguaje.map((l) => (
          <button
            key={l.lenguaje}
            onClick={() => setLenguaje(l.lenguaje)}
            className={`rounded-full px-3 py-1 text-xs ${lenguaje === l.lenguaje ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            .{l.lenguaje} ({l.muertas})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Función</th>
              <th className="px-3 py-2 font-medium">Archivo</th>
              <th className="px-3 py-2 text-right font-medium">Línea</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={`${f.archivo}:${f.linea}`} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono text-slate-800">{f.nombre}</td>
                <td className="px-3 py-1.5 font-mono text-slate-500">{f.archivo}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{f.linea}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * El grafo en 3D, tal cual lo dibuja codebase-memory-mcp.
 *
 * Es la interfaz HTTP del propio binario (sigma + three.js), servida por Flask
 * bajo /cbm/ con la sesión del panel — el puerto 9749 solo escucha en la
 * máquina y nunca se ve desde la LAN ni por el túnel. Muestra el índice del
 * demonio que esté encendido, que puede ser de otra fecha que los JSON del
 * snapshot: por eso va aparte y con su propio aviso.
 */
function Grafo3D() {
  const visor = useQuery({
    queryKey: ["arquitectura-visor"],
    queryFn: () => api.get<Visor>("/api/arquitectura/visor"),
    refetchInterval: 30_000,
  });
  const [alto, setAlto] = useState<"normal" | "grande">("normal");

  if (visor.isLoading) return <p className="text-sm text-slate-500">Buscando el visor…</p>;
  if (!visor.data?.activo) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">El visor 3D está apagado.</p>
        <p className="mt-1">
          Lo sirve el demonio de codebase-memory-mcp en la máquina del servidor (puerto 9749). Enciéndelo
          desde una terminal y vuelve a esta pestaña:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-amber-100 p-2 text-xs">{visor.data?.comando ?? "codebase-memory-mcp --ui=true"}</pre>
        {visor.data?.motivo && <p className="mt-1 text-xs text-amber-700">({visor.data.motivo} en {visor.data.upstream})</p>}
      </div>
    );
  }
  const src = visor.data.url;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Visor de codebase-memory-mcp {visor.data.version ? `v${visor.data.version}` : ""} · arrastra para girar, rueda
          para acercar, toca un nodo para ver sus relaciones.
        </span>
        <span className="flex items-center gap-2">
          <button
            onClick={() => setAlto((a) => (a === "normal" ? "grande" : "normal"))}
            className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-100"
          >
            {alto === "normal" ? "Más alto" : "Más bajo"}
          </button>
          <a href={src} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Abrir en pestaña nueva ↗
          </a>
        </span>
      </div>
      <iframe
        title="Grafo 3D del código"
        src={src}
        className="w-full rounded-lg border border-slate-200 bg-[#0a0a10]"
        style={{ height: alto === "normal" ? "70vh" : "88vh" }}
        allow="fullscreen"
      />
    </div>
  );
}

/**
 * El diagrama de Archify «Cómo se compone el código»: los grupos de archivos y
 * cuántas llamadas van de uno a otro. Mismo lenguaje visual que «Los flujos del
 * proyecto» del Mapa del sistema, y el mismo endpoint (HTML servido con Bearer y
 * montado como blob, porque un <iframe src> plano no manda el token).
 * Fuente: docs/arquitectura/07-codigo.architecture.json, que escribe
 * scripts/arquitectura_diagrama.py a partir del snapshot; el HTML sale de
 * `python3 scripts/diagramas_arquitectura.py entregar`.
 */
function DiagramaCodigo() {
  const [url, setUrl] = useState<string | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setUrl(null);
    setFalla(null);
    fetchAuthBlobUrl("/api/mapa-sistema/diagramas/07-codigo").then((u) => {
      if (!vivo) return;
      if (u) setUrl(u);
      else setFalla("No hay diagrama generado. Genéralo con: python3 scripts/arquitectura_diagrama.py && python3 scripts/diagramas_arquitectura.py entregar");
    });
    return () => {
      vivo = false;
    };
  }, []);
  if (falla) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Todavía no hay diagrama.</p>
        <pre className="mt-2 overflow-x-auto rounded bg-amber-100 p-2 text-xs">{falla}</pre>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Cada caja es un grupo de archivos; cada flecha, cuántas llamadas van de un grupo a otro (solo dentro del mismo
          lenguaje). Zoom con la rueda, búsqueda y recorridos guiados dentro del diagrama.
        </span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Abrir en pestaña nueva ↗
          </a>
        )}
      </div>
      {url ? (
        <iframe title="Cómo se compone el código" src={url} className="w-full rounded-lg border border-slate-200 bg-white" style={{ height: "78vh" }} />
      ) : (
        <p className="text-sm text-slate-500">Cargando el diagrama…</p>
      )}
    </div>
  );
}

function TablaSimple({ titulo, tabla, limite = 12 }: { titulo: string; tabla?: Tabla; limite?: number }) {
  if (!tabla?.rows?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-xs font-medium text-slate-700">{titulo}</p>
      <table className="w-full text-left text-xs">
        <tbody>
          {tabla.rows.slice(0, limite).map((r, i) => (
            <tr key={i} className="border-t border-slate-100 first:border-0">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`py-1 ${j === 0 ? "font-mono text-slate-700" : "text-right tabular-nums text-slate-500"}`}
                >
                  {String(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ArquitecturaPanel() {
  const [pestana, setPestana] = useState<Pestana>("diagrama");

  const resumen = useQuery({
    queryKey: ["arquitectura-resumen"],
    queryFn: () => api.get<Resumen>("/api/arquitectura/resumen"),
  });
  const grafo = useQuery({
    queryKey: ["arquitectura-grafo"],
    queryFn: () => api.get<Grafo>("/api/arquitectura/grafo"),
    enabled: pestana === "mapa",
  });
  const muerto = useQuery({
    queryKey: ["arquitectura-codigo-muerto"],
    queryFn: () => api.get<CodigoMuerto>("/api/arquitectura/codigo-muerto"),
    enabled: pestana === "muerto",
  });

  const generado =
    pestana === "mapa" ? grafo.data?.generado
    : pestana === "muerto" ? muerto.data?.generado
    : resumen.data?.generado;

  const pestanas: { id: Pestana; label: string }[] = [
    { id: "diagrama", label: "Diagrama" },
    { id: "mapa", label: "Mapa de dependencias" },
    { id: "muerto", label: "Código muerto" },
    { id: "resumen", label: "Resumen" },
    { id: "grafo3d", label: "Grafo 3D" },
  ];

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-slate-900">Arquitectura del código</h1>
        <p className="text-sm text-slate-600">
          Derivado del código real por codebase-memory-mcp: qué archivo llama a cuál y qué
          funciones no usa nadie. El <span className="font-medium">Mapa del sistema</span> cuenta el
          flujo del negocio; esto cuenta el de las llamadas.
        </p>
        {resumen.data && !resumen.data.error && (
          <p className="text-xs text-slate-500">
            {resumen.data.nodos?.toLocaleString("es-CO")} nodos ·{" "}
            {resumen.data.aristas?.toLocaleString("es-CO")} aristas · snapshot del {fecha(generado)}
          </p>
        )}
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        {pestanas.map((p) => (
          <button
            key={p.id}
            onClick={() => setPestana(p.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              pestana === p.id
                ? "border-slate-800 font-medium text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {pestana === "diagrama" && <DiagramaCodigo />}

      {pestana === "grafo3d" && <Grafo3D />}

      {pestana === "mapa" && (
        <>
          {grafo.isLoading && <p className="text-sm text-slate-500">Cargando el grafo…</p>}
          {grafo.data?.error === "sin_snapshot" && <SinSnapshot mensaje={grafo.data.mensaje} />}
          {grafo.data && !grafo.data.error && <MapaDependencias grafo={grafo.data} />}
        </>
      )}

      {pestana === "muerto" && (
        <>
          {muerto.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
          {muerto.data?.error === "sin_snapshot" && <SinSnapshot mensaje={muerto.data.mensaje} />}
          {muerto.data && !muerto.data.error && <CodigoMuertoVista datos={muerto.data} />}
        </>
      )}

      {pestana === "resumen" && (
        <>
          {resumen.data?.error === "sin_snapshot" && <SinSnapshot mensaje={resumen.data.mensaje} />}
          {resumen.data && !resumen.data.error && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <TablaSimple titulo="Lenguajes (archivos)" tabla={resumen.data.lenguajes} />
              <TablaSimple titulo="Tipos de nodo" tabla={resumen.data.etiquetas} />
              <TablaSimple titulo="Tipos de relación" tabla={resumen.data.tipos_arista} />
              <TablaSimple titulo="Hotspots" tabla={resumen.data.hotspots} />
              <TablaSimple titulo="Paquetes" tabla={resumen.data.paquetes} />
              <TablaSimple titulo="Entry points" tabla={resumen.data.entry_points} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
