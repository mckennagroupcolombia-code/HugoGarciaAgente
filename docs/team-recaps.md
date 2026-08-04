# Recaps del Equipo

Registro corto y visual de cada tarea/sesión de trabajo con la IA sobre este repositorio: qué se implementó, quién lo hizo y qué archivos tocó. Se muestra en el panel `/app` → Sistemas → **Control de Versiones** (pestaña "Recaps del equipo"), leído por `app/tools/team_recaps.py` vía `GET /api/team-recaps`.

No reemplaza otros registros existentes, que tienen propósito distinto:

- `HISTORIAL_MODIFICACIONES.md` — bitácora larga de sesiones técnicas (motivación/lección).
- `docs/agentic/DECISIONS.md` — decisiones de metodología/arquitectura agentic.

Este archivo es para el equipo humano: recaps cortos y parseables, uno por tarea significativa.

## Cómo agregar una entrada

Protocolo completo en `docs/agentic/TEAM_WORKFLOW.md`. En resumen: **anteponer** (más reciente arriba, justo debajo de este encabezado) un bloque con esta plantilla exacta, en el mismo commit que el código:

```markdown
#### [Fecha y Hora] - [Título Corto del Cambio]
- **Autor:** [Nombre del Desarrollador Activo]
- **Tipo de Cambio:** [Nueva funcionalidad / Corrección / Mejora técnica]
- **Qué se implementó:**
  - Explicación clara y directa orientada a producto o código.
  - Impacto principal en la arquitectura o en la interfaz de la app.
- **Archivos Modificados:** (Lista breve de módulos o componentes afectados)
```

(La entrada real usa tres `#` — `### Fecha - Título`, sin corchetes. El bloque de arriba usa cuatro `#` a propósito, solo para que este ejemplo no aparezca como un recap real en el panel.)

---

### 2026-08-04 15:45 - Selector "¿Quién hizo esto?" en commits y recaps
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Botón "¿Quién hizo esto?" en cada fila de commit y en cada tarjeta de recap, con menú rápido para elegir entre Cynthia / Armando García (o quitar la asignación).
  - Para commits: la asignación es un override manual aparte (`app/data/control_versiones_autores_commits.json`, `{hash: autor}`) — no reescribe git, solo etiqueta el commit en el panel (`GET /api/git/log` ahora incluye `autor_manual` por commit y `desarrolladores_conocidos`; `POST /api/git/log/autor` guarda/borra la asignación).
  - Para recaps: la asignación reescribe directamente la línea `**Autor:**` de la entrada correspondiente en `docs/team-recaps.md` (`POST /api/team-recaps/autor` con `{indice, autor}`), así el archivo sigue siendo la única fuente de verdad.
- **Archivos Modificados:**
  - `app/tools/git_history.py` (`asignar_autor_commit`, `DESARROLLADORES_CONOCIDOS`), `app/tools/team_recaps.py` (`asignar_autor_recap`, campo `indice`), `app/routes.py`, `app/data/control_versiones_autores_commits.json`
  - `desktop/src/components/ControlVersionesPanel.tsx` (`SelectorAutorBoton`), `desktop/src/hooks/useGitLog.ts`, `desktop/src/hooks/useTeamRecaps.ts`, `desktop/src/lib/gitGraphLayout.ts`

### 2026-08-04 15:30 - Rediseño del árbol de commits + filtro por autor + indicadores de auto-commit
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Árbol de commits rediseñado: filas HTML grandes y legibles alineadas al grafo SVG (ya no texto diminuto en foreignObject), chip de autor con color determinístico, badges de rama HEAD/origin, fechas relativas, merges marcados y auto-commits atenuados (con toggle).
  - Filtro por desarrollador en "Recaps del equipo": chips por autor (útil porque las 2 personas comparten la cuenta git; el autor real viene del `--author` de cada commit/recap).
  - Indicadores visuales de auto-commit: tarjetas con cuenta regresiva y barra de progreso hasta el cron diario de las 23:00 (`auto_commit.sh`) y el backup nocturno de las 02:00 (`backup_drive.py`), más el conteo de archivos sin commitear que entrarían en el próximo auto-commit (`estado_auto_commit()` en el backend, expuesto dentro de `GET /api/git/log`).
- **Archivos Modificados:**
  - `app/tools/git_history.py` (nuevo `estado_auto_commit()`)
  - `desktop/src/components/ControlVersionesPanel.tsx`, `desktop/src/hooks/useGitLog.ts`, `docs/team-recaps.md`

### 2026-08-04 16:00 - Metodología de recaps + panel visual de Control de Versiones
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Protocolo obligatorio de autoría de commits (`--author`), sincronización `git pull`/`git fetch` y recap estructurado al final de cada tarea (`docs/agentic/TEAM_WORKFLOW.md`).
  - Este archivo `docs/team-recaps.md` como registro versionado, parseado por el backend para exponerlo en la UI.
  - Endpoints de solo lectura `GET /api/git/log` (historial de commits, todas las ramas, formato apto para grafo) y `GET /api/team-recaps` (recaps parseados).
  - Panel nuevo **Control de Versiones** dentro del hub Sistemas (`/app`, modo avanzado): pestaña "Árbol de commits" con un grafo de nodos tipo cladograma dibujado a mano en SVG (sin librerías externas), y pestaña "Recaps del equipo" con tarjetas de cada entrada de este archivo.
- **Archivos Modificados:**
  - `docs/agentic/TEAM_WORKFLOW.md`, `docs/agentic/CHECKLIST.md`, `docs/agentic/INDEX.md`, `docs/agentic/CONTRACTS.md`, `docs/agentic/DECISIONS.md`, `CLAUDE.md`, `docs/team-recaps.md`
  - `app/tools/git_history.py`, `app/tools/team_recaps.py`, `app/routes.py`
  - `desktop/src/components/ControlVersionesPanel.tsx`, `desktop/src/lib/gitGraphLayout.ts`, `desktop/src/hooks/useGitLog.ts`, `desktop/src/hooks/useTeamRecaps.ts`, `desktop/src/stores/app.ts`, `desktop/src/lib/panelInfo.ts`, `desktop/src/lib/navStructure.ts`, `desktop/src/icons/mck/paths/panels.tsx`, `desktop/src/App.tsx`
