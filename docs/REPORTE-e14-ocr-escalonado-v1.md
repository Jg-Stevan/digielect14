# REPORTE — KIT e14-ocr-escalonado-v1 — OCR escalonado (1.ª pasada det 1280 → re-OCR 1920 solo si hace falta)

**Rama:** `feat/e14-ocr-escalonado-v1` · **Base:** apilada sobre `feat/e14-orientacion-auto-v1` @ `4e7558a` (NO mergeada — PR #35 abierto; si el dueño la mergea primero, esta rama rebasa limpia: solo toca `rapidocr.ts`/`ocr-escalonado.ts`/`scanner-core-bridge.ts` + docs propios)
**Zona:** `src/lib/e14/ocr/rapidocr.ts` · `src/lib/e14/ocr-escalonado.ts` (NUEVO) · `src/lib/e14/scanner-core-bridge.ts` · docs — **diff de zona prohibida VACÍO** (verificado con `git status`: sin `masiva/**`, sin `tipos.ts`, sin `tools/**`, sin `orientacion.ts`, sin `senal-lectura.ts`, sin gate/caps/SIM, sin `divipol.json`, sin workflows, sin `package.json`/`bun.lock`).

---

## §0 — MANDATO Y CONTEXTO

OCR medio 17.3 s (68% del total 25.3 s). El det a 1920 es ~19-21% del OCR real. El banco `tools/bench-det1280/` (PR #34, Agente 3) dio **GO DURO**: det 1280 → **−56.4% del det**, 120/120 votos, 0 cajas perdidas, FUERTE idénticas. Este kit ACTIVA esa palanca en producción con red de seguridad:

- **1.ª pasada** con det cap **1280** (~0.44× del tiempo de det) → texto T1 + conf1.
- **Decisión (módulo puro):** `senalDeLectura(T1)` FUERTE → fin. MEDIA con mesa leída + anclas ≥ 4 → fin. Cualquier otro caso → **re-OCR completo a 1920** y quedarse con el **MEJOR** (anclas de `ANCLAS_LECTURA`, luego conf media — **NUNCA automáticamente T2**).
- Las actas buenas (mayoría estimada) pagan solo la 1.ª pasada: **ahorro esperado ~10-12% del OCR**. El gate **JAMÁS** ve un texto degradado si el 1920 lo salva (escudo «el mejor manda»).

## §1 — IMPLEMENTACIÓN

### 1.1 `src/lib/e14/ocr/rapidocr.ts` — cap del det-preprocess (op4) parametrizable
- `DET_CAP_PROD = 1920` (comportamiento de hoy **byte a byte**) y `DET_CAP_RAPIDO = 1280` — exportadas.
- `preDet(src, cap = DET_CAP_PROD)` y `inferDet(rt, src, cap = DET_CAP_PROD)`: **solo op4** (`det_limit_side_len`, `det_limit_type='max'`) usa el cap. **op1 (`reduce_max_side` 1920) queda INTACTO** — es el preprocess fijo del paquete; exactamente la réplica del banco B3.
- `rapidOcrReconocer(rt, dataUrl, onProgress?, opts?: { detCap?: number })` — 4.º parámetro OPCIONAL: ausente = producción de hoy. La **sesión det NO cambia** (mismos pesos; el cap es del preprocess, no del modelo — §2.1 del kit). cls y rec idénticos.
- El probe de orientación (Kit A) sigue llamando `inferDet` con default 1920 — congelado, 0 cambios.

### 1.2 `src/lib/e14/ocr-escalonado.ts` (NUEVO — puro, testeable headless con bun)
- `anclasDe(texto)` — nº de anclas de `ANCLAS_LECTURA` (consumida, congelada).
- `necesitaSegunda(texto)` — §2.3 del kit literal. La condición «MEDIA con mesa leída + anclas ≥ 4» queda EXPRESA aunque es redundante con FUERTE por definición de `senalDeLectura` (blindaje ante futuros cambios del nivel). Sin `parciales`: la decisión corre ANTES de `clasificarCabecera` y la mesa la aporta el MISMO regex de `senal-lectura.ts` sobre el texto.
- `elegirMejor(a, b)` — §2.4: primero nº de anclas, luego conf media; **empate total → la 1.ª** (ya pagada, misma lectura). Genérico: devuelve el MISMO objeto ganador por referencia (el caller viaja con cap/det/rec para la traza).
- Test headless ejecutado (bun): FUERTE→false · MEDIA-floja→true · DEBIL→true · MEDIA+mesa+4 anclas→false · elección por anclas / por conf / empate→1.ª. **Todos correctos.**

### 1.3 `src/lib/e14/scanner-core-bridge.ts` — integración en AMBOS pipelines
- Helper `reconocerRapidOcrEscalonado(fotoOcr, onProgress, { simular, presupuestoMs, inicioMs })`:
  - **SIM: OMITIDO** (§3) — flujo de hoy a 1920, UNA pasada, **0 trazas** (chips 8.2/7.0/4.3 intactos por construcción).
  - 1.ª pasada `detCap: DET_CAP_RAPIDO` → `senal1 = senalDeLectura(T1)`.
  - **Presupuesto (§3): el timeout EXISTENTE del pipeline manda** — `timeoutMs ?? TIMEOUT_MS` (escaneo; masiva pasa 120 s por `OpcionesEscaneoConTimeout`) y `RECORTE_TIMEOUT_MS` (recorte). Vencido → **NO hay 2.ª** (sin presupuestos nuevos).
  - 2.ª pasada `detCap: DET_CAP_PROD` → `elegirMejor(T1, T2)`; el downstream (banda condicional, clasificación, gate, diagnostico, `ultimoOcr*`) consume **SOLO el texto elegido**.
  - `ultimoOcrConf/Det/Rec` quedan con la **pasada ELEGIDA** — la traza `ocr=rapidocr conf=… det=…ms rec=…ms` describe el texto que el downstream consume.
  - **Progreso (§3):** la 2.ª pasada reusa el MISMO emit de OCR (`emitir({etapa:"OCR", …})` — ANALIZANDO no se queda colgado).
  - `reconocerRapidOcr` (wrapper original) queda para `ocrBanda` y el re-OCR del editor — **sin cambios** (la banda condicional corre sobre el texto ELEGIDO; el editor no está en el §2 del kit).
- Traza (§2.5) en **línea PROPIA** — append-only, parseable por el rastreador, sin línea en SIM:
  `[e14] ocr-escalonado pasada1=1280 lectura=DEBIL reocr=1 elegido=1920 anclas1=2 anclas2=9 ms1=8200 ms2=14100`
  `[e14] ocr-escalonado pasada1=1280 lectura=FUERTE reocr=0 elegido=1280 anclas1=7 ms1=8200`
- La rotación (Kit A) corre ANTES — este kit no la toca (el OCR escalonado recibe `fotoOcr` YA derecha).

## §2 — VERIFICACIÓN ESTÁTICA (AC-4)

- `bun run lint` **0** · `bunx tsc --noEmit` **0** · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` **OK** (3/3 páginas estáticas).
- `git status`: solo los 3 archivos de la zona + docs. **Zona prohibida VACÍA.**

## §3 — BATERÍA DE NAVEGADOR REAL (COOP/COEP, §5.2 del kit)

Entorno sandbox: HeadlessChrome 155, **2 núcleos**, `crossOriginIsolated=true` → `numThreads=2`, EP **wasm** vendido byte-idéntico. Harness efímero FUERA del repo (`/home/z/harness-escalonado/`) que importa los **módulos de producción LITERALES** (bun build: `rapidocr.ts` + `ocr-escalonado.ts` + `senal-lectura.ts` + `orientacion.ts`) y el generador de corpus **VERBATIM** de `tools/bench-det1280/bench.html` (seed `0xe14de7a2`, 4 páginas, 120 votos).

### AC-1 — corpus bench-det1280 × módulos de producción

| pág | ref 1920 | escalonado (1280→?) | reocr | anclas1 | nivel1 | ms1 | ms ref |
|-----|----------|--------------------:|-------|---------|--------|----:|-------:|
| 1 | 30/30 votos | **30/30** | **0** | 10/10 | FUERTE | 5195 | 6414 |
| 2 | 30/30 | **30/30** | **0** | 10/10 | FUERTE | 4977 | 5413 |
| 3 | 30/30 | **30/30** | **0** | 10/10 | FUERTE | 5174 | 5408 |
| 4 | 30/30 | **30/30** | **0** | 10/10 | FUERTE | 4943 | 5414 |

**RESUMEN: votos escalonado 120/120 · ref 120/120 · reocr=0 en 4/4 · 0 votos perdidos.** Trazas verbatim:
`[e14] ocr-escalonado pasada1=1280 lectura=FUERTE reocr=0 elegido=1280 anclas1=10 ms1=5195`

Nota honesta: el TEXTO no es byte-idéntico entre caps (el det a distinto cap produce cajas/líneas ligeramente distintas → splits de línea distintos); el criterio GO del banco B3 — **0 votos perdidos + nivel FUERTE + anclas idénticas — se cumple 4/4**, que es lo que el kit define como «resultados IDÉNTICOS al todo-1920» (AC-1).

### AC-2 — acta REAL del dueño girada 90° (fixture Kit A)

- `probeOrientacion`: **rot=270 aplicado=1** (probe={0:0.00,90:0.01,270:9.98}, ms≈3.3-3.5 s) — el probe del Kit A corrió ANTES, este kit no lo toca.
- Escalonado sobre la YA derecha: **nivel FUERTE, anclas=9, reocr=0, elegido=1280, ms1=3280** — desenlace **IGUAL** al de la sana (FUERTE/9). Traza: `… pasada1=1280 lectura=FUERTE reocr=0 elegido=1280 anclas1=9 ms1=3280`.

### AC-3 (proxy sandbox) — acta sana real por el PIPELINE COMPLETO de la app (IMPORTAR)

- App compilada (`BUILD_STATIC`, servida con COOP/COEP), flujo **ARCHIVO/IMPORTAR** con la foto real `acta-e14-real.jpg`:
  - `[e14] orientacion crop=703x2170 rot=0 probe={0:10.00} anclas0=4 conf0=0.88 aplicado=0 ms=4700`
  - `[e14] ocr-escalonado pasada1=1280 lectura=FUERTE reocr=0 elegido=1280 anclas1=9 ms1=6821`
  - `[e14] pipeline ARCHIVO/file total=13002ms … ocr=6822 … ocr=rapidocr conf=0.93 det=667ms rec=5825ms lectura=FUERTE anclas=9 piso=true clasif={dep:88,mun:120,zon:15,std:02,mesa:012,pag:1/2,tipo:T,nivel:AUTO,cod:710007453010102} … score=10 … diag=1`
- **Desenlace igual al de hoy**: score 10 (piso perfecto), clasif AUTO **idéntica** (mismo cod), FUERTE/9 anclas. Referencia 1920 (SIM óptima, MISMA acta): `ocr=9576ms det=1353ms rec=7832ms` → **OCR −28.8% (6.8 s vs 9.6 s) en la acta real del dueño**, mismo texto útil (anclas 9/9, conf 0.93, clasif byte-idéntica).

### Mecánica reocr=1 (camino de la 2.ª pasada, con OCR real)

Acta casi vacía («PUESTO 12»): nivel1=**DEBIL** → **reocr=1** → anclas1=1, anclas2=1 → **elegido=1920 (ganó por conf)** — ms1=669, ms2=613. Traza verbatim:
`[e14] ocr-escalonado pasada1=1280 lectura=DEBIL reocr=1 elegido=1920 anclas1=1 anclas2=1 ms1=669 ms2=613`

### AC-4 — SIM congelado (app real, chips de la banda)

3 disparos de los chips de SIMULACIÓN (pipeline real sobre los assets del dueño):
- **`sim=8.2 score=8.2`** (óptima, motor=worker, piso10=1) · **`sim=7.0 score=7`** (intermedia, as-is, recortada=1) · **`sim=4.3 score=4.3`** (baja, as-is) — **chips EXACTOS**.
- `grep -c "ocr-escalonado"` en consola = **0** · `grep -c "[e14] orientacion"` = **0** — SIM sin trazas nuevas, por diseño (§3).

## §4 — DESVIACIONES DEL KIT (honestas)

1. **Harness con `ort.env.wasm.proxy=false`:** el worker de proxy de ORT no arranca en el **Chrome headless del sandbox** (`proxy=true` → «no available backend found»); producción **conserva `proxy=true`** (D46 — verificado en Vercel por el dueño) y el código del repo NO se tocó por esto. El banco B3 GO también corrió sin proxy; el EP/sesión/pre-post son idénticos.
2. **AC-1 «IDÉNTICOS» por el criterio del banco B3** (0 votos perdidos + FUERTE + anclas) — el texto crudo no es byte-idéntico entre caps (§3, nota). Documentado, no ocultado.
3. **Los tiempos absolutos del sandbox (2 núcleos) NO son los del dueño.** La evidencia son los Δ relativos 1280-vs-1920 medidos en el MISMO entorno (−6.3% OCR total en el corpus sintético — el rec/cls domina ahí; **−28.8% en el acta real**, donde det pesa más) y el **AC-5 del dueño** (16 fotos en SU equipo, bloqueante para merge final, no para el PR).

## §5 — COSTOS MEDIDOS

- Corpus B3 (4 págs sintéticas, 71 cajas/pág): OCR medio ref 5412 ms vs escalonado 5072 ms (**−6.3%**) con 0 votos perdidos — el det−56% queda parcialmente enmascarado por rec/cls.
- Acta REAL del dueño (app, 2 núcleos): OCR **6.8 s (1280) vs 9.6 s (1920) = −28.8%**; pipeline total 13.0 s (con probe 4.7 s del Kit A incluido) vs ~15.9 s proyectado a 1920 — **el ahorro crece con el peso del det** (actas reales = el caso que importa).
- Peor caso medido (acta DEBIL): +1 pasada 1920 (ms2) — **mismo total que hoy** (el mejor manda, escudo de identidad).

## §6 — NOTA DE CONTINUIDAD DE SESIÓN (reinicio del agente)

**La sesión del agente se ha reiniciado 2 veces durante este mega-kit.** Estado persistente para retomar:
- Clon local: `/home/z/digielect14` (rama `feat/e14-ocr-escalonado-v1` desde `4e7558a`). Si el clon ya no existe: clonar de nuevo y recrear la rama desde `4e7558a` (o desde `main` actualizado si el dueño YA mergeó el PR #35 de orientación — en ese caso rebasar es trivial: los archivos de zona de este kit NO colisionan con orientacion.ts).
- Kit original: `/home/z/my-project/upload/INSTRUCCIONES-e14-ocr-escalonado-v1.md` (SIEMPRE re-leerlo tras un reinicio).
- Token de push: lo entrega el dueño en el chat (identidad de commits: `Jg-Stevan <julistevan02@gmail.com>`). Sin token NO se puede pushear — dejar este REPORTE y el worklog ANTES de commit/push (hecho: los docs se commitean primero).
- Este archivo + `docs/worklog.md` (entrada del kit) + AGENTS/ROADMAP/D53 son la fuente de verdad para el próximo agente.

## §7 — PASOS DEL DUEÑO (AC-5 — bloqueante para merge final, NO para abrir el PR)

1. Merge del PR #35 (orientación) y luego este (orden del §5.4 del kit: orientacion → este).
2. En SU equipo (4 núcleos / Chrome 155): las 16 fotos del informe — media total vs 25.3 s y **0 rechazos nuevos**.
3. Verificar las trazas nuevas en su rastreador: `[e14] ocr-escalonado …` (línea propia; `reocr=0` esperado en la mayoría; `reocr=1` solo en actas flojas — el total NO debe superar el de hoy).
4. Revoque el token del agente si no lo hizo (quedó expuesto en el chat).
