# Auditoría de regresión — zip `4f9c871` (reconstrucción D68-D72)

> **Fecha**: 2026-10-22 · Tarea 3A.6 · rama `audit/quality-pass-1` · **solo
> diagnóstico, cero cambios de código**.
> **Origen**: al cerrar la sospecha B1 (3A.5) se descubrió que el destello
> D65 T3.3 existía cableado (`84cd0be`) y se perdió en `4f9c871`. Este
> documento generaliza la búsqueda: **¿qué más perdió ese zip?**
>
> **Método** (reproducible, solo lectura — sin bisect ni checkout):
> 1. Rango exacto: `4f9c871` es hijo directo de `e8c98de`
>    (`git rev-parse 4f9c871^` → `e8c98de6c9f4...`), zip del 21-oct 12:42 BOG,
>    +904/−752 sobre 14 archivos de `src/`.
> 2. **Símbolos top-level**: extracto `const|function|class|type|interface|enum`
>    por archivo en `e8c98de` / `4f9c871` / `HEAD` (`git show` + grep) →
>    `comm -23` por archivo.
> 3. **Marcadores UI**: conteo por archivo de `role=`, `aria-`, `aria-live`,
>    `title=`, `progressbar`, `animate-`, `<Componente` en los 3 estados.
> 4. **Intra-componente**: estados (`useState`/`useMemo`) de HEAD con refs ≤2
>    comparados contra sus refs en `e8c98de`; identificadores de líneas
>    borradas buscados en todo `src/@4f9c871`.
> 5. **Comentarios huérfanos**: comentarios de HEAD que describen UI ausente.
>
> ⚠️ **Lección de método**: un primer barrido automatizado de identificadores
> dio **falsos positivos** (`SensorsIcon`, `masivaOrigen`, `actasSesion`
> reportados como perdidos cuando sobreviven). Toda fila de esta tabla fue
> **re-verificada con comando directo** (`git show`/`git grep` por ref) antes
> de incluirse. El grep de comentarios cuenta comentarios como código —
> siempre mirar el contexto.

---

## Tabla de pérdidas

| # | Severidad | Tipo de pérdida | Archivo | Símbolo/feature perdida | Evidencia (commit origen) | Re-cablear / abandonar (recomendación) |
|---|---|---|---|---|---|---|
| 1 | **MEDIA** (feature UX pagada) | Regresión de reconstrucción — bloque JSX completo | `MasivaView.tsx` | **Bloque D65 T3.3 completo** (~46 líneas): barra `h-1` por fila con 4 ramas — `role="progressbar"` con % OCR real (`ocrPct`), pulso verde (`esActiva`, `animate-pulse`), roja (ERROR), **destello 100 % verde en LISTA** (`LISTA && recienListas.has(f.id)`), vacía (EN COLA) — + texto de etapa con `aria-live="polite"`: «EN COLA **#${posCola} DE ${colaVida.length}**» / `etiquetaVida({etapa})` | Existía en `e8c98de` L625-670 (y nació en `84cd0be`, D65). El zip lo reemplazó por el chip % (`pctProceso` + `title="Progreso del proceso del acta"`): la **información del % sobrevive reducida**; se perdieron posición en cola, destello, barra ERROR y semántica a11y | **RE-CABLEAR.** Plomería 100 % intacta (`recienListas`, `enColaVida`, `posCola`, `colaVida`); estilos existen; el QA e65b grepea el **FILTRO** `colaVida` (no el render) → sigue verde. De paso limpia los 2 warnings lint deliberados de MasivaView. Alternativa (b): abandonar = borrar cadena completa + actualizar gate QA — jamás el código solo |
| 2 | MEDIA (a11y) | Parte del bloque #1 | `MasivaView.tsx` | `role="progressbar"` por fila con `aria-valuemin/max/now={ocrPct}` + `aria-live` de etapa — hoy **0 refs `aria-valu*` en todo `src/`@4f9c871** (la ProgressBar de `primitives.tsx` sobrevivió mejorada, pero es la del lote, no por fila) | `e8c98de` L633-642, L655 → `4f9c871`: nunca reemplazado | Incluido en #1 al re-cablear |
| 3 | **MEDIA** (plomería colgando; UI de reemplazo EXISTE) | Regresión de reconstrucción — bloque JSX completo | `ScanView.tsx` | **Menú §6.3 SELECTOR DE MODO completo** (~60 líneas): botón amarillo de encuadre (`StitchFrameIcon`, `aria-haspopup="menu"`, `aria-expanded`, `onClick` toggle), backdrop FIXED (FIX auditoría 2-b #16), panel `role="menu"` con 3 `role="menuitem"` (SIMULACIÓN/CÁMARA/IMPORTAR con checks), animación 150 ms (`modoMenuMontado`: opacity+scale 0.97→1) | `e8c98de` L1967-2035 → `4f9c871` eliminó el JSX, dejó estados+efecto | **ABANDONAR el menú** (el segmented CÁMARA/SIM/SUBIR siempre-visible es la UI actual — runtime 3A.5: 0 dialogs, 0 `scale-0.97`) **y limpiar huérfanos en Fase 4**: estados `modoMenuAbierto`/`modoMenuMontado` + efecto Escape + comentarios L712-716/764-769 |
| 4 | BAJA (honestidad) | Corrección de veredicto propio | `AUDIT.md` §2.2-B1 | **Corrige 3A.5**: `modoMenuMontado` NO «nació ya huérfano en 4f9c871» — el consumidor **existía** en `e8c98de` (L2003: `modoMenuMontado ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]"`) y el zip lo eliminó. Misma mecánica que `recienListas`. El veredicto **(c)** sigue siendo correcto en espíritu (el menú fue reemplazado por el segmented), pero la mecánica es eliminación-de-consumidor, no nacimiento-huérfano | `git show e8c98de:src/components/e14/screens/ScanView.tsx \| sed -n '2000,2006p'` | Documentado aquí y en AUDIT.md (commit de esta tarea) |
| 5 | BAJA (cosmético) | Clase de animación perdida | `ActasView.tsx` | `SensorsIcon` del indicador **EN LÍNEA** perdió `animate-pulse-sync` (hoy solo color `text-[#10b981]`; el botón SIM sí conservó su pulso) | `e8c98de` L274 → `4f9c871` L277 → HEAD L284 | Restaurar 1 clase (1 línea, trivial) o aceptar como decisión de la nueva skin |
| 6 | MEDIA (decisión técnica) | **Revert de rendimiento documentado** — no es pérdida de código | `src/lib/e14/ocr/rapidocr.ts` | `ort.env.wasm.proxy` **true → false**: el KIT e14-optimizacion-v1 (T2) migraba det/cls/rec al worker interno de ORT (inferencia 9.8-14.3 s dejaba de bloquear el main thread; ANALIZANDO dejaba de congelarse). El zip lo revirtió con justificación de 1 línea: «evitar error de resolución dynamic import en bundler» (y redujo el comentario de auditoría de 8 líneas) | Diff del zip sobre `rapidocr.ts` L167-174 | **Decisión del dueño**: probar `proxy=true` con el bundler actual (si ya no rompe, recuperar la mejora) o aceptar el tradeoff. No tocar sin verificación runtime (kit §3-T2.2) |
| 7 | INFO (derivado) | Export muerto derivado | `icons.tsx` | `StitchFrameIcon` quedó sin consumidor: el zip borró su único uso (botón amarillo del menú) y el import muerto fue eliminado por nosotros en `2c011a2` (bucket A) — hoy solo existe la definición | `git grep StitchFrameIcon HEAD -- src/` → 1 hit (def) | Material 3B: borrar el export, o conservarlo si el dueño reviviera el menú |

---

## Resumen ejecutivo (8 líneas)

- **Pérdidas reales: 4** — bloque D65 T3.3 en MasivaView (#1/#2, MEDIA),
  menú §6.3 en ScanView (#3, MEDIA-con-reemplazo), pulso online en ActasView
  (#5, cosmética) y el revert de `wasm.proxy` en rapidocr (#6, tradeoff
  documentado, no bug). Más 1 derivado (#7) y 1 corrección de veredicto (#4).
- **Seguras de re-cablear (feature)**: solo #1/#2 — plomería `recienListas`/
  `enColaVida`/`posCola`/`colaVida` intacta, estilos vivos, QA compatible.
- **Ambiguas (código intermedio / decisión)**: #3 (el reemplazo segmented
  existe; lo correcto es abandonar el menú y limpiar huérfanos), #6
  (tradeoff técnico legítimo, requiere prueba de bundler).
- **Ninguna pérdida a nivel de símbolo top-level**: las 14 declaraciones
  extraídas por archivo de `e8c98de` sobreviven en `4f9c871` (el zip solo
  AÑADIÓ `porcentajeProcesoActa`). Tampoco se perdió lógica de pipeline
  (OCR/dedup/estados/persistencia intactos — la consola de v5.log lo prueba).
- **Modo de fallo del zip**: reconstrucciones pierden **bloques JSX** y dejan
  estado + comentarios huérfanos — invisible para tsc/lint/build/knip.
- **Orden recomendado Fase 4**: (1) re-cablear D65 T3.3 — resuelve #1+#2,
  los 2 warnings de MasivaView y el 3.er ref de `colaVida`; (2) limpiar
  huérfanos del menú §6.3 en ScanView + resolver `StitchFrameIcon` en 3B;
  (3) decidir `wasm.proxy` con prueba de bundler; (4) restaurar el pulso de
  ActasView (1 línea); (5) 3B-B1…B4 con el protocolo de borrado (ya no urgente).
- **Evidencia runtime**: `docs/evidence/regresion-d65/` (capturas + logs
  v4/v5: pipeline completo corriendo con 0 barras en la bandeja en 150 s).
