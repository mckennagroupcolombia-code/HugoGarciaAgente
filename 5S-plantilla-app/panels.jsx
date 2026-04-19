/* global React */
const { useState: pS, useEffect: pE } = React;

/* ========== WIZARD (crear rutina paso a paso) ========== */
function Wizard({ open, onClose, onCreate }) {
  const [step, setStep] = pS(0);
  const [cat, setCat] = pS(null);
  const [nombre, setNombre] = pS("");
  const [emoji, setEmoji] = pS("🌟");
  const [items, setItems] = pS([]);
  const [newItem, setNewItem] = pS("");

  pE(() => {
    if (open) {
      setStep(0); setCat(null); setNombre(""); setEmoji("🌟"); setItems([]); setNewItem("");
    }
  }, [open]);

  if (!open) return null;
  const { CATS } = window.SEED;

  const emojis = ["🌟", "🐶", "🍝", "🎨", "🔧", "💰", "💻", "🌱", "🧺", "📦", "🛁", "🚗"];

  const steps = [
    {
      label: "Paso 1 de 4",
      q: <>¿Qué <em>categoría</em> es?</>,
      body: (
        <div className="cat-grid">
          {CATS.map(c => (
            <div key={c.id} className={`cat-card ${cat === c.id ? "sel" : ""}`} onClick={() => setCat(c.id)}>
              <div className="c-icon">
                <window.Animal kind={c.animal} size={56} />
              </div>
              <div className="c-name">{c.nombre}</div>
            </div>
          ))}
        </div>
      ),
      valid: !!cat,
    },
    {
      label: "Paso 2 de 4",
      q: <>¿Cómo se <em>llama</em>?</>,
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <input
            autoFocus
            className="input-big"
            placeholder="Ej. Dar de comer al gato"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
          />
          <div>
            <div className="field-label">Elige un emoji</div>
            <div className="chip-grid">
              {emojis.map(e => (
                <button key={e} className={`chip-sel ${emoji === e ? "sel" : ""}`} style={{ fontSize: 20 }} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      ),
      valid: nombre.trim().length > 2,
    },
    {
      label: "Paso 3 de 4",
      q: <>¿Qué <em>pasos</em> tiene?</>,
      body: (
        <div>
          <div className="field-label" style={{ marginBottom: 10 }}>
            Agrega los pasos uno por uno. Después puedes organizarlos en las 5S.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              className="field-input"
              placeholder="Ej. Llenar el plato de agua"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newItem.trim()) {
                  setItems([...items, { id: Math.random().toString(36).slice(2), title: newItem.trim() }]);
                  setNewItem("");
                }
              }}
              style={{ flex: 1 }}
            />
            <button className="btn primary" onClick={() => {
              if (newItem.trim()) {
                setItems([...items, { id: Math.random().toString(36).slice(2), title: newItem.trim() }]);
                setNewItem("");
              }
            }}>Añadir</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
            {items.map((it, i) => (
              <div key={it.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", background: "var(--bg)",
                border: "1px solid var(--line)", borderRadius: "var(--r-md)",
              }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--sun)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900, color: "var(--ink)" }}>{i+1}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{it.title}</span>
                <button className="step-more" onClick={() => setItems(items.filter(x => x.id !== it.id))}>✕</button>
              </div>
            ))}
            {!items.length && <div style={{ padding: 14, color: "var(--ink-3)", fontSize: 13 }}>Todavía no hay pasos. Empieza arriba.</div>}
          </div>
        </div>
      ),
      valid: items.length >= 1,
    },
    {
      label: "Paso 4 de 4",
      q: <>¡<em>Listo</em> para crear!</>,
      body: (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ fontSize: 72, marginBottom: 8 }}>{emoji}</div>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }}>{nombre}</div>
          <div style={{ color: "var(--ink-2)", fontWeight: 500, marginTop: 4 }}>
            en <strong>{CATS.find(c => c.id === cat)?.nombre}</strong> · {items.length} paso{items.length === 1 ? "" : "s"}
          </div>
          <div style={{ marginTop: 24, padding: "20px", background: "var(--bg)", borderRadius: "var(--r-md)", textAlign: "left", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Se aplicará la plantilla 5S</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {window.SEED.FASES.map(f => (
                <span key={f.id} className="bubble">{f.num} {f.lead}</span>
              ))}
            </div>
          </div>
        </div>
      ),
      valid: true,
    },
  ];

  const cur = steps[step];
  const isLast = step === steps.length - 1;

  const handleFinish = () => {
    onCreate({ cat, nombre, emoji, items });
    onClose();
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="wizard" onClick={e => e.stopPropagation()}>
        <div className="wiz-head">
          <div className="wiz-dots">
            {steps.map((_, i) => (
              <div key={i} className={`d ${i < step ? "done" : i === step ? "current" : ""}`} />
            ))}
          </div>
          <button className="wiz-close" onClick={onClose}>✕</button>
        </div>
        <div className="wiz-body">
          <div className="wiz-step">{cur.label}</div>
          <div className="wiz-q">{cur.q}</div>
          {cur.body}
        </div>
        <div className="wiz-foot">
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>← Atrás</button>}
          <div style={{ flex: 1 }} />
          <div className="wiz-count">{step + 1} / {steps.length}</div>
          {!isLast ? (
            <button className="btn primary" disabled={!cur.valid} onClick={() => setStep(step + 1)}>
              Siguiente →
            </button>
          ) : (
            <button className="btn sun" onClick={handleFinish}>
              Crear rutina ✨
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========== VERIFY PANEL (Gemini) ========== */
function VerifyPanel({ open, onClose, item, onApprove }) {
  const [checks, setChecks] = pS([]);
  const [stage, setStage] = pS("idle");

  pE(() => {
    if (open && item) {
      setStage("idle");
      setChecks([
        { text: "Condiciones iniciales ok", status: "pending" },
        { text: "Todo en su lugar", status: "pending" },
        { text: "Sin residuos visibles", status: "pending" },
        { text: "Foto coincide con estándar", status: "pending" },
      ]);
    }
  }, [open, item]);

  if (!item) return null;

  const run = () => {
    setStage("running");
    let i = 0;
    const iv = setInterval(() => {
      setChecks(prev => {
        const next = [...prev];
        if (i < next.length) next[i] = { ...next[i], status: "ok" };
        return next;
      });
      i++;
      if (i >= 4) { clearInterval(iv); setStage("ok"); }
    }, 480);
  };

  return (
    <div className={`verify-panel ${open ? "open" : ""}`}>
      <div className="vp-head">
        <h3>Verificación</h3>
        <button className="wiz-close" onClick={onClose}>✕</button>
      </div>
      <div className="vp-body">
        <div className="v-bot"><window.Animal kind="owl" size={64} /></div>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Gemi dice</div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", marginTop: 4 }}>
            {stage === "idle" && "¿Revisamos?"}
            {stage === "running" && "Revisando..."}
            {stage === "ok" && "¡Todo perfecto!"}
          </div>
        </div>
        <div style={{
          padding: "14px", background: "var(--bg)",
          border: "1px solid var(--line)", borderRadius: "var(--r-md)",
          marginTop: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Tarea</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, letterSpacing: "-0.01em" }}>{item.title}</div>
        </div>

        <div className="v-criteria">
          {checks.map((c, i) => (
            <div key={i} className={`vc-item ${c.status === "ok" ? "ok" : ""}`}>
              <div className="dot">{c.status === "ok" ? "✓" : ""}</div>
              <span>{c.text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="vp-foot">
        {stage === "idle" && (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" style={{ flex: 1, background: "var(--surface-2)" }}>📷 Foto</button>
              <button className="btn ghost" style={{ flex: 1, background: "var(--surface-2)" }}>🎙 Voz</button>
            </div>
            <button className="btn primary" style={{ justifyContent: "center" }} onClick={run}>Revisar ahora ◆</button>
          </>
        )}
        {stage === "running" && (
          <div style={{ textAlign: "center", fontWeight: 700, color: "var(--ink-2)", fontSize: 14 }}>
            Gemi está mirando con cuidado...
          </div>
        )}
        {stage === "ok" && (
          <button className="btn sun" style={{ justifyContent: "center" }} onClick={() => { onApprove(item.id); onClose(); }}>
            ¡Marcar como hecho! ✨
          </button>
        )}
      </div>
    </div>
  );
}

/* ========== ALERTS PANEL ========== */
function AlertsPanel({ open, onClose, onPlay }) {
  const { ALERTAS, SONIDOS } = window.SEED;
  return (
    <div className={`verify-panel ${open ? "open" : ""}`}>
      <div className="vp-head">
        <h3>Alertas de hoy</h3>
        <button className="wiz-close" onClick={onClose}>✕</button>
      </div>
      <div className="vp-body">
        <div style={{ fontSize: 14, color: "var(--ink-2)", fontWeight: 600, marginBottom: 12 }}>
          Sonarán automáticamente cuando sea la hora.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ALERTAS.map(a => (
            <div key={a.id} className="sound-row" onClick={() => onPlay(a.sound)}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--surface-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <window.Animal kind={a.animal} size={36} />
              </div>
              <div className="s-time">{a.time}</div>
              <div className="s-name">{a.nombre}</div>
              <div className="s-play">▶</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <div className="field-label">Biblioteca de sonidos</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {SONIDOS.map(s => (
              <button key={s.id} className="chip-sel" onClick={() => onPlay(s.id)}>♪ {s.nombre}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========== DETAIL SCREEN (edit task) ========== */
function DetailScreen({ item, users, onClose, onUpdate, onDelete }) {
  const [local, setLocal] = pS(item);
  pE(() => setLocal(item), [item]);
  if (!item) return null;

  const statuses = [
    { id: "pending", label: "Pendiente" },
    { id: "progress", label: "En curso" },
    { id: "done", label: "Hecho" },
    { id: "blocked", label: "Bloqueado" },
    { id: "waiting", label: "Espera" },
    { id: "llm", label: "Verifica Gemi" },
    { id: "skipped", label: "Omitido" },
  ];

  const save = () => { onUpdate(local); onClose(); };

  return (
    <div className="detail-screen">
      <div className="detail-inner">
        <div className="detail-top">
          <button className="back" onClick={onClose}>← Volver</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => { onDelete(item.id); onClose(); }}>Eliminar</button>
            <button className="btn primary" onClick={save}>Guardar cambios</button>
          </div>
        </div>

        <div className="field-label">Editar tarea</div>
        <h1 className="detail-title">{local.title}</h1>
        <div className="detail-sub">Ajusta los detalles, asigna a alguien y decide si Gemi debe verificar.</div>

        <div className="field">
          <div className="field-label">Título</div>
          <input className="field-input" value={local.title} onChange={e => setLocal({ ...local, title: e.target.value })} />
        </div>

        <div className="field">
          <div className="field-label">Pista o descripción</div>
          <textarea
            className="field-input"
            rows={3}
            placeholder="Ej. Verificar que la correa esté en el gancho azul"
            value={local.hint || ""}
            onChange={e => setLocal({ ...local, hint: e.target.value })}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div className="field">
          <div className="field-label">Estado</div>
          <div className="status-picker">
            {statuses.map(s => (
              <button
                key={s.id}
                className={`pill-opt ${local.status === s.id ? `sel ${s.id}` : ""}`}
                onClick={() => setLocal({ ...local, status: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field-label">Asignar a</div>
          <div className="status-picker">
            <button
              className={`pill-opt ${!local.assignee ? "sel pending" : ""}`}
              onClick={() => setLocal({ ...local, assignee: null })}
            >
              Sin asignar
            </button>
            {users.map(u => (
              <button
                key={u.id}
                className={`pill-opt ${local.assignee === u.id ? "sel progress" : ""}`}
                onClick={() => setLocal({ ...local, assignee: u.id })}
              >
                <span className={`avatar ${u.cls}`} style={{ width: 20, height: 20, fontSize: 9, marginRight: 6, display: "inline-grid" }}>{u.iniciales}</span>
                {u.nombre}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field-label">Verificación de Gemi</div>
          <div className="status-picker">
            <button
              className={`pill-opt ${!local.verify ? "sel pending" : ""}`}
              onClick={() => setLocal({ ...local, verify: false })}
            >
              No hace falta
            </button>
            <button
              className={`pill-opt ${local.verify ? "sel llm" : ""}`}
              onClick={() => setLocal({ ...local, verify: true })}
            >
              ◆ Sí, Gemi revisa
            </button>
          </div>
        </div>

        {local.status === "blocked" && (
          <div className="field">
            <div className="field-label">¿Por qué está bloqueado?</div>
            <input
              className="field-input"
              placeholder="Ej. Falta permiso del cliente"
              value={local.blockedReason || ""}
              onChange={e => setLocal({ ...local, blockedReason: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

window.Wizard = Wizard;
window.VerifyPanel = VerifyPanel;
window.AlertsPanel = AlertsPanel;
window.DetailScreen = DetailScreen;
