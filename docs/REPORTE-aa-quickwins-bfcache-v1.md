# REPORTE — KIT e14-aa-quickwins-bfcache-v1

**Ejecutante:** agente implementador del dueño · **Fecha:** 2026-10-26
**Rama:** `feat/aa-quickwins-bfcache-v1` · **Base:** `main` = `9b0fe8d` (merge PR #104 — `git diff dbcc3c3 9b0fe8d` = VACÍO, re-verificado en el árbol local antes de empezar)
**Alcance:** quick wins AA (C1 contraste · M4 rojo crit · M1 targets táctiles) + fix bfcache del sensor hang-en-curso (desviación D-104-2 del DICTAMEN-obs-hang-atribucion-v1 §4.2).

---

## 1 · Commits atómicos (1 tarea = 1 commit)

| Commit | Tarea | Contenido |
|---|---|---|
| T1 | §A fix bfcache | `heartbeat.client.ts`: `pageshow` con `persisted===true` → kill-switch re-chequeado → WAL **consumido SIN EMITIR** (`void leerYLimpiar()` — espejo invertido del arranque) → instancia reconstruida (`terminate` del viejo no-op, interval limpiado ANTES, baseline de visibilidad + beat inmediato) · listeners y beat postean a la **variable de módulo** `workerVivo` · seam `__setFabricaWorkerHeartbeatParaTest` + **6 tests** (`heartbeat.client.test.ts`) |
| T2 | §B C1 contraste | 47 líneas en 11 archivos: 46 grises `slate/gray-500(600)` → `400` en texto ≤ 12 px (40 misma-línea + 6 por herencia) + chip `QR ✗` `text-white/30` → `text-slate-400` |
| T3 | §C M4 | `primitives.tsx`: 5 substrings `ef4444` → `E52222` (bg :17/:24/:51/:173 + shadow/25 :51) + `rgba(239,68,68,0.4)` → `rgba(229,34,34,0.4)` :173 |
| T4 | §D M1 | 6 `min-h` → `44px`: MasivaView :450 :461 :487 :613 :636 · ResumenView :201 |
| T5 | §E | `scripts/qa-aa-quickwins.ts` (17 anclas POR PATRÓN) + gate 12/12 |
| T6 | §F | este REPORTE |

## 2 · Decisiones de implementación

- **Semántica restore-vs-arranque documentada en el encabezado del cliente** (§A.1.2): en el ARRANQUE una marca sobreviviente = muerte colgada → SE EMITE; en el RESTORE la página está viva → se CONSUME en silencio (el drift de `hang.ts` ya contó ese hang al reanudar). Emitir sería doble conteo con encuadre falso. La asimetría ES la semántica — test §A.2-2/3 la bloquea (`appendEvento` mock nunca llamado).
- **`crearInstancia(conBaselineVisibilidad: boolean)`:** el ARRANQUE pasa `false` (semántica original byte-exacta — no postea `visibilidad` inicial; red line 3) y el RESTORE pasa `true` (§A.1.3: una restauración puede ser a pestaña en segundo plano — el worker nuevo arranca `visible:true` por defecto).
- **Seam de tests** (espejo `sondeo-qr.client.ts:218`): `__setFabricaWorkerHeartbeatParaTest(f | null)` además resetea el singleton (`apagarInstancia()` + `iniciado = false`) para que cada test corra su propio arranque — sin esto la idempotencia del bootstrap haría imposibles los tests 1-6. `null` restaura la fábrica de producción.
- **Infra de tests sin dependencias nuevas:** fake-IDB mínimo a mano sobre `globalThis.indexedDB` (MISMO patrón de `heartbeat-wal.test.ts:104-138`; UNA fake viva para todo el archivo — el WAL cachea su `open` en `dbPromesa`), `window`/`document` stub con captura de listeners e intervals manuales (determinista, sin fake timers) y flags REALES sobre `localStorage` stub con override `e14-flags-overrides` (patrón `export-meta.test.ts`).
- **T2 quirúrgico por línea:** los 47 cambios se aplicaron SOLO sobre las líneas del inventario cerrado del auditor (sed por número de línea sobre el snapshot `9b0fe8d` — los números siguen válidos porque ninguna edición mueve líneas), re-verificados con grep por clase exacta.

## 3 · Inventario real cambiado (file:line)

**T1:** `src/lib/e14/obs/heartbeat.client.ts` (reescritura del singleton: +vars de módulo `workerVivo`/`intervalBeat`, `alPageshow`, refactor de arranque a `crearInstancia`) · `src/lib/e14/obs/heartbeat.client.test.ts` (NUEVO, 6 tests).

**T2 (46 grises + 1 chip):**
| Archivo | Líneas |
|---|---|
| `screens/MasivaView.tsx` (8) | 546, 587, 623, 776, 889, 930, 948 (grises) · **767 (chip QR ✗)** |
| `dev/PanelDev.tsx` (10) | 75, 86, 124, 427, 502, 507, 538, 600, 619, 929 (slate-600) |
| `dev/VistaErrores.tsx` (7) | 128, 153, 168, 172, 176, 180 (4 `dt` heredan `text-[10px]` del `dl` :165), 210 |
| `SideNav.tsx` (5) | 75, 116, 153, 158, 178 (slate-600) |
| `AyudaOverlay.tsx` (4) | 204, 218, 231, 276 |
| `QuadEditor.tsx` (3) | 460, 467, 647 |
| `screens/ReviewView.tsx` (4) | 497 (hereda `text-[10px]` de :493), 616, 669, 810 (ternario inactivo, `text-[11px]` en :809) |
| `screens/ScanView.tsx` (2) | 1001, 1035 |
| `screens/ResumenView.tsx` (2) | 221, 231 |
| `screens/ActasView.tsx` (1) | 338 |
| `screens/AnalyzingView.tsx` (1) | 237 |

**T3:** `primitives.tsx` :17 :24 :51 (×2) :173. **T4:** MasivaView :450 :461 :487 :613 :636 · ResumenView :201.

## 4 · Desviaciones y hallazgos (M-aa-*)

- **M-aa-1 (menor, doc):** el encabezado de `check-quality.sh` (línea 15) también pasó de «los 11 harnesses» a «los 12 harnesses» — coherencia del comentario interno del gate además de los 3 toques ordenados en §E. Sin efecto funcional.
- **M-aa-2 (notaN, no es desviación):** el kit ubicaba REINICIAR JORNADA en `ResumenView.tsx:~202` — el patrón está en **:201** (mismo botón, verificado por contexto). Aplicado en :201.
- **HALLAZGO NUEVO (sin cambio — red line 5):** `MasivaView.tsx:831` — chip `{f.nivel}` con `text-gray-500` SIN token de tamaño propio (hereda del contenedor de la fila). El inventario del auditor NO lo incluye (su trazado de herencia no lo computó ≤ 12 px). Declarado aquí por la regla «hallazgo nuevo → REPORTE, no cambio silencioso»; candidato a revisión en e80 junto al resto de residuales.
- **knip:** 48→49 exports · 30→31 types (+1/+1: el seam `__setFabricaWorkerHeartbeatParaTest` y el tipo `FabricaWorkerHeartbeat`/`WorkerHeartbeat` de contrato de tests) — informativo, dentro de lo anticipado por §H (regla FASE 1).

## 5 · Gate completo (números reales — ejecutado íntegro, RC=0)

| Paso | Resultado |
|---|---|
| tsc --noEmit | 0 errores |
| eslint | 0 errores / 0 warnings |
| next build | exit 0 (1 rutas) |
| smoke sondeo (3bis) | 14/14 — artefacto fresco byte a byte · cliente limpio |
| smoke heartbeat (3ter) | 14/14 — **artefacto BYTE-IDÉNTICO a `9b0fe8d` (4909 bytes, diff 0)** — T1 no lo toca (red line 1) |
| vitest | **329 = 323 + 6** (≥ 328 exigido — kit ≥ 5 tests, entregados 6) |
| QA harnesses | **12/12**: aa-quickwins **17/17** (NUEVO) · autoenvío 33 · dedup-enviadas 50 · escaneo-ya-recortado 24 · historico-enviadas 49 · identidad-acta 32 · obs-contract 38 · obs-privacidad 7 · obs-transporte 8 · obs-ui 8 · qr-identidad 72 · watchdog-relectura 34 |
| knip | 49 exports + 31 types (informativo — M-aa) |

## 6 · Líneas rojas §G — verificación

1. `heartbeat.worker.ts` + `public/scanner/heartbeat.worker.js` **BYTE-IDÉNTICOS** a `9b0fe8d` (diff 0) + smoke 3ter 14/14 ✓
2. Zona minada intocada: `git diff 9b0fe8d..HEAD` sobre runner/store/cola/historico/tipos/flags/politica/informe/export/hang/identidad-qr/sondeo-qr.worker/qr-pixeles = **VACÍO** ✓
3. Semántica de ARRANQUE intacta (kill-switch primero → drenaje antes del worker → config → beat → interval → listeners) ✓ — tests preexistentes verdes (heartbeat-wal 10/10, kit-104 obs 4/4…)
4. Restore JAMÁS emite evento obs (cero doble conteo) — tests §A.2-2/3 + lectura del diff ✓
5. 46+1 líneas de contraste EXACTAS del §B — re-scan: 47 diffs exactos, 0 co-ocurrencias residuales en `src/components/**` ✓
6. `#ef4444` solo cambió en `primitives.tsx` (los 4 oscuros AÚN lo contienen — QA en ambas direcciones) ✓
7. Solo 6 `min-h` cambiados; dev-panel intocado ✓
8. Diff de `obs/` sin `console.`/`localStorage.setItem` (qa-obs-privacidad 7/7) ✓
9. Vitest **329 ≥ 328** ✓
10. QA **12/12** con el array NOMBRES exacto del §E (`aa-quickwins` primero — glob alfabético) ✓

## 7 · Residuales pactados → pendientes de e80

- `ReviewView.tsx:898` — `text-[13px] text-gray-500` (13 px > 12 px: fuera de la regla C1 de este kit).
- `PanelClasificacion.tsx:88` — gray-500 DISABLED (exento por WCAG 1.4.3).
- Iconos `MasivaView.tsx:687` / `ReviewView.tsx:896` — contenedores de icono, fuera de AA 1.4.3.
- Botones del panel dev (`PanelDev`/`VistaErrores`/`TuercaResumen`) — min-h residual.
- Consolidación de tokens de color, `#00e676`/`#34c759`, focus-visible global, `prefers-reduced-motion` — e80.
- **Nuevo:** chip `{f.nivel}` `MasivaView.tsx:831` (M-aa hallazgo — trazado de herencia pendiente).

## 8 · Smoke manual del dueño (post-merge, 5 min — kit §H)

1. Chrome Android → abrir la app → navegar a otra pestaña y VOLVER con atrás (bfcache) → operar un lote normal → en el SIGUIENTE `informe.json`: cero eventos `hang-en-curso` espurios tras la navegación (el restore consume el WAL sin emitir).
2. Verificación visual: chips de filtro y PROCESAR/VACIAR más altos (44 px), grises pequeños legibles, CTA rojo `crit` con el mismo tono que los botones de ReviewView.
