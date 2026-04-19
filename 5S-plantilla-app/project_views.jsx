/* global React */
const { useState: vS, useEffect: vE } = React;

/* ========== STEP — big checkbox row ========== */
function Step({ item, users, onToggle, onOpen, onVerify, onStart }) {
  const u = users.find(x => x.id === item.assignee);
  const statusCls = item.status === "pending" ? "" : item.status;

  const handleBox = (e) => {
    e.stopPropagation();
    if (item.status === "blocked") return;
    if (item.verify && item.status !== "done") { onVerify(item); return; }
    onToggle(item.id);
  };

  const handleRowClick = () => {
    if (item.status === "pending") onStart(item.id);
  };

  const statusLabels = {
    blocked: "Bloqueado",
    llm: "Verifica Gemi",
    waiting: "En espera",
    progress: "En curso",
  };

  return (
    <div className={`step ${statusCls}`} onClick={handleRowClick}>
      <div className="step-box" onClick={handleBox}>
        {item.status === "done" && <span style={{ fontSize: 18, fontWeight: 900 }}>✓</span>}
        {item.status === "blocked" && <span>!</span>}
        {item.status === "llm" && <span style={{ fontSize: 12 }}>◆</span>}
        {item.status === "waiting" && <span style={{ fontSize: 12 }}>⏱</span>}
      </div>
      <div className="step-body">
        <div className="s-title">{item.title}</div>
        {item.hint && <div className="s-hint">{item.hint}</div>}
        {item.blockedReason && <div className="s-hint" style={{ color: "var(--rose-2)", fontWeight: 700 }}>⚠ {item.blockedReason}</div>}
      </div>
      <div className="step-right">
        {statusLabels[item.status] && (
          <span className={`s-tag ${item.status}`}>{statusLabels[item.status]}</span>
        )}
        {item.verify && item.status !== "done" && item.status !== "llm" && (
          <span className="s-tag llm">◆ Verif.</span>
        )}
        {u && <div className={`avatar ${u.cls}`} title={u.nombre}>{u.iniciales}</div>}
        <button className="step-more" onClick={(e) => { e.stopPropagation(); onOpen(item); }} title="Ver detalles">
          ⋯
        </button>
      </div>
    </div>
  );
}

/* ========== PHASE DOTS (5S) ========== */
function PhaseDots({ proyecto, current, onPick }) {
  const { FASES } = window.SEED;
  return (
    <div className="s-dots">
      {FASES.map(f => {
        const g = proyecto.grupos.find(x => x.fase === f.id);
        const total = g ? g.items.length : 0;
        const done = g ? g.items.filter(i => i.status === "done").length : 0;
        const pct = total ? Math.round(done / total * 100) : 0;
        const isDone = pct === 100 && total > 0;
        const isCurrent = f.id === current;
        return (
          <div
            key={f.id}
            className={`s-dot ${isCurrent ? "current" : ""} ${isDone ? "done" : ""}`}
            onClick={() => onPick(f.id)}
          >
            <div className="num">{f.num}</div>
            <div className="lead">{f.lead}</div>
            <div className="es">{total ? `${done}/${total}` : "—"}</div>
            <div className="pbar"><div className="fill" style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

/* ========== COMPANION (animal bubble bottom) ========== */
function Companion({ proyecto, nextItem, onClick }) {
  const kind = window.CAT_ANIMAL[proyecto.cat] || "fox";
  const phrase = nextItem
    ? <>Lo siguiente: <em>{nextItem.title}</em></>
    : <>¡Vas increíble! Todo listo por ahora.</>;
  return (
    <div className="companion" onClick={onClick}>
      <div className="pet"><window.Animal kind={kind} size={48} /></div>
      <div className="c-msg">{phrase}</div>
    </div>
  );
}

window.Step = Step;
window.PhaseDots = PhaseDots;
window.Companion = Companion;
