function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function blockers(project) {
  const out = [];
  if ((project.shopping_list ?? []).some((x) => !x.done)) out.push("Lista de compras pendiente");
  for (const it of project.pantry ?? []) {
    const need = it.consumption_per_run ?? 1;
    if ((it.qty ?? 0) < need) out.push(`Falta ${it.name}`);
  }
  for (const m of project.materials ?? []) {
    const need = m.consumption_per_run ?? 1;
    if ((m.required_for_start ?? true) && (m.qty ?? 0) < need) out.push(`Material insuficiente: ${m.name}`);
  }
  return out;
}

function finishRoutine(project) {
  const p = clone(project);
  p.pantry = (p.pantry ?? []).map((it) => ({
    ...it,
    qty: Math.max(0, Number(((it.qty ?? 0) - (it.consumption_per_run ?? 1)).toFixed(4))),
  }));
  p.materials = (p.materials ?? []).map((m) => ({
    ...m,
    qty: Math.max(0, Number(((m.qty ?? 0) - (m.consumption_per_run ?? 1)).toFixed(4))),
  }));
  p.routine_state = "pending";
  p.preflight = (p.preflight ?? []).map((x) => ({ ...x, done: false }));
  p.tasks = (p.tasks ?? []).map((x) => ({ ...x, status: "pending" }));
  return p;
}

function run() {
  const base = {
    routine_state: "in_progress",
    shopping_list: [{ id: "s1", name: "Granola", qty: 1, unit: "ud", done: true }],
    pantry: [{ id: "p1", name: "Avena", qty: 5, unit: "ud", consumption_per_run: 2 }],
    materials: [{ id: "m1", name: "Leche", qty: 2, unit: "l", consumption_per_run: 1, required_for_start: true }],
    preflight: [{ id: "f1", label: "Cocina limpia", done: true }],
    tasks: [{ id: "t1", title: "Servir", status: "done" }],
  };

  // Caso 1: bloqueo por compras pendientes
  const c1 = clone(base);
  c1.shopping_list[0].done = false;
  const b1 = blockers(c1);
  assert(b1.some((x) => x.includes("Lista de compras pendiente")), "Debe bloquear por compras pendientes");

  // Caso 2: bloqueo por faltantes de despensa/materiales
  const c2 = clone(base);
  c2.pantry[0].qty = 0;
  c2.materials[0].qty = 0;
  const b2 = blockers(c2);
  assert(b2.some((x) => x.includes("Falta Avena")), "Debe bloquear por faltante de despensa");
  assert(b2.some((x) => x.includes("Material insuficiente: Leche")), "Debe bloquear por faltante de material");

  // Caso 3: finalizar descuenta inventario y resetea estado
  const c3 = finishRoutine(base);
  assert(c3.pantry[0].qty === 3, "Debe descontar despensa al finalizar");
  assert(c3.materials[0].qty === 1, "Debe descontar materiales al finalizar");
  assert(c3.routine_state === "pending", "Debe volver a pending al finalizar");
  assert(c3.preflight[0].done === false, "Debe resetear preflight");
  assert(c3.tasks[0].status === "pending", "Debe resetear tareas");

  // Caso 4: nunca debe quedar qty negativa
  const c4 = clone(base);
  c4.pantry[0].qty = 0.2;
  c4.pantry[0].consumption_per_run = 1;
  c4.materials[0].qty = 0.1;
  c4.materials[0].consumption_per_run = 1;
  const f4 = finishRoutine(c4);
  assert(f4.pantry[0].qty === 0, "Despensa no puede quedar negativa");
  assert(f4.materials[0].qty === 0, "Material no puede quedar negativo");

  console.log("QA behavior OK: reglas críticas de rutina validadas.");
}

run();
