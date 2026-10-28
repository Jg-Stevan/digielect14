# REPORTE — refactor/runner-logger-v1 (SPRINT-C · AGENTE 3 · PIPELINE MASIVO E HIGIENE)

> Branch: `refactor/runner-logger-v1` (base: `origin/main` @ `10209b7`, PR #90).
> Alcance EXCLUSIVO: `src/lib/e14/masiva/{runner.ts,runner-*.ts,store.ts,precalor.ts,cola.ts,historico.ts,relectura.ts,tope.ts}`, `src/lib/e14/{store.ts,informe.ts}` y borrados knip en `clasificador/jornada/kits/marcadores`. Cero toques en `components/**`, `image-utils`, `ocr/**`, `scanner-core-bridge.ts`, `types.ts`, `scripts/**`, `package.json`, configs y `logger.ts`.

---

## 1 · Árbol del runner — antes / después

### Antes (1 archivo)
| Archivo | Líneas |
|---|---|
| `masiva/runner.ts` | **1,756** |

### Después (1 orquestador + 4 módulos de responsabilidad)
| Archivo | Líneas | Responsabilidad extraída (C1, movimiento puro) |
|---|---|---|
| `masiva/runner.ts` | **1,415** | Orquestador: capa-0 QR, bucle watchdog, capa-2, envío, persistencia, pool |
| `masiva/runner-vida.ts` | 143 | Instrumentación del progreso (D65 T3 / e71 Opt-3): `%` global MONOTÓNICO (`FRAC_*`), `VidaFila`/`vidas`/`vidaDe`, `fracGlobalDe`, `bucketDeVida`, `marcarVida`, patch inmutable `marcarFila` |
| `masiva/runner-watchdog.ts` | 162 | Infra D65: carrera `correrIntento`+`DesenlaceIntento`, `esVeredictoTimeout`, `matarYRecrearWorkers`, `actaTimeoutWatchdog`, `etapaDeSenal`, espejo `DETALLE_TIMEOUT` |
| `masiva/runner-dedup.ts` | 74 | Guard de ingesta × pool (e72): `esperarDesenlaceOriginal` + `ESPERA_ORIGINAL_*` |
| `masiva/runner-thumbs.ts` | 38 | `hacerThumb` (render canvas de la bandeja; `masiva/store.ts` lo consume — import actualizado) |

Reglas respetadas: bloques movidos TAL CUAL (sin renombrar internos, sin cambiar orden de efectos), imports UNIDIRECIONALES (`runner.ts` importa de `runner-*.ts`; los `runner-*.ts` jamás se importan entre sí).

### Desviación documentada — runner.ts quedó en 1,415 (> 1,000 del criterio C1)
La meta `<1,000` es incompatible con el protocolo de anclas del mismo prompt. `procesarUno` + los helpers de dedup concentran ~1,050 líneas y contienen las líneas que los QA grepean **en `runner.ts`** (movimientos verificados con `grep -rn <símbolo> scripts/` antes de cada decisión):

| Ancla (QA que la grepea) | Por qué no puede salir |
|---|---|
| `async function conExclusionMutua<` + `let mutexDedup…` + `conExclusionMutua` ×≥4 (qa-dedup-enviadas.ts:382-384) | El mutex y su def deben vivir en el orquestador |
| `return conExclusionMutua(() => reutilizarResultadoCritica(fila, t0));` (qa-dedup-enviadas.ts:390) | El wrapper de copia de desenlace |
| `const originalEnviada = actaCopia.status === "ENVIADA"…` + `actaCopia.enviadoAutomaticamente = null;` (qa-historico-enviadas.ts:255-256) | El CUERPO de `reutilizarResultadoCritica` |
| `const archivoPipeline = archivo;` con orden `iReg < iQr < iFor` + bloque capa-0 completo entre anclas + 4 spreads `...(qrPayload ? { qrPayload } : {})` (qa-qr-identidad.ts:353-357, 416) | `procesarUno` completo (capa-0 + capa-2 + e72 + LISTA/ERROR) |
| `void registrarEnviadaHistorico({…}).catch(() => {});` byte-idéntico + orden `enviadaPorPayload`→`registrarQrPayload` (qa-historico-enviadas.ts:228-289) | Bloque de envío T-3a |
| `WATCHDOG_MS/INTENTOS/GRACIA_MS` + `RELECTURA_TOPE_MS` (qa-watchdog-relectura.ts:115-127; qa-qr-identidad.ts:521-526) | Constantes del watchdog |
| Bloque relectura con `conTope(` ×EXACTAMENTE 1 + `console.info(` literal en el bloque (qa-watchdog-relectura.ts:197-203) | Bloque e63g completo |
| `bucle` (Promise.race/all), `iniciar/pausar/rearrancar`, `siguientePendiente` (pool/reservadas) | Orquestación del pool |

Extraer sub-bloques internos de `procesarUno` habría exigido re-estructurar variables locales (`fila`, `registro`, closures con narrowing) — eso rompe «movimiento puro» y arriesga diffs de comportamiento. Decisión: split honesto hasta el límite que las anclas imponen; **los 7 QA dan igual antes que después** (294/294 checks).

## 2 · Observabilidad (C2) — console → logger

| Archivo | Antes | Migradas | Restantes |
|---|---|---|---|
| `masiva/runner.ts` | 25 | 24 → `logger.info` | **1** (excepción, abajo) |
| `masiva/runner-dedup.ts` | 2 | 2 → `logger.info` | 0 |
| `masiva/store.ts` | 8 | 8 → `logger.info` | 0 |
| `store.ts` (raíz) | 5 | 3 `logger.info` + 2 `logger.error` | 0 |
| `masiva/precalor.ts` | 1 | 1 → `logger.info` | 0 |
| **Total zona** | **41** | **40** | **1** |

**Excepción (ancla > estética):** la traza de relectura-interna (`runner.ts`, token `RelecturaInterna=`) permanece en `console.info` — `qa-watchdog-relectura.ts:202` exige literalmente `console.info(` dentro del bloque relectura. Comentario en situ explica la excepción. Mensajes byte-idénticos; `debug/info` solo dev (el logger gatea por NODE_ENV), `warn/error` siempre.

## 3 · Knip (C3) — antes / después

| | Antes | Después |
|---|---|---|
| Total repo | 37 ítems (14 exports + 23 tipos) | **24** (10 + 14) |
| Zona AGENTE-3 | 14 ítems | **0 pendientes** (13 resueltos + 1 conservado por ancla) |

Resolución por ítem (protocolo: `grep -rn <símbolo> src/ scripts/ docs/` antes de decidir):
- **De-export** (uso SOLO interno): `normalizarCodigo`, `NivelClasificacion`, `CodigoUnicoE14` (clasificador) · `EstadoJornada` (jornada) · `RegistroKit` (kits) · `MarcadoresResult` (marcadores) · `PRECALOR_COLA` (precalor) · `ProgresoFila` (masiva/store) · `ResultadoTope` (tope) · `SCORE_SIMULADO`, `OpcionesSimEscaneo`, `HuecoArchivado` (store).
- **Borrado** (cero usos): `filaPrecalentada()` (masiva/precalor).
- **Conservado con comentario** (ancla QA): `ViaYaEnviada` — `qa-historico-enviadas.ts:183` grepea el export byte-idéntico (D57: «payload» NUEVO AL FINAL).
- `informe.ts`: sin residuos vigentes (`resumenColgadas` ya resuelto en #89).
- NO tocados (otros agentes): identidad-qr/dedup/archivos/identidad/bridge/ocr/orientacion/senal-lectura/completitud/ocr-escalonado (Agente 1) y `components/**` (Agente 2).

## 4 · Tests (C4) — partes puras del split

`src/lib/e14/masiva/runner-watchdog.test.ts` (NUEVO, 17 tests; patrón `completitud.test.ts`: entorno node + `vi.mock` de worker/OCR): `etapaDeSenal` (6) · `esVeredictoTimeout` (4) · `actaTimeoutWatchdog` (2) · `correrIntento` tríada con fake timers + cero fuga de timer (3) · `matarYRecrearWorkers` jamás lanza (2). Suite total: **53 → 70**. Fuera de alcance (IDB/bridge reales → QA de regresión): pool, mutex, capa-0.

## 5 · Gate íntegro (íntegro y en orden)

```
bunx tsc --noEmit      → 0 errores
bun run lint           → 0 errores (4 warnings PREVIOS en zona de otros agentes: MasivaView×2, ScanView, logger.ts — verificados presentes en main)
bun run test           → 70/70 (3 archivos previos + runner-watchdog.test.ts)
for f in scripts/qa-*.ts → 7/7 OK (294 checks): autoenvío 33/33 · dedup-enviadas 50/50 · escaneo-ya-recortado 24/24 · historico-enviadas 49/49 · identidad-acta 32/32 · qr-identidad 72/72 · watchdog-relectura 34/34
bun run build          → exit 0 (✓ Compiled successfully)
```

## 6 · Commits

| Commit | Contenido |
|---|---|
| `refactor(masiva): runner split por responsabilidad (C1 — movimiento puro)` | split + import de `hacerThumb` en masiva/store |
| `chore(observabilidad): console → logger en la zona masiva (C2)` | 40 llamadas migradas + 1 excepción documentada |
| `chore(knip): protocolo de borrado en la zona masiva (C3)` | 12 de-exports + 1 borrado + 1 ancla comentada |
| `test(masiva): unit tests de las partes puras del split (C4)` | 17 tests nuevos (53→70) |

## 7 · Decisiones y desviaciones (resumen ejecutivo)

1. **runner.ts 1,415 líneas, no <1,000** — las anclas QA sobre `runner.ts` (§1) lo impiden sin romper el gate o dejar de mover en bloque. Documentado ítem por ítem; es el insumo del PR de integración si el dueño decide re-negociar anclas.
2. **`conExclusionMutua`/`reutilizarResultado*` NO salieron a runner-dedup.ts** pese al listado nominal del prompt — `qa-dedup-enviadas.ts` y `qa-historico-enviadas.ts` grepean sus líneas dentro de `runner.ts`. Se movió `esperarDesenlaceOriginal` (0 anclas, verificado).
3. **4.º archivo `runner-vida.ts`** — el patrón `runner-*.ts` lo admite y aísla la responsabilidad de progreso (0 anclas, verificado símbolo por símbolo).
4. **`console.info` de relectura permanece** — ancla literal del QA (§2).
5. **`masiva/store.ts` importa `hacerThumb` desde `./runner-thumbs`** — un solo sitio de consumo afectado; la superficie pública del runner queda limpia.
6. Ninguna necesidad de tocar `types.ts` ni archivos fuera de zona: **nada que escalar al PR de integración**.
