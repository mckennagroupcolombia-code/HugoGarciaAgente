/* global React */
const { useState, useEffect, useMemo, useRef } = React;

/* ====================  RAIL — host app integrations  ==================== */
function Rail() {
  const items = [
    { id: "home", label: "⌂" },
    { id: "agent", label: "AI" },
    { id: "flows", label: "FL" },
    { id: "data", label: "DB" },
  ];
  const bottom = [
    { id: "5s", label: "5S", active: true },
    { id: "settings", label: "⚙" },
  ];
  return (
    <div className="rail">
      <div className="rail-logo">a</div>
      {items.map(i => (
        <button key={i.id} className="rail-btn" title={i.id}>{i.label}</button>
      ))}
      <div className="rail-divider" />
      {bottom.map(i => (
        <button key={i.id} className={`rail-btn ${i.active ? "active" : ""}`} title={i.id}>
          {i.label}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button className="rail-btn" title="cuenta">
        <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14 }}>v</span>
      </button>
    </div>
  );
}

/* ====================  SIDEBAR  ==================== */
function Sidebar({ proyectos, activeId, onSelect, onNew, onShowAlerts, llmReady }) {
  const cats = window.SEED.categorias;
  const grouped = useMemo(() => {
    const map = {};
    proyectos.forEach(p => { (map[p.cat] ||= []).push(p); });
    return map;
  }, [proyectos]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <span className="mark">5</span>
          <div>
            <div className="name">5S</div>
            <div className="sub">Integración · localhost:8081</div>
          </div>
        </div>
      </div>

      <div className="sidebar-search">
        <span style={{ fontFamily: "var(--mono)", color: "var(--text-faint)" }}>⌕</span>
        <input placeholder="Buscar proyecto, ritual, item..." />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)" }}>⌘K</span>
      </div>

      <div style={{ padding: "4px 12px 8px" }}>
        <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={onNew}>
          <span style={{ fontFamily: "var(--mono)" }}>+</span> Proyecto desde plantilla
        </button>
      </div>

      <div className="sidebar-section">
        <span>Espacios de trabajo</span>
        <span className="count">{proyectos.length}</span>
      </div>

      <div className="sidebar-list">
        {cats.map(cat => {
          const ps = grouped[cat.id] || [];
          if (!ps.length) return null;
          return (
            <div key={cat.id} style={{ marginBottom: 4 }}>
              <div style={{
                padding: "6px 8px 4px", fontFamily: "var(--mono)", fontSize: 10,
                color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span className="dot" style={{ width: 6, height: 6, borderRadius: 2, background: cat.color, display: "inline-block" }} />
                {cat.nombre}
              </div>
              {ps.map(p => (
                <div
                  key={p.id}
                  className={`sidebar-item ${p.id === activeId ? "active" : ""}`}
                  onClick={() => onSelect(p.id)}
                >
                  <span className="dot" style={{ background: cat.color }} />
                  <span className="label">{p.nombre}</span>
                  <span className="meta">{progressOverall(p)}%</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="sidebar-foot">
        <div className="llm-status" onClick={() => {}}>
          <span className="pulse" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--text)" }}>Gemini · en línea</div>
            <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
              gemini-2.5 · verificador
            </div>
          </div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ok)" }}>OK</span>
        </div>

        <button className="btn ghost" style={{ justifyContent: "flex-start" }} onClick={onShowAlerts}>
          <span style={{ fontFamily: "var(--mono)" }}>♪</span> Próximas alertas · 5
        </button>
      </div>
    </div>
  );
}

function progressOverall(p) {
  const total = p.grupos.reduce((a, g) => a + g.items.length, 0);
  const done = p.grupos.reduce((a, g) => a + g.items.filter(i => i.status === "done" || i.status === "skipped").length, 0);
  return total ? Math.round(done / total * 100) : 0;
}
function progressGroup(g) {
  const total = g.items.length;
  const done = g.items.filter(i => i.status === "done" || i.status === "skipped").length;
  return total ? Math.round(done / total * 100) : 0;
}

window.Rail = Rail;
window.Sidebar = Sidebar;
window.progressOverall = progressOverall;
window.progressGroup = progressGroup;
