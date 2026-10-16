# AGENTS.md — Reglas para agentes IA en digitalizador-e14

## AL INICIAR CUALQUIER SESIÓN (obligatorio, en este orden)
1. Lee `docs/worklog.md` — al menos las últimas 3 entradas.
2. Lee `docs/ROADMAP.md` — identifica la primera tarea NO completada.
3. Lee `docs/DECISIONS.md` — respeta las decisiones; no las reviertas sin registrar por qué.
4. NO asumas que el código "ya funciona": verifica (`bun run dev:e14` + revisa).

## AL TERMINAR CADA SESIÓN (obligatorio, antes de cerrar)
1. Añade UNA entrada a `docs/worklog.md` (plantilla abajo). APPEND al final; NUNCA
   sobrescribas ni edites entradas de otros.
2. Actualiza los checkboxes de `docs/ROADMAP.md` según lo real.
3. Si tomaste una decisión de arquitectura/diseño, regístrala en `docs/DECISIONS.md`.
4. Commit con Conventional Commits (`feat(e14): …`, `fix(e14): …`, `docs(e14): …`).
5. Si el contexto se está acabando o te piden parar: añade además una entrada `[HANDOFF]`.

## Plantilla de entrada de worklog
### [YYYY-MM-DD hh:mm] — <fase/tarea> — <agente o "sesión manual">
- **Hecho:** <lista concreta>
- **Archivos:** <rutas tocadas>
- **Commits:** <hashes cortos>
- **Cómo probar:** <comandos + qué debería verse>
- **Pendiente/Bloqueado:** <siguiente paso exacto, con detalle suficiente para retomar>

## Campos extra de [HANDOFF]
- **Estado del servidor:** <corriendo o no, puerto>
- **Última acción a medias:** <qué estaba pasando exactamente>
- **Primer paso de la siguiente sesión:** <instrucción precisa>

## Reglas técnicas
- No toques `apps/scanner-lab` ni `packages/scanner-core` sin necesidad explícita.
- Si necesitas un cambio en el core: NO lo hagas aquí; regístralo como `[REQUIERE-CORE]`.
- Commit pequeño y frecuente > commit gigante.
- Fase gráfica: prohibido añadir dependencias de cámara/procesado.

## Registro de kits (una línea por kit — detalle en docs/worklog.md y docs/REPORTE-*.md)
- `2026-10-16` **gate-v2** (PR #3, MERGEADO `2383820`): marcadores obligatorios SIN_VOTOS + flujo post-recorte normal.
- `2026-10-15` **actas-resumen-puesto-v2** (PR #4, MERGEADO `e777535`): ACTAS muestra el puesto REAL (última clasificación archivada) con countTable DIVIPOL + MODO SIMULACIÓN (toggle «SIM», overlay de vista) + RESUMEN espeja el puesto; alerta «MESAS INCOMPLETAS» y seed demo FUERA de ACTAS.
- `2026-10-16` **camara-visor-v1** (PR #5, MERGEADO `49a323d`): paquete cámara/visor del lab — láser fuera, preview por plataforma (540p Android), FOTO_LADDER + upgrade silencioso full-res, gate CAN_TAKEPHOTO, ring ≤1280, apertura rápida cacheada, medidor pill, visor del editor con marco FIJO + botón «Imagen».
- `2026-10-16` **visor-accion-score-v1** (ESTA rama `feat/visor-accion-score`, PR #6 ABIERTO, SIN merge): REVISIÓN — botón «Pantalla completa» fuera (la foto es táctil), barra de acciones FIJA abajo + tarjeta 56vh (invariante G8 intacto) y el SCORE mide el RECORTE del acta (`calidadDeActa`, bbox del quad +3%) NO la mesa del fondo — fin del falso «LUMINOSIDAD» del caso EL CAIRO.
