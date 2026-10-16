# REPORTE PARA AUDITORÍA — KIT e14-actas-resumen-puesto-v2 (puesto real + modo simulación)

**Rama:** `feat/actas-resumen-puesto` · **Base:** `main` @ `2383820` (merge del PR #3 gate-v2 — requisito bloqueante cumplido) · **Fecha:** 2026-10-15 (Bogotá)
**Estado:** ⏳ ABIERTO PARA AUDITORÍA DEL DUEÑO — **NO MERGEADO** (regla dura del kit).
Ejecutado por Z.ai Code siguiendo `INSTRUCCIONES-e14-actas-resumen-puesto-v2` (supersede de la v1 — añade el MODO SIMULACIÓN pedido por el dueño).

---

## 1. Resumen del cambio

| # | Qué se hizo | Archivos |
|---|---|---|
| 1.1 | `claveDePuesto(c)`: prefijo «dep-mun-zon-std» de la clave de mesa (mismos anchos con ceros) — filtra `archivadas` por puesto sin parsear códigos | `clasificador.ts` |
| 1.2 | `mesasDePuesto(base, dep, mun, zon, std)`: countTable «t» del puesto por ruta completa (padStart defensivo 2/3/2/2); null si la ruta no existe → degradación | `divipol.ts` |
| 1.3 | `PUESTO_SIMULADO` (seed §6.4): clave placeholder «88-000-10-02», «ROMA - CONSULADO / CONSULADOS / ITALIA / ZONA 10 / PUESTO 02» — SOLO display, jamás se escribe en estado | `seed.ts` |
| 1.4 | `PuestoActual` (interfaz nueva) + estado `puestoActual`/`modoSimulacion` + acción `alternarModoSimulacion`; `archivarHueco` devuelve el `puesto` de la clasificación (regla del dueño: la ÚLTIMA archivada manda) capturado en `registrarEnvio` (archivo AUTO) y `guardarUbicacion` (la corrección del panel TAMBIÉN manda) | `store.ts` |
| 1.5 | REESCRITA de ACTAS: puesto REAL + ruta + «· N MESAS» (countTable DIVIPOL), acordeón 1..N (PENDIENTE lo no archivado), toggle «SIM», píldora EN LÍNEA, estado vacío honesto. FUERA: alerta «N MESAS INCOMPLETAS + MESA 0X», seed suelto, `mesasReales`/`todas`/`incompletas`/`detalleIncompletas` y `WarnTriangleIcon` | `ActasView.tsx` |
| 1.6 | RESUMEN: bloque «Puesto actual» muestra el MISMO puesto que ACTAS (`puestoReal ?? (modoSimulacion ? PUESTO_SIMULADO : null)`) con línea de ruta. Progreso/historial: SIN CAMBIOS (pendiente del dueño §3 del kit) | `ResumenView.tsx` |

## 2. Decisiones APLICADAS (revertibles por el dueño)

- **D1** Alerta completa fuera de ACTAS (el «N EN COLA» sigue en RESUMEN — sin cambios).
- **D2** Seed demo fuera del flujo real de ACTAS; el acordeón real lista 1..countTable con PENDIENTE lo no escaneado.
- **D3** MODO SIMULACIÓN = toggle «SIM» en ACTAS, no atado a la fuente de captura. Solo llena cuando NO hay puesto real: jamás falsifica datos de un puesto ya escaneado (lo real manda con SIM ON — AC3).
- **D4** Sin puesto → estado vacío honesto («SIN PUESTO / ESCANEA UN ACTA…»); nada inventado.
- **D5** Acordeón arranca cerrado (antes abría MESA 01).
- **D6** Simulación = overlay de VISTA: `modoSimulacion` es un boolean del store; `PUESTO_SIMULADO` y `mesasIniciales()` se derivan SOLO en render. Verificable: `PUESTO_SIMULADO` no aparece en ninguna acción del store (grep en §5) — `archivadas`/`puestoActual` quedan limpios.

## 3. Detalle de implementación (para el veredicto del auditor)

1. **Puesto actual** — `archivarHueco` calcula `claveDePuesto` y devuelve `puesto` (título = `puesto.nombre` en MAYÚSCULAS, convención de `tituloYUbicacionDe`; ruta = nombres de dep/mun + códigos de zona/puesto). Sus 3 `return` lo incluyen; sin clave/tipo/prefijo → `puesto: null` (el llamador conserva el puesto anterior). Capturas: (a) `registrarEnvio` cuando `clasificacion.nivel === "AUTO"` (gate), (b) `guardarUbicacion` (panel, AUTO-manual) — en ambos: `puestoActual: puestoNuevo ?? get().puestoActual`.
2. **Acordeón del puesto** — filtra `archivadas` por prefijo `«dep-mun-zon-std»-`, numera y construye 1..countTable (`MESA 01…N`, PENDIENTE lo no archivado) + defensivamente las archivadas fuera de rango (si la base cambió o countTable=null). Estado de mesa: 0 ocupadas → PENDIENTE · todas → COMPLETADA · resto → EN_PROCESO (chips de página intactos).
3. **countTable** — `useEffect` consulta `cargarDivipol()` (caché de módulo → instantáneo) y `mesasDePuesto`; `totalMesas` null (base vacía/falló) → degrada a solo las archivadas del puesto, sin crash (AC7). En simulación: fija 3.
4. **Ids de mesa** — las tarjetas vuelven al id corto «MESA 01» del mock (la clave DIVIPOL completa ya no es visible; sigue siendo la clave interna de `archivadas`). La tarjeta de Fase B usaba `standName · MESA {n}` — el nuevo formato respeta el mock §6.4 que el dueño pidió con el modo simulación.
5. **`mesas` del store intacto** — el seed `mesas` NO se borra (ScanView lo usa para el objetivo de página); ACTAS simplemente ya no lo mezcla.

## 4. Criterios de aceptación (QA) — verificados en estático/headless

| # | Criterio | Estado |
|---|---|---|
| 1 | Arranque limpio: «SIN PUESTO / ESCANEA UN ACTA…» + píldoras SIM y EN LÍNEA funcionales; cero MESA 01/02/03, cero alerta roja | ✓ código (estado inicial `puestoActual: null, modoSimulacion: false`; mesasMostradas=[] → estado vacío; alerta eliminada) |
| 2 | SIM ON (sin escaneos) → «ROMA - CONSULADO / ITALIA > ZONA 10 > PUESTO 02 · 3 MESAS» + MESA 01 COMPLETADA 100% / 02 EN PROCESO 50% / 03 PENDIENTE 0%; SIM OFF → estado vacío | ✓ código (`mesasIniciales()` del seed §6.4 exacto al mock; enSimulacion = `!puestoReal && modoSimulacion`) |
| 3 | Escaneo real → puesto real + ruta + «· N MESAS» = countTable; acordeón 1..N con la escaneada OK y el resto PENDIENTE; **aunque SIM esté ON, lo real manda** | ✓ código (`puestoReal ?? …` en ambas vistas; enSimulacion exige `!puestoReal`) |
| 4 | Escanear OTRO puesto → todo cambia al nuevo; solo un puesto en pantalla; el anterior no se pierde (sigue en `archivadas`) | ✓ código (`archivarHueco` devuelve el puesto de CADA archivada → `puestoActual` se reemplaza; acordeón filtra por prefijo) |
| 5 | Alerta «MESAS INCOMPLETAS» ausente siempre | ✓ (bloque y `WarnTriangleIcon` eliminados del archivo) |
| 6 | RESUMEN muestra el mismo puesto (real o simulado) que ACTAS en todo momento | ✓ código (misma expresión derivada) |
| 7 | Sin base DIVIPOL → degrada a solo las mesas archivadas del puesto, sin crash | ✓ código (`totalMesas === null` → fallback `[...porNumero.keys()]`) |
| 8 | `bun run lint` + `bunx tsc --noEmit` limpios; **cero cambios** en scanner-core/npm/web-scanner/worker | ✓ EN VIVO: lint 0 · tsc 0 · `git status` = 6 archivos de `src/` (3 lib + 2 vistas + 0 de packages/) |
| 9 | Demo Pages: SIM ON llena el puesto para screenshots; escanear 1 acta SIM la reemplaza por datos reales | ✓ código (las actas SIM clasifican contra DIVIPOL real — bridge L571/L811 → archivan AUTO → puesto real sustituye al demo) |

Verificación en vivo con teléfono real (resolución de cámara, DIVIPOL de puestos grandes) queda para el dueño — mismo criterio que gate-v2.

## 5. Evidencia de verificación (comandos)

```
$ bunx tsc --noEmit            → 0 errores
$ bun run lint                 → 0 errores (eslint .)
$ git status --short           → M ActasView.tsx · M ResumenView.tsx ·
                                 M clasificador.ts · M divipol.ts · M seed.ts · M store.ts
$ rg "PUESTO_SIMULADO" src/lib/e14/store.ts        → 0 matches (D6: overlay de vista)
$ rg "WarnTriangleIcon|MESAS INCOMPLETAS" src/components/e14/screens/ActasView.tsx
                               → 0 matches (D1)
$ rg "ROMA - CONSULADO" src/components/e14/screens/   → 0 matches hardcodeado (venía del store/seed)
```

## 6. Pendiente de decisión del dueño (NO tocado en este kit)

- RESUMEN: «PROGRESO DEL PUESTO» (12/9) e historial siguen demo — kit aparte si los quiere derivados reales.
