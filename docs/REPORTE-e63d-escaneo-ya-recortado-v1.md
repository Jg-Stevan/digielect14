# REPORTE-e63d-escaneo-ya-recortado-v1 — el escaneo ceñido es un escaneo (F0+F1+F2+F3)

**Task ID e63d** · ejecutado por Z.ai Code · plan `PLAN-e63d-escaneo-ya-recortado-v1.md` (dueño, 2026-10-21) · **rama `feat/e63d-escaneo-ya-recortado-v1`** desde `origin/main @ a742953` (merge #63 D63-A2).

**Estado: F0/F1/F2/F3 IMPLEMENTADAS + gates locales verdes + humo puro 22/22. La validación end-to-end con la cola real (zip `e14-informe-20261021-091545`, F4/Fase D) es del DUEÑO — el zip no está en esta máquina.**

---

## 0. Diagnóstico del plan — VERIFICADO línea a línea (todas las citas existían)

| Cita del plan | Verificación |
|---|---|
| Fallo A: rescate D63-C solo cuando cae a Sobel (`bridge` L1131) | ✓ `if (origenActa === "escaneo" && quadOrigen === "sobel")` — el quad del worker se aceptaba sin cuestionar |
| Fallo B: `completa = veredicto === "cortado" ? false : true` (L1435) | ✓ literal; `senal` L1368 y `faltaSeccion` L1357 ya calculadas antes (cero costo del perdón) |
| Fallo B: marco inset descarta líneas 0–5px (`marco-escaneo.ts`, `INSET_MIN_PX=5`) | ✓ literal |
| Fallo C: guard ratio 0.58–0.87 (`origen.ts`) | ✓ literal — el E-14 real (~0.31) cae fuera |
| Guard SIM doble (`origenActa` solo MASIVA + `!opciones.simular` en el marco) | ✓ L1082 + L1433 — SIM jamás trae origen ni corre marco |
| `evaluarMarcoImpreso` JAMÁS devuelve null (L169: fallo → `no-encontrado`) | ✓ — confirma F2.3: la `completa` del guard de fotos se descartaba SIEMPRE para escaneos |
| Informe DETECCION ya cuenta `pagina-completa` (D63-C) | ✓ `informe.ts` L645-649/L697 — el contador de F2 sale gratis |

## 1. Lo implementado

### F0 — hotfix en `scanner-core-bridge.ts`
- **(F0.1)** Rescate generalizado: `if (origenActa === "escaneo")` → `QUAD_IDENTITY` + `quadOrigen="pagina-completa"` (antes solo cuando caía a Sobel). Con F2.1 es camino muerto para escaneos — queda como **defensa en profundidad** (si la detección volviera a correr para un escaneo, el desenlace sigue siendo página completa).
- **(F0.2)** La LECTURA perdona al marco: `cortado` condena SOLO si NO hay `senal.nivel === "FUERTE"` o hay `faltaSeccion` (mismo patrón que `lazoPerdonadoPorLectura`). `ceñido`/`completo`/`no-encontrado` no bloquean. Honestidad intacta: sin SUMA TOTAL/FIRMAS el perdón NO aplica.

### F1 — `masiva/origen.ts`: reconocer escaneos ceñidos sueltos
- **(F1.1)** Señal PURA `tintaAlFiloSimetrica(bitmap)`: franja exterior ~1.5% por lado; lado = **MIXTO** (tinta luma<150 ≥25% **Y** papel luma≥200 ≥10%) → contenido impreso cortado sobre papel. ≥2 lados OPUESTOS → `true`.
- **(F1.2)** Nueva regla de decisión (sin-EXIF): `escaneo` si (1) `tinta-al-filo` simétrica, o (2) borde-blanco + ratio de hoja **clásico O alargado E-14** (nueva banda — antes `borde-blanco+ratio-fuera` → null), o (3) **banda E-14 sin borde blanco** (relajación del guard). `null` en duda real (sin bitmap, forma de foto estándar sin blanco ni filo, borde blanco con forma absurda). Trazas aditivas: `sin-exif+tinta-al-filo+…`, `sin-exif+borde-blanco+ratio-e14`, `sin-exif+ratio-e14`.

### F2 — institucionalizar «el escaneo no se encuadra» (`scanner-core-bridge.ts`)
- **(F2.1)** La detección de bordes NO corre para escaneos: `else if (escaneoIdentidad) quad = QUAD_IDENTITY` — sin worker, sin Sobel, sin espera fría. La clase entera de quads falsos eliminada POR CONSTRUCCIÓN. `detect` ≈0 ms (antes ~116 ms/acta) y el informe DETECCION los cuenta por la vía normal.
- **(F2.3)** `verificarCompletitud` no corre para escaneos (su `completa` ya se descartaba siempre — el marco la pisa). **EFECTO DECLARADO**: el escudo anti-fondo (`fondo → techo 7.9`) tampoco aplica a escaneos — es un guard del WARP (fondo incluida por el encuadre), sin premisa en identidad; el veredicto del escaneo lo gobiernan marco + lectura + marcadores.
- **(F2.4)** `sinRecorte` (rama manual/editor) sin cambios — la identidad ya era su convención.

### F3 — `marco-escaneo.ts` + `types.ts` + `informe.ts`: el marco honesto con ceñidos
- **(F3.1)** Líneas EN el filo (0..`INSET_MIN_PX`) contadas aparte (`ladoEnFilo`): ≥2 lados opuestos con línea al filo → veredicto **`"ceñido"`** — NUNCA bloquea (cortar EN el marco no pierde contenido: el marco vive insertado ~2%). Evaluado ANTES de `cortado`: los 2–3 lados inset de un ceñido son el mismo marco atravesado.
- **(F3.2)** `gateMarco` gana `"ceñido"` (union aditiva en `DiagnosticoActa.gate.gateMarco` y `FilaInforme.gateMarco` — los instrumentos previos siguen parseando los 3 valores viejos, contrato D51).
- **(F3.3)** `"cortado"` reservado al caso real: lados inset SIN par de filo (escáner cortó DENTRO del contenido) + la lectura ya no rescata (F0.2).
- **(F3.4)** Copy del rechazo INCOMPLETA por origen: escaneo → **«EL ESCANEO PARECE CORTADO — REPITE EL ESCANEO INCLUYENDO EL ACTA COMPLETA»**; fotos/cámara conservan el copy de siempre byte a byte (`pipelineRecorte` —rama manual— sin cambios: el operador ya eligió el encuadre).

## 2. DECISIONES DE CALIBRACIÓN DECLARADAS (desviaciones del plan literal — con causa)

1. **La banda E-14 es 0.22–0.45 y la relajación (3) SOLO aplica a esa banda.** El plan pide «ratio-hoja sin borde blanco» sin acotar la banda; su propia justificación cita el E-14 real (~0.31). Extender la relajación a la banda clásica (0.58–0.87) habría volteado a `escaneo` las fotos sin-EXIF con forma 4:3/16:9 — WhatsApp de la cola real (null honesto hoy) — rompiendo la invariancia de la Fase E pendiente. Con la banda E-14: WhatsApp 4:3 (0.75) y 16:9 (0.5625) quedan fuera → null como hoy (humo lo afirma).
2. **El lado del filo exige MEZCLA tinta+papel** (tinta ≥25% Y papel ≥10%). La señal literal del plan («fracción de tinta ≥25%») tiene un falso positivo sistemático: fondo oscuro UNIFORME al filo (foto de acta sobre mesa gris — WhatsApp real) contaría como «tinta» y voltearía a `escaneo`. La mezcla conserva el caso objetivo (escaneo cortado atravesando marco/contenido: filo con tinta Y papel) y rechaza el fondo plano. El caso «captura de pantalla ceñida» del plan sigue cayendo a escaneo (humo §3.14); la captura UNIFORMEMENTE oscura (sin contenido) cae null — honesto: no hay acta que leer.
3. **`quadOrigen` en la rama de identidad (F2.1)** queda `null` (sin detección que lo fabrique) mientras el rescate F0.1 (muerto hoy) usa `"pagina-completa"`; el informe DETECCION cuenta los `pagina-completa` que SI se producen. El token `origen=pagina-completa` del log solo aparece cuando hay veredicto — el `sinRecorte` de SIM ya usa la misma convención (n/d jamás miente).

## 3. Gates y humo

### Gates
- `tsc --noEmit` **0 errores** · `bun run lint` **limpio** · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` **OK**.
- **Binario del build verificado**: los chunks contienen los tokens nuevos (`tinta-al-filo`, `ceñido`, `ratio-e14`, copy escaneo, `pagina-completa`).

### Humo puro (bun, `/home/z/tmp/humo-e63d.ts` — desechable, fuera del repo): **22/22 OK**
- **F1**: ceñido real (par vertical/horizontal de filo) → `true`; un solo lado → `false`; EXIF/HEIC → foto (intocados); E-14 ceñido → `escaneo` `sin-exif+tinta-al-filo+ratio-e14`; E-14 con margen blanco → `escaneo` `borde-blanco+ratio-e14` (antes null); E-14 margen gris → `escaneo` `ratio-e14`; **INVARIANCIA WhatsApp** 4:3 y 16:9 (textura realista) → `null` como hoy; carta clásica → `escaneo` `borde-blanco+ratio-hoja` (intocado); sin bitmap → null; captura de pantalla ceñida → `escaneo`; **fondo oscuro uniforme al filo → null** (fondo ≠ tinta).
- **F3**: marco 4 lados inset → `completo`+rect (intocado); **P2 real (marco atravesado sup+inf + lados inset) → `ceñido`** (antes `cortado`); marco solo en filo → `ceñido`; 2-3 lados inset sin par de filo → `cortado` (reservado); 1 lado → `no-encontrado`; **CONTROL NEGATIVO del plan**: escaneo mutilado (contenido discontinuo al filo, media página fuera) → NO `ceñido` (una línea continua exige LINEA_MIN_PCT 0.5 — texto no la forma) → `cortado` → y sin lectura FUERTE/secciones el perdón no aplica.
- Narrativa honesta: la 1.ª corrida del humo falló 2 casos — el fixture WhatsApp estaba mal hecho (imagen uniformemente oscura = literalmente «tinta al filo en 4 lados», que el plan clasifica escaneo). Se rehicieron con textura realista y se añadieron los controles de fondo oscuro → 22/22.

### Humo navegador — NO CONCLUYENTE por ort-wasm del headless (declarado, no oculto)
- Arnés COOP/COEP :3417 (patrón D63-A2 rev.2): `crossOriginIsolated=true`, todos los assets 200 (ort `.wasm`/`.mjs` verificados byte a byte vs Vercel — idénticos). El arranque del backend wasm falló de forma persistente en ESTA sesión headless (`no available backend found. ERR: [wasm]` — ~9 intentos, sesión fresca incluida). **Evidencia de que es ambiental, no del kit**: el CANÓNICO Vercel (bundle a742953, sin e63d) mostró el MISMO fallo en su 1.ª carga en el mismo navegador y lo resolvió en el reintento (`listo det=496ms`); aquí no convergió. El stack OCR es INTOCADO por este kit.
- Sustituto: binario del build verificado por tokens (§3) + humo puro 22/22 + verificación línea a línea del plan. La validación end-to-end (P1 sin `recortada`, P2 ≥8.5, chips SIM) la da la corrida del dueño con su zip real (F4/Fase D del plan) — como el propio plan prescribe.

## 4. QUÉ NO CAMBIO (guardas del plan — verificadas)
- Fotos de cámara: ni una línea (EXIF manda primero; el guard de fotos, el quad del worker y los copies de cámara intactos — el marco solo consulta `origenActa === "escaneo"`).
- SIM/demo: chips 8.2/7.0/4.3 intocables (doble guard: SIM jamás trae `origenActa`; el marco exige `!simular`; verificarCompletitud ya se saltaba en SIM).
- Honestidad de gates: «cortado» sigue condenando cuando la lectura no rescata (falta sección / lectura débil-media).
- Contrato de trazas: SOLO aditivo (`tinta-al-filo`, `ratio-e14`, `"ceñido"`, copy nuevo) — el formato previo no cambia de nombre ni de lugar.
- `pipelineRecorte` (rama manual) y el editor: sin cambios.

## 5. Riesgos vigilados (plan §4 + hallazgos de esta ejecución)
| Riesgo | Estado |
|---|---|
| Escaneo mutilado pase con lectura FUERTE imposible | Cubierto: `faltaSeccion` sigue mandando (F0.2 exige `!faltaSeccion`) + control negativo del humo (mutilado → NO ceñido/cortado) |
| Escaneos rotados >10° | Sin cambio (D63-B tope 10°; la identidad no endereza ni desendereza) |
| Capturas/fotos de pantalla → escaneo | Deseado por el plan (páginas planas); el guard de contenido sigue operando |
| Regresión en escaneos con margen | F2 mantiene identidad → el marco inset detecta «completo» y alimenta el rect de zona de votos (mejor que hoy) |
| **Hallazgo nuevo (esta ejecución)**: foto sin-EXIF con el PAPEL pegado al filo en ≥2 lados opuestos (WhatsApp reenviado apretado) | Cae a `escaneo` (es indistinguible de un ceñido por señal de píxel). Consecuencia: identidad (sin re-recorte) + gate de marco + deskew — desenlace gobernado por lectura/marcadores como un escaneo. AUDITABLE por la traza `tinta-al-filo`. Si la cola real muestra volteos indeseados, la calibración es de CONSTANTES (umbral/papel/franja), no de estructura |

## 6. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/lib/e14/scanner-core-bridge.ts` | F0.1 (rescate generalizado) + F0.2 (perdón de lectura) + F2.1 (identidad por construcción) + F2.3 (skip verificarCompletitud para escaneos) + F3.4 (copy por origen) |
| `src/lib/e14/masiva/origen.ts` | F1.1 (`tintaAlFiloSimetrica` mixta) + F1.2 (regla de decisión con banda E-14) + trazas aditivas |
| `src/lib/e14/marco-escaneo.ts` | F3.1 (ladoEnFilo + veredicto `ceñido`) + docs |
| `src/lib/e14/types.ts` | F3.2 (`gateMarco` + `"ceñido"` — aditivo) |
| `src/lib/e14/informe.ts` | F3.2 (`FilaInforme.gateMarco` + `"ceñido"` — aditivo) |
| `docs/` (REPORTE/DECISIONS/ROADMAP/worklog) + `AGENTS.md` | esta documentación |

## 7. Pendiente
- **Del dueño (F4/Fase D)**: correr la cola real (zip 20261021-091545) sobre el PR desplegado → P1 sin `recortada` · P2 deja de ser RECHAZADA (lectura FUERTE) · chips SIM intactos · trazas nuevas en el informe (`quadOrigen=pagina-completa`, `gateMarco=ceñido|cortado-perdonado`, origen `tinta-al-filo`). Si algo salta → tabla de atribución antes del merge.
- **Del agente (post-corrida)**: análisis A/B del informe + revisión de la tabla dedup (los fixtures del zip no están en esta máquina — lab/bench del plan F4 se ejecutan con esa evidencia).
