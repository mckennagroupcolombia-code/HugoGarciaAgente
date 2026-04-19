// 5S v2 — datos simplificados y más amigables
const FASES = [
  { id: "seiri", num: "01", lead: "Clasifica", es: "Elimina lo que no usas", emoji: "🫗" },
  { id: "seiton", num: "02", lead: "Ordena", es: "Un lugar para cada cosa", emoji: "🗂" },
  { id: "seiso", num: "03", lead: "Limpia", es: "Deja todo brillante", emoji: "✨" },
  { id: "seiketsu", num: "04", lead: "Repite", es: "Que sea un estándar", emoji: "🔁" },
  { id: "shitsuke", num: "05", lead: "Mantén", es: "Hazlo un hábito", emoji: "🌱" },
];

const CATS = [
  { id: "diseno", nombre: "Diseño", color: "#6fa8d6", animal: "fox" },
  { id: "alimentacion", nombre: "Cocina", color: "#7cb86f", animal: "bear" },
  { id: "mantenimiento", nombre: "Taller", color: "#f4c44d", animal: "owl" },
  { id: "mascotas", nombre: "Mascotas", color: "#a68bc8", animal: "dog" },
  { id: "finanzas", nombre: "Dinero", color: "#e58c8c", animal: "penguin" },
  { id: "ingenieria", nombre: "Código", color: "#4a4a56", animal: "cat" },
];

const USERS = [
  { id: "u1", iniciales: "MA", nombre: "Miguel", cls: "a1" },
  { id: "u2", iniciales: "LR", nombre: "Laura", cls: "a2" },
  { id: "u3", iniciales: "DS", nombre: "Dani", cls: "a3" },
  { id: "u4", iniciales: "VP", nombre: "Vale", cls: "a4" },
  { id: "u5", iniciales: "JO", nombre: "Jorge", cls: "a5" },
  { id: "llm", iniciales: "◆", nombre: "Gemi", cls: "llm" },
];

const it = (title, o = {}) => ({
  id: Math.random().toString(36).slice(2, 9),
  title, status: "pending", assignee: null, hint: null, verify: false, blockedReason: null, ...o,
});

const PROYECTOS = [
  {
    id: "p1", nombre: "Paseo de Tobías", cat: "mascotas", emoji: "🐶",
    tagline: "Salir al parque, seguro y feliz",
    fase: "seiton",
    asignados: ["u3"],
    deadline: "Hoy · 17:30",
    grupos: [
      { fase: "seiri", titulo: "Antes de salir", items: [
        it("Tobías ya comió", { status: "done", assignee: "u3" }),
        it("Patitas limpias", { status: "done", assignee: "u3" }),
      ]},
      { fase: "seiton", titulo: "Empaca el kit", items: [
        it("Correa azul", { status: "done", assignee: "u3" }),
        it("Bozal", { status: "progress", assignee: "u3", hint: "Obligatorio en el parque" }),
        it("Bolsas para caca", { status: "pending" }),
        it("Llaves y celular", { status: "pending" }),
        it("Agua 500ml", { status: "waiting", hint: "Esperando que hierva" }),
      ]},
      { fase: "seiso", titulo: "Al volver", items: [
        it("Limpiar patas", { status: "pending" }),
      ]},
      { fase: "seiketsu", titulo: "Siempre igual", items: [
        it("Guardar correa en el gancho", { status: "pending" }),
        it("Contar bolsas · reponer si < 5", { status: "pending" }),
      ]},
      { fase: "shitsuke", titulo: "Hábito", items: [
        it("Registrar el paseo", { status: "pending", verify: true }),
      ]},
    ],
  },
  {
    id: "p2", nombre: "Cena del viernes", cat: "alimentacion", emoji: "🍝",
    tagline: "Risotto de hongos con Gemi",
    fase: "seiri", asignados: ["u2"], deadline: "Hoy · 19:30",
    grupos: [
      { fase: "seiri", titulo: "La cocina debe estar lista", items: [
        it("Loza lavada", { status: "done", assignee: "u2" }),
        it("Mesones despejados", { status: "progress", assignee: "u2", verify: true }),
        it("Basura vaciada", { status: "pending", assignee: "u2" }),
      ]},
      { fase: "seiton", titulo: "Reunir todo", items: [
        it("Arroz arborio (320g)", { status: "done" }),
        it("Hongos mixtos (400g)", { status: "blocked", blockedReason: "Se acabaron, ir a comprar" }),
        it("Parmesano (80g)", { status: "progress" }),
        it("Sartén grande", { status: "done" }),
      ]},
      { fase: "seiso", titulo: "Mientras cocinas", items: [
        it("Limpiar salpicaduras", { status: "pending" }),
      ]},
      { fase: "seiketsu", titulo: "Al terminar", items: [
        it("Descontar del inventario", { status: "pending", verify: true }),
        it("Estufa apagada", { status: "pending" }),
      ]},
      { fase: "shitsuke", titulo: "Hábito", items: [
        it("Foto final de la cocina", { status: "pending", verify: true }),
      ]},
    ],
  },
  {
    id: "p3", nombre: "Mockups en Blender", cat: "diseno", emoji: "🎨",
    tagline: "Mueble modular de pino",
    fase: "seiso", asignados: ["u1", "u4"], deadline: "26 abr",
    grupos: [
      { fase: "seiri", items: [
        it("Borrar .blend viejos", { status: "done", assignee: "u1" }),
        it("Eliminar texturas sin licencia", { status: "done", assignee: "u1" }),
      ]},
      { fase: "seiton", items: [
        it("Nombrar archivos [modelo]_v[n]_[autor]", { status: "done", assignee: "u1" }),
        it("Organizar materiales en colecciones", { status: "done", assignee: "u4" }),
      ]},
      { fase: "seiso", items: [
        it("Revisar normales antes de exportar", { status: "progress", assignee: "u4", hint: "3 de 6 listos" }),
        it("Arreglar UVs de estante alto", { status: "blocked", assignee: "u1", blockedReason: "Falta feedback del cliente" }),
        it("Revisar render sin fireflies", { status: "llm", assignee: "llm", verify: true }),
      ]},
      { fase: "seiketsu", items: [
        it("Documentar proceso de export", { status: "pending" }),
      ]},
      { fase: "shitsuke", items: [
        it("Ritual pre-render de 5 pasos", { status: "pending", verify: true }),
      ]},
    ],
  },
  {
    id: "p4", nombre: "Ordenar el taller", cat: "mantenimiento", emoji: "🔧",
    tagline: "Un lugar para cada herramienta",
    fase: "seiton", asignados: ["u5"], deadline: "30 abr",
    grupos: [
      { fase: "seiri", items: [
        it("Descartar brocas rotas", { status: "done", assignee: "u5" }),
        it("Tirar pintura abierta > 2 años", { status: "done" }),
      ]},
      { fase: "seiton", items: [
        it("Tablero de sombras", { status: "progress", assignee: "u5", hint: "12 de 18 siluetas" }),
        it("Etiquetar cajones con color", { status: "progress" }),
      ]},
      { fase: "seiso", items: [
        it("Limpieza del banco (mensual)", { status: "pending" }),
      ]},
      { fase: "seiketsu", items: [
        it("Pauta visual en la pared", { status: "pending", verify: true }),
      ]},
      { fase: "shitsuke", items: [
        it("Auditoría semanal · foto", { status: "pending", verify: true }),
      ]},
    ],
  },
  {
    id: "p5", nombre: "Cierre de abril", cat: "finanzas", emoji: "💰",
    tagline: "Conciliar y reportar",
    fase: "seiri", asignados: ["u2"], deadline: "2 may",
    grupos: [
      { fase: "seiri", items: [
        it("Depurar transacciones duplicadas", { status: "progress", assignee: "u2" }),
      ]},
      { fase: "seiton", items: [
        it("Categorizar por centro de costo", { status: "pending" }),
      ]},
      { fase: "seiso", items: [
        it("Detectar anomalías", { status: "pending", verify: true }),
      ]},
      { fase: "seiketsu", items: [
        it("Plantilla de reporte", { status: "pending" }),
      ]},
      { fase: "shitsuke", items: [
        it("Revisión semanal de caja", { status: "pending" }),
      ]},
    ],
  },
  {
    id: "p6", nombre: "Release firmware v3.2", cat: "ingenieria", emoji: "💻",
    tagline: "Compilar, testear, soltar",
    fase: "seiso", asignados: ["u1", "u3"], deadline: "28 abr",
    grupos: [
      { fase: "seiri", items: [
        it("Eliminar ramas mergeadas", { status: "done", assignee: "u1" }),
      ]},
      { fase: "seiton", items: [
        it("Estructura src/ docs/ tests/", { status: "done" }),
      ]},
      { fase: "seiso", items: [
        it("Tests unitarios", { status: "progress", assignee: "u1" }),
        it("Lint + format", { status: "done" }),
        it("Valgrind · memory leaks", { status: "llm", verify: true }),
      ]},
      { fase: "seiketsu", items: [ it("CI/CD con release automation", { status: "pending" }) ]},
      { fase: "shitsuke", items: [ it("Daily standup notes", { status: "pending" }) ]},
    ],
  },
];

const ALERTAS = [
  { id: "a1", time: "12:30", nombre: "Hora del almuerzo", sound: "bell", animal: "bear" },
  { id: "a2", time: "15:00", nombre: "Pausa Blender #3", sound: "chime", animal: "fox" },
  { id: "a3", time: "17:30", nombre: "Paseo con Tobías", sound: "bark", animal: "dog", blocking: true },
  { id: "a4", time: "19:30", nombre: "Empezar la cena", sound: "timer", animal: "bear", blocking: true },
];

const SONIDOS = [
  { id: "bell", nombre: "Campana" },
  { id: "chime", nombre: "Carrillón" },
  { id: "bark", nombre: "Ladrido" },
  { id: "timer", nombre: "Timer" },
  { id: "gong", nombre: "Gong" },
];

window.SEED = { FASES, CATS, USERS, PROYECTOS, ALERTAS, SONIDOS };
