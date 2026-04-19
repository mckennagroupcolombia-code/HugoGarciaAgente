/* global React, ReactDOM */
const { useState: aS, useEffect: aE, useMemo: aM } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "view": "list"
}/*EDITMODE-END*/;

function App() {
  const [proyectos, setProyectos] = aS(() => {
    try {
      const s = localStorage.getItem("5sv2-p");
      return s ? JSON.parse(s) : window.SEED.PROYECTOS;
    } catch { return window.SEED.PROYECTOS; }
  });
  const [activeId, setActiveId] = aS(() => localStorage.getItem("5sv2-a") || window.SEED.PROYECTOS[0].id);
  const [currentPhase, setCurrentPhase] = aS(null);
  const [theme, setTheme] = aS(TWEAK_DEFAULTS.theme);
  const [verifyItem, setVerifyItem] = aS(null);
  const [detailItem, setDetailItem] = aS(null);
  const [showAlerts, setShowAlerts] = aS(false);
  const [showWizard, setShowWizard] = aS(false);
  const [toast, setToast] = aS(null);
  const [tweaksOn, setTweaksOn] = aS(true);

  aE(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  aE(() => { try { localStorage.setItem("5sv2-p", JSON.stringify(proyectos)); } catch {} }, [proyectos]);
  aE(() => { try { localStorage.setItem("5sv2-a", activeId); } catch {} }, [activeId]);

  aE(() => {
    const h = (e) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOn(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksOn(false);
    };
    window.addEventListener("message", h);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", h);
  }, []);
  const postEdit = (edits) => window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*");

  const activeP = proyectos.find(p => p.id === activeId) || proyectos[0];
  const cat = window.SEED.CATS.find(c => c.id === activeP.cat);
  const animal = window.CAT_ANIMAL[activeP.cat];

  const pushToast = (m) => { setToast(m); setTimeout(() => setToast(null), 1800); };

  const updateItem = (itemId, changes) => {
    setProyectos(ps => ps.map(p => {
      if (p.id !== activeP.id) return p;
      return { ...p, grupos: p.grupos.map(g => ({
        ...g, items: g.items.map(it => it.id === itemId ? { ...it, ...changes } : it),
      }))};
    }));
  };
  const toggleItem = (id) => {
    const it = findItem(activeP, id);
    if (!it) return;
    if (it.status === "blocked") { pushToast("Resuelve primero el bloqueo"); return; }
    if (it.verify && it.status !== "done") { setVerifyItem(it); return; }
    const next = it.status === "done" ? "pending" : "done";
    updateItem(id, { status: next });
    if (next === "done") pushToast("¡Bien hecho! ✨");
  };
  const startProgress = (id) => {
    const it = findItem(activeP, id);
    if (it && it.status === "pending") updateItem(id, { status: "progress" });
  };
  const approveVerify = (id) => { updateItem(id, { status: "done" }); pushToast("¡Gemi aprobó! ◆"); };
  const deleteItem = (id) => {
    setProyectos(ps => ps.map(p => p.id === activeP.id
      ? { ...p, grupos: p.grupos.map(g => ({ ...g, items: g.items.filter(i => i.id !== id) })) }
      : p));
    pushToast("Eliminado");
  };
  const updateItemFull = (newItem) => {
    updateItem(newItem.id, newItem);
    pushToast("Guardado");
  };

  const createRoutine = ({ cat, nombre, emoji, items }) => {
    const { FASES } = window.SEED;
    const allItems = items.map(x => ({ id: x.id, title: x.title, status: "pending", assignee: null }));
    // distribute into Seiri bucket by default; user edits later
    const newP = {
      id: "p" + Math.random().toString(36).slice(2, 7),
      nombre, cat, emoji, tagline: "Rutina nueva — organiza los pasos en las 5S",
      fase: "seiri", asignados: [],
      deadline: "Sin fecha",
      grupos: FASES.map((f, i) => ({
        fase: f.id,
        items: i === 0 ? allItems : [],
      })),
    };
    setProyectos(ps => [...ps, newP]);
    setActiveId(newP.id);
    pushToast("¡Rutina creada! ✨");
  };

  const playSound = (id) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const freqs = { bell: 880, chime: 660, bark: 220, timer: 440, gong: 150, click: 1200 };
      o.frequency.value = freqs[id] || 440;
      o.type = id === "gong" || id === "bark" ? "sawtooth" : "sine";
      g.gain.setValueAtTime(0.1, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      o.start(); o.stop(ctx.currentTime + 0.8);
    } catch(e) {}
    pushToast("♪ " + (window.SEED.SONIDOS.find(s=>s.id===id)?.nombre || id));
  };

  const users = window.SEED.USERS;
  const { FASES, CATS } = window.SEED;

  const progress = useProgress(activeP);
  const visibleGrupos = currentPhase
    ? activeP.grupos.filter(g => g.fase === currentPhase)
    : activeP.grupos;
  const nextItem = aM(() => {
    for (const g of activeP.grupos) {
      const found = g.items.find(i => i.status !== "done" && i.status !== "skipped" && i.status !== "blocked");
      if (found) return found;
    }
    return null;
  }, [activeP]);

  return (
    <div className="app" data-screen-label="5S · Home">
      {/* SIDEBAR */}
      <div className="side">
        <div className="brand">
          <div className="logo-dot">5</div>
          <div>
            <div className="name">cinco</div>
            <div className="sub">rutinas 5S</div>
          </div>
        </div>

        <div className="side-heading">Mis rutinas</div>
        {proyectos.map(p => {
          const c = CATS.find(x => x.id === p.cat);
          const pct = projectPct(p);
          return (
            <div
              key={p.id}
              className={`p-card ${p.id === activeId ? "active" : ""}`}
              onClick={() => { setActiveId(p.id); setCurrentPhase(null); }}
            >
              <div className="emoji-wrap" style={{ background: `color-mix(in oklab, ${c.color} 22%, var(--surface-2))` }}>
                <span>{p.emoji}</span>
              </div>
              <div className="p-name">{p.nombre}</div>
              <div className="p-pct">{pct}%</div>
            </div>
          );
        })}

        <button className="new-btn" onClick={() => setShowWizard(true)}>
          + Nueva rutina
        </button>
      </div>

      {/* MAIN */}
      <div className="main">
        <div className="main-inner">
          <div className="crumb">
            <span>agentic</span><span>·</span><span>5S</span><span>·</span><span className="now">{activeP.nombre}</span>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" style={{ padding: "6px 14px" }} onClick={() => setShowAlerts(true)}>♪ Alertas</button>
          </div>

          {/* HERO */}
          <div className="hero">
            <div className="h-emoji" style={{ background: `color-mix(in oklab, ${cat.color} 30%, transparent)` }}>
              <window.Animal kind={animal} size={120} />
            </div>
            <div style={{ flex: 1 }}>
              <h1>{activeP.nombre}</h1>
              <div className="tagline">{activeP.tagline}</div>
              <div className="hero-meta">
                <div className="m"><div className="k">Progreso</div><div className="v">{progress.done}/{progress.total}</div></div>
                <div className="m"><div className="k">Cuándo</div><div className="v">{activeP.deadline}</div></div>
                <div className="m"><div className="k">Estado</div><div className="v">{progress.pct}%</div></div>
              </div>
            </div>
          </div>

          {/* 5S DOTS */}
          <window.PhaseDots
            proyecto={activeP}
            current={currentPhase}
            onPick={(f) => setCurrentPhase(currentPhase === f ? null : f)}
          />

          {/* STEPS */}
          <div className="today">
            <div className="today-head">
              <div>
                <div className="title">Lo siguiente</div>
                <h2>
                  {currentPhase
                    ? <>Fase <em>{FASES.find(f => f.id === currentPhase)?.lead}</em></>
                    : <>Paso a <em>paso</em></>}
                </h2>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost" style={{ padding: "8px 14px" }} onClick={() => setCurrentPhase(null)}>
                  {currentPhase ? "Ver todo" : "Ver todo"}
                </button>
              </div>
            </div>

            <div className="steps">
              {visibleGrupos.map(g => {
                const fase = FASES.find(f => f.id === g.fase);
                if (!g.items.length) return null;
                return (
                  <div key={g.fase}>
                    {!currentPhase && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "6px 2px", fontSize: 12, fontWeight: 800,
                        color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase",
                      }}>
                        <span style={{ fontSize: 18 }}>{fase.emoji}</span>
                        <span>{fase.num} · {fase.lead}</span>
                        <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                      </div>
                    )}
                    {g.items.map(it => (
                      <window.Step
                        key={it.id}
                        item={it}
                        users={users}
                        onToggle={toggleItem}
                        onOpen={setDetailItem}
                        onVerify={setVerifyItem}
                        onStart={startProgress}
                      />
                    ))}
                  </div>
                );
              })}
              {visibleGrupos.every(g => !g.items.length) && (
                <div style={{ padding: 28, textAlign: "center", color: "var(--ink-3)", fontWeight: 600 }}>
                  Esta fase está vacía. Agrega pasos desde los detalles ⋯
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Companion */}
      <window.Companion proyecto={activeP} nextItem={nextItem} onClick={() => nextItem && startProgress(nextItem.id)} />

      {/* Wizard */}
      <window.Wizard open={showWizard} onClose={() => setShowWizard(false)} onCreate={createRoutine} />

      {/* Verify */}
      <window.VerifyPanel
        open={!!verifyItem}
        item={verifyItem}
        onClose={() => setVerifyItem(null)}
        onApprove={approveVerify}
      />

      {/* Alerts */}
      <window.AlertsPanel open={showAlerts} onClose={() => setShowAlerts(false)} onPlay={playSound} />

      {/* Detail screen */}
      {detailItem && (
        <window.DetailScreen
          item={detailItem}
          users={users}
          onClose={() => setDetailItem(null)}
          onUpdate={updateItemFull}
          onDelete={deleteItem}
        />
      )}

      {/* Tweaks */}
      {tweaksOn && (
        <div className="tw-fab">
          <span className="tw-label">Tema</span>
          <div className="tw-row">
            {["light", "dark", "paper"].map(t => (
              <button key={t} className={`tw-chip ${theme === t ? "on" : ""}`} onClick={() => { setTheme(t); postEdit({ theme: t }); }}>
                {t === "light" ? "claro" : t === "dark" ? "oscuro" : "papel"}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 18, background: "var(--line)" }} />
          <button className="tw-chip" style={{ fontSize: 11 }} onClick={() => {
            localStorage.removeItem("5sv2-p");
            setProyectos(window.SEED.PROYECTOS);
            pushToast("Datos reiniciados");
          }}>reset</button>
        </div>
      )}

      <div className={`toast ${toast ? "on" : ""}`}>{toast}</div>
    </div>
  );
}

function findItem(p, id) {
  for (const g of p.grupos) {
    const it = g.items.find(x => x.id === id);
    if (it) return it;
  }
  return null;
}
function projectPct(p) {
  const total = p.grupos.reduce((a,g) => a + g.items.length, 0);
  const done = p.grupos.reduce((a,g) => a + g.items.filter(i => i.status === "done").length, 0);
  return total ? Math.round(done / total * 100) : 0;
}
function useProgress(p) {
  const total = p.grupos.reduce((a,g) => a + g.items.length, 0);
  const done = p.grupos.reduce((a,g) => a + g.items.filter(i => i.status === "done").length, 0);
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
