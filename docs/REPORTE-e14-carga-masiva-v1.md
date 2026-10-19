# REPORTE — KIT e14-carga-masiva-v1 (2026-10-19)

**Rama:** `feat/e14-carga-masiva-v1` (desde main `2655a67` = PR #24 mergeado, precondición verificada vía API)
**Mandato:** «analiza y ejecuta» · `INSTRUCCIONES-e14-carga-masiva-v1.md` (el PLAN quedó SUPERADO — se ejecutó SOLO el INSTRUCCIONES)
**Estado:** PR **DRAFT** — merge SOLO con orden explícita del dueño.

## §0 Alcance cumplido

Módulo **MASIVA** separado, desktop-first: arrastras/seleccionas N fotos → cola persistente (IndexedDB vanilla) → **runner secuencial** con el MISMO pipeline real (`getBridge().escanearActa`) → bandeja de resultados con auto-envío de ÓPTIMAS, lote de ADVERTENCIAS y revisión/humanización del resto. **Cero duplicación, cero deps nuevas, gate intocable** (kit §0). El flujo normal no sabe que MASIVA existe salvo por 4 puntos aditivos (T3).

## §1 Commits (cada uno compila)

| Commit | Tarea | Contenido |
|---|---|---|
| `98ed5e8` | T1 | `masiva/tipos.ts` + `masiva/cola.ts` — IDB vanilla (DB `e14-masiva-v1`, store «archivos», cursor, `recuperarCola` anti-zombis) |
| `3946a02` | T3* | store principal SOLO aditivo: `Vista+="masiva"`, T5 extraído a `contarMotivoNoEnvioActa` (byte-idéntico), `registrarEnvioMasiva` (reutiliza `registrarEnvio` + `tituloDeActa` espejo A3), `abrirActaMasiva`+`masivaOrigen` |
| `8233103` | T2 | `masiva/runner.ts` (motor secuencial singleton, auto-pausa, thumb 320/JPEG 0.7, guard anti-zombis) + `masiva/store.ts` (mini-store: filas livianas, agregarFiles optimista, sincronizarAlVolver, enviarLote) |
| `f500c60` | T4 | `MasivaView.tsx` + `StitchStackIcon` + BottomNav (ítem MASIVA + regla de origen) + `page.tsx` |
| (docs) | §REG | worklog + AGENTS + D45 + ROADMAP + este REPORTE |

\* **Desviación de orden T2↔T3 documentada:** T2 depende de los tipos T3 para cumplir §8.1 «cada uno compila».

## §2 Desviaciones (todas documentadas en código)

1. **`thumb?: string` en `RegistroMasiva`** (aditivo al §3): la miniatura persiste para pintar la bandeja tras recargar; sigue durmiendo en IDB.
2. **Orden commits T1→T3→T2** (ver arriba).
3. **`registrarEnvio` gana parámetro opcional `actaEnvio?`:** para MASIVA archiva SU hueco y NO escribe hash en `actaActual` (kit T3.3 «NO toca actaActual»); sin el parámetro el flujo normal es byte-idéntico (verificado §3).
4. **Helper `paginaDeActa` en tipos.ts** (compartido runner/store — evita duplicar el "1/2 · -/-").
5. `archivo instanceof File` guard en el runner (IDB devuelve File clonado; el bridge espera `File` — A5).

## §3 Verificación §7 del kit (protocolo completo)

| # | Prueba | Resultado |
|---|---|---|
| 1 | lint · tsc · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 next build` | 0-0 · 0 · OK |
| 2 | **§7.2 IDENTIDAD** — mesa001.jpg por MASIVA vs IMPORTAR normal | **8.5 · ENVIADA(ÓPTIMA auto) · AUTO · PÁG 1 DE 2 · KIT 399·TRANSMISIÓN·1/2 IDÉNTICOS byte a byte** |
| 2b | §7.2 identidad mesa002.jpg (y re-proceso 2×) | 7.9 ADVERTENCIA exacto en todos los caminos |
| 3 | §7.3 lote real (3 fotos del dueño: buena + mesa2 + borrosa) | LISTA sin colgar UI · ENVIADA 8.5 AUTO + historial formato A3 («El Cairo - Consulado · MESA 1 — TRANSMISIÓN P1») · 7.9 ADVERTENCIA · 4.6 RECHAZADA/BAJO |
| 3b | §7.3 contador T5 | ÓPTIMA NO cuenta ✓ · `advertencia:piso-lectura-FUERTE:8.5 ×1` + `rechazo:bajo ×1` — MISMAS claves del flujo normal |
| 4 | §7.4 ABRIR → REVISIÓN → volver | REVISIÓN intacta (ENVIADO AUTOMÁTICAMENTE visible) · fila sincronizada · nav MASIVA activo/ESCANEAR no |
| 5 | §7.5 ENVIAR ADVERTENCIAS (1) | ENVIADA vía `registrarEnvio` real + historial |
| 6 | §7.6 recuperación (reload a mitad) | filas PROCESANDO→PENDIENTE (0 zombis) · PROCESAR termina todo |
| 7 | §7.7 RAM | por diseño (filas sin foto, thumbs ≤320px, cursor IDB uno-a-uno); medición fina con lote 100+ pendiente del dueño en SU equipo |
| 8 | §7.8 pausa | auto-pausa al ABRIR (el OCR en vuelo termina) + resume manual verificado |
| 9 | §7.9 responsive/nav | 375px usable · 1440px bandeja ancha · aria/roles/focus · touch ≥44px |
| 10 | §7.10 whitelist | `git diff main...feat --name-status` = EXACTO §1 (9 archivos producción) — zonas prohibidas 0 diffs |

**0 errores** en dev.log y consola del navegador durante TODA la sesión de pruebas. 12 capturas: `/home/z/my-project/public/humo-masiva-2026-10-19/`.

## §4 Rendimiento observado (sandbox dev)

~4-5 s/acta (Sandbox runner beefy; el equipo del dueño ≈15-18 s según AUDITORIA §2 → 100 actas ≈ 25-30 min, coherente con el kit §4). Secuencial verificado: las filas se resuelven en orden FIFO sin solapamientos.

## §5 Pendiente del dueño

1. Merge del PR DRAFT (orden del dueño).
2. §7.7 RAM con SU lote de 100+ fotos en SU equipo (DevTools Memory — heap plano esperado).
3. FUERA DE ALCANCE v1 (§9 del kit): export ZIP/CSV, concurrencia >1, re-intentos automáticos, OCR por zona, cola en la nube.
4. Con los datos del contador T5 acumulados (ahora también desde MASIVA), la calibración del piso AUTO queda para kit futuro con su firma.
