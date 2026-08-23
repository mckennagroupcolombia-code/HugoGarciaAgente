import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { ProseTextarea } from "./ProseTextarea";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";
import { Icon, type UiIconName } from "../icons";

// ── Tipos ──────────────────────────────────────────────────────────────────

interface SupervisorStatus {
  bridge_unit: string;
  bridge_estado: string;
  bridge_activo: boolean;
  listo: boolean;
  numero: string | null;
  pushname: string | null;
  qr_data_url: string | null;
  qr_pendiente: boolean;
  bridge_responde: boolean;
  gemma_model: string;
  mensaje: string;
}

interface ActividadItem {
  ts: string;
  tipo: string;
  texto?: string;
  de?: string;
  para?: string;
  modelo?: string;
}

interface Contacto {
  nombre: string;
  numero: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatNumero(num: string | null): string {
  if (!num) return "—";
  const digits = num.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) {
    const local = digits.slice(2);
    return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  return `+${digits}`;
}

function tiempoRelativo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return new Date(ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

// ── Tab bar ────────────────────────────────────────────────────────────────

type Tab = "cuenta" | "voz" | "actividad" | "contactos";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: UiIconName }[] = [
    { id: "cuenta",    label: "Cuenta",     icon: "user" },
    { id: "voz",       label: "Enviar Voz", icon: "megaphone" },
    { id: "actividad", label: "Actividad",  icon: "lightning" },
    { id: "contactos", label: "Contactos",  icon: "users" },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-border bg-surface-panel p-1 mb-4">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
          className={hubTabClass(active === t.id, "flex-1 justify-center")}
        >
          <Icon name={t.icon} size={22} weight="bold" />
          <span className={HUB_TAB_LABEL}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Tab Cuenta ─────────────────────────────────────────────────────────────

function TabCuenta() {
  const [status, setStatus]         = useState<SupervisorStatus | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [desvinculando, setDesv]    = useState(false);
  const [infoAbierto, setInfo]      = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<SupervisorStatus>("/api/supervisor/bridge/status");
      setStatus(d);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo consultar el bridge supervisor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    pollRef.current = setInterval(cargar, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [cargar]);

  async function desvincular() {
    const ok = window.confirm(
      "¿Desvincular el número supervisor?\n\n" +
      "• El bridge dejará de enviar/recibir mensajes unos minutos.\n" +
      "• Deberás escanear un QR con tu número personal.\n" +
      "• El Agente WA de la empresa (puerto 3000) NO se verá afectado."
    );
    if (!ok) return;
    setDesv(true);
    setError("");
    try {
      await api.post<{ mensaje?: string }>("/api/supervisor/bridge/desvincular", {});
      setLoading(true);
      await cargar();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al desvincular");
    } finally {
      setDesv(false);
    }
  }

  if (loading && !status) {
    return <p className="text-sm text-muted py-4">Consultando bridge supervisor…</p>;
  }

  const conectado   = status?.listo;
  // Mostrar sección QR cuando: no conectado Y (qr pendiente OR qr disponible OR bridge activo)
  const necesitaQr  = !conectado && (status?.qr_pendiente || !!status?.qr_data_url || status?.bridge_activo);

  return (
    <div className="space-y-4">
      {/* Aviso — cuenta separada de la empresa */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-400 leading-relaxed">
        <p className="font-semibold mb-1">Cuenta supervisora independiente · puerto 3001</p>
        <p>
          Este bridge gestiona <strong>tu número personal</strong> (573196529076).
          No afecta en ningún modo la cuenta de empresa del Agente WA (puerto 3000).
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Estado */}
      <div className={`rounded-xl border px-5 py-4 space-y-3 ${
        conectado
          ? "border-emerald-500/30 bg-emerald-500/5"
          : necesitaQr
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-surface-panel"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 border ${
            status?.bridge_activo
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }`}>
            Servicio {status?.bridge_estado ?? "—"}
          </span>
          {conectado && (
            <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              ● WhatsApp listo
            </span>
          )}
          {!conectado && status?.bridge_activo && (
            <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border bg-amber-500/10 text-amber-400 border-amber-500/20">
              ◌ Esperando vinculación
            </span>
          )}
        </div>

        <div>
          <p className="text-xs text-muted uppercase tracking-wide font-medium">Número vinculado</p>
          <p className="text-lg font-semibold text-ink font-mono mt-0.5">
            {conectado ? formatNumero(status?.numero ?? null) : "Sin vincular"}
          </p>
          {status?.pushname && (
            <p className="text-sm text-muted mt-0.5">Perfil: {status.pushname}</p>
          )}
        </div>

        <div>
          <p className="text-xs text-muted uppercase tracking-wide font-medium">Modelo IA</p>
          <p className="text-sm font-mono text-ink mt-0.5">{status?.gemma_model ?? "—"}</p>
        </div>

        <p className="text-xs text-muted">{status?.mensaje}</p>
      </div>

      {/* ── Sección QR — igual que el Agente WA ─────────────────────────────── */}
      {necesitaQr && (
        <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Escanear QR — número personal</h3>
            <button
              type="button"
              onClick={() => setInfo((v) => !v)}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                infoAbierto
                  ? "border-accent/25 bg-accent/10 text-accent"
                  : "border-border/80 text-muted hover:text-ink hover:bg-surface-hover"
              }`}
            >
              Info
            </button>
          </div>

          {infoAbierto && (
            <div className="rounded-xl border border-border/70 bg-surface/40 px-4 py-3.5 text-xs text-muted space-y-3 leading-relaxed">
              <p className="text-ink/90 font-medium text-[13px]">Cómo vincular tu número personal</p>
              <ol className="list-decimal list-inside space-y-1 pl-0.5">
                <li>Abre WhatsApp en tu teléfono personal (573196529076).</li>
                <li>Ve a menú (⋮) → <strong>Dispositivos vinculados</strong> → <strong>Vincular dispositivo</strong>.</li>
                <li>Escanea el código QR que aparece abajo.</li>
                <li>Espera a que el estado cambie a «WhatsApp listo».</li>
              </ol>
              <p className="text-[11px]">
                El QR expira en ~60 s. Si expira, se genera uno nuevo automáticamente.
                Esta vista se refresca cada 2.5 s.
              </p>
            </div>
          )}

          {status?.qr_data_url ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={status.qr_data_url}
                alt="QR para vincular WhatsApp supervisor"
                className="rounded-xl border border-border bg-surface-input p-3 max-w-[280px] w-full"
              />
              <p className="text-[11px] text-muted text-center">
                El código se actualiza solo. Esta vista se refresca cada 2.5 segundos.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted py-6 justify-center">
              <span className="inline-block w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Generando QR… (puede tardar ~30–60 s si el servicio acaba de arrancar)
            </div>
          )}
        </section>
      )}

      {/* ── Instrucciones de comandos (solo cuando conectado) ──────────────── */}
      {conectado && (
        <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">Comandos desde tu WhatsApp</h3>
          <div className="space-y-3 text-xs text-muted leading-relaxed">
            <div>
              <p className="font-semibold text-ink/80 mb-1.5">Notas de voz</p>
              <code className="block bg-surface rounded-lg px-3 py-1.5 font-mono text-accent text-[11px]">
                hugo, envia nota de voz a 573001234567 con: Hola Cynthia recuerda tu cita
              </code>
              <code className="block bg-surface rounded-lg px-3 py-1.5 font-mono text-accent text-[11px] mt-1">
                hugo, dile a cynthia: La reunión es mañana a las 10am
              </code>
            </div>
            <div>
              <p className="font-semibold text-ink/80 mb-1">Chat IA · {status?.gemma_model}</p>
              <p>Cualquier otro mensaje → responde el modelo supervisor local.</p>
            </div>
            <p className="text-[11px] text-muted/80">
              Los nombres se resuelven desde la pestaña <strong>Contactos</strong>.
            </p>
          </div>
        </section>
      )}

      {/* ── Acciones ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <h3 className="text-sm font-semibold text-ink">
          {conectado ? "Cambiar de número" : "Vincular número"}
        </h3>
        <button
          type="button"
          onClick={desvincular}
          disabled={desvinculando}
          className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {desvinculando
            ? "Desvinculando…"
            : conectado
              ? "Desvincular y vincular otro número"
              : "Forzar nuevo QR"}
        </button>
        <button
          type="button"
          onClick={() => { setLoading(true); cargar(); }}
          className="w-full rounded-lg border border-border bg-surface-hover px-4 py-2 text-sm text-muted hover:text-ink transition"
        >
          Actualizar estado
        </button>
        <p className="text-[11px] text-muted">
          El Agente WA de la empresa (puerto 3000) <strong>no se verá afectado</strong> por estas acciones.
        </p>
      </section>
    </div>
  );
}

// ── Tab Enviar Voz ─────────────────────────────────────────────────────────

const NUMERO_LIBRE = "__libre__";

function TabEnviarVoz() {
  const [contactos, setContactos]   = useState<Contacto[]>([]);
  const [seleccion, setSeleccion]   = useState("");        // valor del <select>
  const [numeroLibre, setNumeroLibre] = useState("");      // cuando seleccion === NUMERO_LIBRE
  const [texto, setTexto]           = useState("");
  const [enviando, setEnviando]     = useState(false);
  const [result, setResult]         = useState<{ ok: boolean; msg: string } | null>(null);

  // Cargar contactos al montar
  useEffect(() => {
    api.get<Record<string, string>>("/api/supervisor/bridge/contactos")
      .then((d) => {
        const lista = Object.entries(d)
          .filter(([k]) => !k.startsWith("_"))
          .map(([nombre, numero]) => ({ nombre, numero }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
        setContactos(lista);
        // Preseleccionar el primer contacto si existe
        if (lista.length > 0) setSeleccion(lista[0].nombre);
      })
      .catch(() => {});
  }, []);

  const contactoSeleccionado = contactos.find((c) => c.nombre === seleccion);

  // El bridge solo entiende números — resolvemos el número real del contacto
  const numeroEfectivo = seleccion === NUMERO_LIBRE
    ? numeroLibre.trim()
    : (contactoSeleccionado?.numero ?? seleccion);

  const etiquetaDestino = seleccion === NUMERO_LIBRE
    ? numeroLibre.trim()
    : contactoSeleccionado
        ? `${contactoSeleccionado.nombre.charAt(0).toUpperCase() + contactoSeleccionado.nombre.slice(1)} (${formatNumero(contactoSeleccionado.numero)})`
        : seleccion;

  async function enviar() {
    if (!numeroEfectivo || !texto.trim()) return;
    setEnviando(true);
    setResult(null);
    try {
      const d = await api.post<{ status?: string; bytes?: number; error?: string }>(
        "/api/supervisor/bridge/enviar-voz",
        { numero: numeroEfectivo, texto: texto.trim() },
        { timeoutMs: 360_000 },
      );
      if (d.status === "enviado") {
        setResult({ ok: true, msg: `✅ Nota de voz enviada a ${etiquetaDestino}` });
        setTexto("");
      } else {
        setResult({ ok: false, msg: `❌ ${d.error ?? "Error desconocido"}` });
      }
    } catch (e: unknown) {
      setResult({ ok: false, msg: `❌ ${e instanceof Error ? e.message : "Error"}` });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Genera una nota de voz con el motor TTS configurado y la envía desde tu número supervisor.
      </p>

      <div className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">

        {/* Selector de destino */}
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
                  {c.nombre.charAt(0).toUpperCase() + c.nombre.slice(1)}
                  {" — "}
                  {formatNumero(c.numero)}
                </option>
              ))}
              <option value={NUMERO_LIBRE}>✏️  Escribir número manualmente…</option>
            </select>
          )}

          {/* Campo libre cuando el usuario elige "escribir manualmente" */}
          {seleccion === NUMERO_LIBRE && (
            <input
              type="tel"
              value={numeroLibre}
              onChange={(e) => setNumeroLibre(e.target.value)}
              placeholder="573001234567"
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:border-accent mt-1"
            />
          )}
        </div>

        {/* Texto a sintetizar */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wide">
            Texto a sintetizar
          </label>
          <ProseTextarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            placeholder="Hola Cynthia, recuerda que tienes un compromiso mañana a las 10am con el equipo…"
            className="w-full resize-none rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <p className="text-[10px] text-muted">{texto.length}/1200 caracteres</p>
        </div>

        {result && (
          <div className={`rounded-lg border px-4 py-2.5 text-sm ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}>
            {result.msg}
          </div>
        )}

        <button
          onClick={enviar}
          disabled={enviando || !numeroEfectivo || !texto.trim()}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40"
        >
          {enviando ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Sintetizando y enviando…
            </span>
          ) : (
            "Enviar nota de voz"
          )}
        </button>
      </div>

      <div className="rounded-xl border border-border/60 bg-surface/40 px-4 py-3 text-xs text-muted space-y-1.5">
        <p className="font-semibold text-ink/80">Motores de síntesis (en orden de prioridad)</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Voicebox (clonación local — mejor calidad)</li>
          <li>Qwen3 TTS (GPU local)</li>
          <li>ElevenLabs API (requiere ELEVENLABS_API_KEY)</li>
        </ol>
        <p>El motor activo se configura en el panel <strong>Voz IA</strong>.</p>
      </div>
    </div>
  );
}

// ── Tab Actividad ──────────────────────────────────────────────────────────

const TIPO_COLOR: Record<string, string> = {
  SISTEMA:   "text-blue-400",
  ENTRANTE:  "text-emerald-400",
  SALIENTE:  "text-amber-400",
  IA:        "text-purple-400",
  ERROR:     "text-red-400",
};

function TabActividad() {
  const [actividad, setActividad] = useState<ActividadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<{ actividad: ActividadItem[] }>("/api/supervisor/bridge/monitor");
      setActividad(d.actividad ?? []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    cargar();
    pollRef.current = setInterval(cargar, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [cargar]);

  if (loading) return <p className="text-sm text-muted py-4">Cargando actividad…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Últimas {actividad.length} entradas · se refresca cada 5 s</p>
        <button
          onClick={() => { setLoading(true); cargar(); }}
          className="text-xs text-accent hover:underline"
        >
          ↻ Actualizar
        </button>
      </div>

      {actividad.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-panel px-5 py-8 text-center">
          <p className="text-sm text-muted">Sin actividad registrada aún</p>
          <p className="text-xs text-muted mt-1">Los eventos aparecen cuando el bridge recibe o envía mensajes</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {actividad.map((ev, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface-panel px-4 py-3 flex items-start gap-3">
              <span className={`shrink-0 text-xs font-bold w-20 ${TIPO_COLOR[ev.tipo] ?? "text-muted"}`}>
                {ev.tipo}
              </span>
              <div className="flex-1 min-w-0">
                {ev.de && <span className="text-[11px] text-muted font-mono">de {ev.de} </span>}
                {ev.para && <span className="text-[11px] text-muted font-mono">→ {ev.para} </span>}
                {ev.modelo && <span className="text-[11px] text-purple-400">[{ev.modelo}] </span>}
                {ev.texto && (
                  <p className="text-xs text-ink mt-0.5 line-clamp-2">{ev.texto}</p>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-muted whitespace-nowrap">
                {tiempoRelativo(ev.ts)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab Contactos ──────────────────────────────────────────────────────────

function TabContactos() {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [nombre, setNombre]       = useState("");
  const [numero, setNumero]       = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError]         = useState("");
  const [ok, setOk]               = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<Record<string, string>>("/api/supervisor/bridge/contactos");
      setContactos(
        Object.entries(d)
          .filter(([k]) => !k.startsWith("_"))
          .map(([nombre, numero]) => ({ nombre, numero }))
      );
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    setError("");
    setOk(false);
    if (!nombre.trim() || !numero.trim()) {
      setError("Completa nombre y número");
      return;
    }
    setGuardando(true);
    try {
      await api.post("/api/supervisor/bridge/contactos", {
        nombre: nombre.trim().toLowerCase(),
        numero: numero.trim(),
      });
      setNombre("");
      setNumero("");
      setOk(true);
      setTimeout(() => setOk(false), 2500);
      await cargar();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (loading) return <p className="text-sm text-muted py-4">Cargando contactos…</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Los nombres aquí registrados se pueden usar en comandos de voz: «hugo, dile a{" "}
        <strong>cynthia</strong>: …»
      </p>

      {/* Formulario */}
      <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
        <p className="text-sm font-semibold text-ink">Agregar contacto</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-muted font-medium">Nombre (minúsculas)</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value.toLowerCase())}
              placeholder="cynthia"
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted font-medium">Número completo</label>
            <input
              type="tel"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="573001234567"
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink font-mono focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {ok && <p className="text-xs text-emerald-400">✓ Contacto guardado</p>}
        <button
          onClick={guardar}
          disabled={guardando || !nombre.trim() || !numero.trim()}
          className="rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar contacto"}
        </button>
      </div>

      {/* Lista */}
      {contactos.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-panel px-5 py-8 text-center">
          <p className="text-sm text-muted">Sin contactos registrados</p>
          <p className="text-xs text-muted mt-1">Agrega nombres para usarlos en comandos de voz</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted font-medium uppercase tracking-wide">
            {contactos.length} contacto{contactos.length !== 1 ? "s" : ""}
          </p>
          {contactos.map((c) => (
            <div
              key={c.nombre}
              className="rounded-xl border border-border bg-surface-panel px-4 py-3 flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold shrink-0">
                {c.nombre[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink">{c.nombre}</p>
                <p className="text-xs text-muted font-mono">{formatNumero(c.numero)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────

export default function SupervisorPanel() {
  const [tab, setTab] = useState<Tab>("cuenta");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Agente Supervisor</h2>
        <p className="text-xs text-muted mt-0.5">
          Segundo bridge WhatsApp — Voz IA + Gemma4 · cuenta personal del desarrollador
        </p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === "cuenta"    && <TabCuenta />}
      {tab === "voz"       && <TabEnviarVoz />}
      {tab === "actividad" && <TabActividad />}
      {tab === "contactos" && <TabContactos />}
    </div>
  );
}
