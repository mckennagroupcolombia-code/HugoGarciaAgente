# Rrhh horas

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

### Mi mes en el panel (ficha de rendimiento, 23-sep-2026)
En la Agenda, cada persona ve sus horas del último mes, sus funciones (veces, promedio por vez, horas) y el tipo
de trabajo, y abre «Ver mi ficha» en letra grande (`MiRendimiento.tsx` → `GET /api/tickets/rendimiento`,
`app/services/rendimiento.py`, sin LLM). Administración ve la de cualquiera. **No muestra pagos ni valoraciones.**
Solo cuenta lo registrado en el panel; el desarrollo con IA y el trabajo físico sin tarea abierta no suman.

### Mapa de funciones (RRHH, 23-sep-2026)
/app → RRHH · Compensaciones → «Mapa de funciones»: persona × etapa en vivo (horas, veces, promedio por vez,
valor = horas × tarifa del nivel N1–N5), horas que cubre el pago, comisión de WhatsApp y **valor de mercado en
honorarios** (`mapa_funciones.honorario_equivalente`). Pagos, propuestas, tarifas y mercado en
`app/data/rrhh_valoracion.json` (**fuera de git: salarios**). Rutas `/api/rrhh/mapa-funciones*` (permiso rrhh).

### Control de horas por quincena (23-sep-2026)
Honorarios con **dedicación pactada** (camino A): horas por quincena = pago quincenal ÷ valor hora de mercado (÷ **159 h/mes**,
las efectivas de un tiempo completo con 42 h/semana; no 210, que incluye domingos pagados; festivos en `festivos_co.py`, sin meta) de su
labor. «Mi quincena» en la Agenda y «Control de horas» en RRHH (`app/services/control_horas.py`). Horas activas por
bloques de 15 min sin doble conteo (panel + cronómetro + sesiones de IA de `RENDIMIENTO_SESIONES_IA`) + tiempo
explicado y aprobado (máx. 6 h/semana). Horas de más × valor hora = cuenta de cobro. **Nunca** poner horario de
entrada/salida: es subordinación y convierte la prestación de servicios en contrato laboral.
**Regla visible para todos:** se pide completar las horas convenidas, no rapidez; lo que se haga después son horas
adicionales **al mismo valor hora** (son honorarios, no horas extra laborales: sin recargo). Quien atiende colectas de MeLi
(`colectas: true` en la persona; hoy Jenniffer, Stella y Victor) debe estar **disponible de lunes a viernes**: es la
disponibilidad que el servicio exige, no un horario; a esas personas no se les dice que repongan horas «cualquier día».
Cocinar el almuerzo del equipo (Víctor) sí cuenta como actividad del servicio. **Detalle por día** (`control_horas.detalle_dia`, `GET /api/tickets/control-horas/dia?fecha=`): tocar un día en «Mi
quincena», en la ficha o en RRHH abre `DiaDetalle` — tramos con hora, qué se hizo (tarea con cronómetro y su resultado,
panel y nº de acciones, desarrollo con IA), ratos sin registro que no cuentan y lo que quedó terminado. Sale de
`_fuentes()`, la misma función del total: el detalle y la suma no pueden divergir (hay test). Abrir **Juegos** no cuenta
(`PANELES_DESCANSO`). **Cronómetro de tareas (27-sep-2026):** ocultar la pantalla, bloquear el celular, «Salir» o «‹» ya NO pausan (`useTicketCronometro` en `Cronometro.tsx`); solo el botón ⏸. Antes jerry/vitor tenían registrada < 50 % del tiempo real en 3 de cada 4 tareas. El reloj de lo que corre está en el cabezote de todas las pantallas (`TareaEnCurso.tsx`, `GET /api/tickets/corridas/en-curso`) con pausar/reanudar y el aviso de voz «Pilas, veci: tiene una tarea en proceso» cada 15 min (`lib/avisoTareaEnCurso.ts`, marca compartida con la vista Acciones para no sonar doble; alarma nativa del APK / push). `iniciar_corrida_ticket` usa `BEGIN IMMEDIATE` (nacían dos corridas por tarea). Huérfanos (corrida abierta en tarea cerrada): `scripts/cerrar_cronometros_huerfanos.py --aplicar` los cierra sin sumar tiempo (`finalizada_en` NULL); 75 cerrados ese día. Resumen semanal por WhatsApp: `scripts/resumen_semanal_horas_cron.py` (viernes 17:30, solo envía con `RESUMEN_HORAS_WA_ACTIVO=1`). Los **tiempos estándar** (`tiempos_estandar.py`, mediana de lo
cronometrado, ≥5 muestras; **nunca tiempos estimados a mano**: un ticket sin cronómetro cuenta su huella real, minutos desde la
acción anterior, máx. 30) y las «horas a tiempo estándar» son solo referencia de administración, no se muestran a la persona.
