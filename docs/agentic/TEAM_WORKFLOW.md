# Team Workflow — Autoría, Sincronización y Recaps

Protocolo obligatorio para cualquier IA (o desarrollador) que trabaje en este repositorio bajo la cuenta git compartida "McKenna Group Colombia". Objetivo: traza limpia, autoría real por commit y un registro visual de cada tarea, visible para todo el equipo en `/app` → Sistemas → Control de Versiones.

## 1. Identificación de autoría

Al iniciar la sesión, si `git config user.name` local no identifica a una persona (sigue siendo la cuenta compartida), preguntar el nombre y correo del desarrollador activo antes de commitear. No asumirlo ni dejarlo en blanco.

Firmar cada commit con el parámetro de autor:

```bash
git commit --author="Nombre Apellido <correo@dominio.com>" -m "tipo: mensaje"
```

El `committer` sigue siendo la cuenta compartida (no se toca `git config`); solo el campo `Author` identifica a la persona real. `GET /api/git/log` expone ambos (ver `docs/agentic/CONTRACTS.md`).

## 2. Sincronización antes de programar

Antes de empezar a editar:

```bash
git fetch origin
git log --oneline HEAD..origin/<rama-actual>   # ¿hay commits remotos que no tengo?
git status                                     # ¿hay cambios locales sin commitear?
```

- Si `origin/<rama>` tiene commits nuevos y el árbol de trabajo está limpio → `git pull origin <rama>`.
- Si el árbol de trabajo tiene cambios sin commitear (frecuente en este repo por procesos automáticos: backups nocturnos, JSON de datos, etc.) → **no forzar el pull**. Evaluar si esos cambios son ajenos a la tarea (no tocarlos) o si conviene `git stash -u` antes de sincronizar.
- Si la rama no tiene tracking configurado, ver la sección "Git: `git pull` sin rama de seguimiento" en `CLAUDE.md`.

Commits atómicos con Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, etc.) durante el desarrollo.

## 3. Recap obligatorio al terminar una tarea

Al finalizar cualquier tarea, refactorización o bloque de cambios importante, agregar una entrada en **`docs/team-recaps.md`** (anteponer arriba del historial, entrada más reciente primero) con esta plantilla exacta:

```markdown
### [Fecha y Hora] - [Título Corto del Cambio]
- **Autor:** [Nombre del Desarrollador Activo]
- **Tipo de Cambio:** [Nueva funcionalidad / Corrección / Mejora técnica]
- **Qué se implementó:**
  - Explicación clara y directa orientada a producto o código.
  - Impacto principal en la arquitectura o en la interfaz de la app.
- **Archivos Modificados:** (Lista breve de módulos o componentes afectados)
```

Reglas:

- El recap va en **el mismo commit** que el código de la tarea — así viaja junto y queda disponible de inmediato en la siguiente sesión de cualquier terminal.
- No usar esta plantilla para bugs con causa raíz reusable (eso es `app/data/debugging_resuelto.jsonl`) ni para decisiones de metodología/arquitectura agentic (eso es `docs/agentic/DECISIONS.md`). El recap es para que el equipo humano vea, de un vistazo, qué cambió en la app.
- El recap se lee automáticamente vía `GET /api/team-recaps` (parseo best-effort de `docs/team-recaps.md`) y se muestra en el panel `/app` → Sistemas → Control de Versiones.

## 4. Visualización en el panel

`/app` → hub **Sistemas** (modo avanzado) → **Control de Versiones**:

- Pestaña "Árbol de commits": grafo de nodos (cladograma) del historial real de git, vía `GET /api/git/log`.
- Pestaña "Recaps del equipo": tarjetas con cada entrada de `docs/team-recaps.md`, vía `GET /api/team-recaps`.

Detalle de componentes en `docs/agentic/CONTRACTS.md` y `desktop/src/components/ControlVersionesPanel.tsx`.

## No negociables

- No usar `git commit --amend` sobre commits ya empujados a un remoto compartido.
- No forzar `git pull`/`git push --force` sobre una rama con trabajo ajeno sin avisar.
- El recap no es opcional para tareas de tamaño mediano/grande; para fixes triviales de una línea no es obligatorio, pero sí recomendable si afecta comportamiento visible.
