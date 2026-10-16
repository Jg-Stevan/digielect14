# PATRÓN de identificación del E-14 exterior (consulados) — v1

Fecha: 2026-10-16 · Autor: Z.ai Code (Task 119, diagnóstico) · Pedido del dueño:
«¿cómo identificamos correctamente el acta? — delegados/transmisión · página · mesa · ¿completa sin recortar?»

Fuentes de evidencia:
- 6 actas oficiales descargadas del visor Registraduría (12 páginas → 12 códigos 1D leídos):
  ROMA - CONSULADO (kit 982) · EL CAIRO - CONSULADO transmisión y delegados (kit 399, las DOS
  copias) · BARCELONA - GIRONA (kit 1265) · BERLIN CONSULADO mesas 008 y 009 (kits 726/727).
- 1 acta ya registrada en el clasificador por OCR del dueño: FRANKFURT CONSULADO (kit 745,
  zona 15, puesto 02, mesa 012, transmisión — «ZONA: 18» era OCR de 15; filename real
  `E14_SINKIT_88_120_15_02_012_TRANSMISION-1`).
- Decodificación real de QR/códigos con zxing-cpp sobre los PDF (script en este análisis, §6).

---

## 0. Resumen ejecutivo

El acta trae SU PROPIA cédula impresa. Tres fuentes independientes, en orden de fiabilidad:

| # | Fuente | Dato | Fiabilidad |
|---|--------|------|-----------|
| 1 | **Código 1D + sus 15 dígitos impresos** (bajo el código de barras, cabecera) | KIT + TIPO + VER + PÁG + TOTAL (gramática cerrada, §1) | Alta (OCR-B, dígitos, posición fija) |
| 2 | **Cabecera** «CONSULADO/PAÍS/ZONA/PUESTO/MESA/LUGAR» | Ruta DIVIPOL + mesa | Media-alta (ya implementado, fuzzy + rescate) |
| 3 | **Pie** «No. Form / KIT / Civ» | KIT de respaldo | Media (texto grande, fácil OCR) |
| 4 | **QR** (bloque izquierdo) | Blob criptográfico OPACO — **NO da el ID** (§6). Sirve como huella única + señal de integridad | — |

El QR **no** sustituye al 1D: es un payload de 32 bytes cifrado/firmado por la Registraduría.
La identificación correcta = cruzar 1D ↔ banda ↔ cabecera ↔ pie (el clasificador ya hace 3 de
esas lecturas; falta el parseo completo del código y los cruces → kit
`INSTRUCCIONES-e14-identificacion-codigo-v1.md`, Task 120).

---

## 1. Gramática del código 1D impreso (15 dígitos) — VERIFICADA 12/12

```
7 1 0 0  K K K K  T  V V  P P  G G
└─prefijo─┘ └─KIT─┘ │ └─Ver─┘ └Pag┘ └G=total
                    └ TIPO: 2 = CÓNSUL/EMBAJADOR (delegados)
                            3 = TRANSMISIÓN
```

- Posiciones (0-índice): `[0..3]` prefijo fijo `7100` · `[4..7]` KIT (No. Form, 4 dígitos con
  ceros) · `[8]` tipo · `[9..10]` «Ver» (siempre 01 en las muestras — coincide con el
  «Ver: 01» impreso) · `[11..12]` página · `[13..14]` total de páginas.
- Tabla de verificación (12/12 OK, script ejecutado):

| Código | Prefijo | KIT | d9 | Ver | Pág | Tot | Acta |
|---|---|---|---|---|---|---|---|
| 710009822010102 | 7100 | 0982 | 2 | 01 | 01 | 02 | ROMA 001 DELEGADOS p1 |
| 710009822010202 | 7100 | 0982 | 2 | 01 | 02 | 02 | ROMA 001 DELEGADOS p2 |
| 710003993010102 | 7100 | 0399 | 3 | 01 | 01 | 02 | EL CAIRO 001 TRANSMISIÓN p1 |
| 710003993010202 | 7100 | 0399 | 3 | 01 | 02 | 02 | EL CAIRO 001 TRANSMISIÓN p2 |
| 710003992010102 | 7100 | 0399 | 2 | 01 | 01 | 02 | EL CAIRO 001 DELEGADOS p1 |
| 710003992010202 | 7100 | 0399 | 2 | 01 | 02 | 02 | EL CAIRO 001 DELEGADOS p2 |
| 710012652010102 | 7100 | 1265 | 2 | 01 | 01 | 02 | BARCELONA-GIRONA 001 DELEGADOS p1 |
| 710012652010202 | 7100 | 1265 | 2 | 01 | 02 | 02 | BARCELONA-GIRONA 001 DELEGADOS p2 |
| 710007262010102 | 7100 | 0726 | 2 | 01 | 01 | 02 | BERLIN 008 DELEGADOS p1 |
| 710007262010202 | 7100 | 0726 | 2 | 01 | 02 | 02 | BERLIN 008 DELEGADOS p2 |
| 710007273010102 | 7100 | 0727 | 3 | 01 | 01 | 02 | BERLIN 009 TRANSMISIÓN p1 |
| 710007273010202 | 7100 | 0727 | 3 | 01 | 02 | 02 | BERLIN 009 TRANSMISIÓN p2 |

Notas:
- La **simbología** del código de barras NO decodificó en sandbox (zxing lee todos los
  formatos 1D y no matcheó; render del PDF pequeño/estriado). Da igual: los **dígitos
  impresos debajo** son la copia legible del mismo dato y ya los lee el OCR
  (`ANCLA_CODIGO_1D`, clasificador.ts L131). En foto real del acta, probar jsQR/zxing-wasm
  para el QR y dejar el 1D visual como imagen recortable para QA manual.
- Riesgo borde: KIT ≥ 10000 rompería el ancho de 4 (no visto; si ocurre, el ancla de 15
  dígitos no matchea y el sistema cae a banda/VerPag — fail-safe, no se rompe nada).
- El clasificador YA documenta d9/d12-15 como respaldos (L128-131, L340-348, L357-378);
  este análisis lo eleva a gramática completa con 12/12 (antes: «8/8 muestras»).

## 2. ¿Es delegados o transmisión?

1. **Banda** (señal primaria, ya implementada): banner negro bajo el título.
   «TRANSMISIÓN» vs «CÓNSUL/EMBAJADOR». Cuidado histórico ya resuelto en el repo: el literal
   de delegados se matchea por «EMBAJADOR/DELEGADOS» porque «CÓNSUL» suelto colisionaba con
   la caja «CONSULADO: 88» (corrección con evidencia del dueño, clasificador.ts L133-140).
2. **d9 del código** (respaldo, conf 0.9): 2=delegados, 3=transmisión.
3. **Evidencia fuerte del dígito**: el kit 399 de EL CAIRO trae las DOS copias de la MISMA
   mesa con códigos distintos — `3992…` (delegados) y `3993…` (transmisión). Es decir, el
   kit identifica la mesa y el dígito distingue la copia dentro del kit. 6/6 actas confirman
   el mapeo (9822, 3992, 12652, 7262 → delegados · 3993, 7273 → transmisión).
4. Regla propuesta para discrepancia banda↔d9: gana la banda (para nivel), baja confianza
   tipo a 0.75 + aviso display (kit 120).

## 3. ¿Número de página?

1. **Impreso** arriba a la derecha: «Ver: 01 Pag: 1 de 2» (ancla `ANCLA_VERPAG` L124).
2. **Código**: d11-12 = página, d13-14 = total (respaldo actual L340-348).
3. d9-10 = «Ver» — no aporta.
4. En acta real SIEMPRE deberían coincidir (ambas impresiones salen del mismo sistema).
   Discrepancia ⇒ error de OCR en una de las dos ⇒ regla nueva (kit 120): gana el código
   1D (más mecánico) + traza/aviso.
5. Recordar la causa raíz curada en Task 117-b: si NADA se lee, `pagina=null` y los
   consumidores hacían `?? 1` → la P2 se archivaba encima de la P1. Kit 118 corrige
   (página desconocida ≠ P1, hueco al primer libre). Este análisis refuerza: con el código
   1D parseado completo, «página desconocida» solo ocurre si ni VerPag ni un código de 15
   dígitos legibles hay — caso raro.

## 4. ¿Qué mesa es?

1. **Cabecera**: «ZONA: 10 PUESTO: 02 MESA: 001» + «PAÍS: 495 - ITALIA» + «LUGAR: …»
   → reglas 1-5 + rescate global por nombre (4b) ya implementados (fuzzy DIVIPOL 14.438
   puestos, LUGAR desambigua zonas con mismo código de puesto — ALEMANIA 02 en 05 Berlin y
   en 15 Frankfurt).
2. **REGISTRO kit→mesa** (NUEVO, kit 120): el kit es único por (país, puesto) en la
   evidencia → mesa recuperable aunque el ancla MESA falle (recortes, «NESA», etc.):

| mun (país) | zon | std | KIT | mesa | Acta |
|---|---|---|---|---|---|
| 495 | 10 | 02 | 982 | 1 | ROMA - CONSULADO |
| 335 | 05 | 02 | 399 | 1 | EL CAIRO - CONSULADO |
| 120 | 05 | 02 | 726 | 8 | BERLIN CONSULADO |
| 120 | 05 | 02 | 727 | 9 | BERLIN CONSULADO |
| 120 | 15 | 02 | 745 | 12 | FRANKFURT CONSULADO (OCR dueño + filename oficial) |
| 355 | 03 | 08 | 1265 | 1 | BARCELONA - GIRONA |

   Guardas: solo aplica con municipio resuelto que coincida; NUNCA da AUTO (el nivel sigue
   exigiendo cabecera+mesa leída+tipo); mesa del registro vs mesa leída discrepante ⇒ aviso
   display + traza (posible acta mal archivada o mesa fuera de countTable).
3. **El nombre del archivo oficial NO sirve**: el visor baja
   `E14_XXX_X_88_{PAIS}_{ZONA}_{PUESTO}_000_X_XXX.pdf` con MESA=000 (placeholder) y sin
   tipo — BERLIN mesa 008 y mesa 009 bajaron con el MISMO nombre (`…(1).pdf` era solo el
   contador de duplicados del navegador). Nuestro `nombreExportacion`
   (E14_{KIT}_{clave}_{TIPO}-{pag}, clasificador.ts L661) es el correcto; con el kit del
   código como respaldo, el `SINKIT` desaparece en la mayoría de capturas.

## 5. ¿Está completa el acta (sin recortar)?

Señales POSITIVAS (nuevas, kit 120):
1. **Marcas fiduciales de esquina**: el acta imprime un cuadrado negro relleno cerca de
   cada una de las 4 esquinas (visible en las 12 páginas de las muestras). Sobre el crop
   ya enderezado: núcleo oscuro (2-8% de la esquina) **con anillo blanco alrededor**
   (distingue marca de mesa oscura/corte). 4/4 = página completa; falta una ⇒ «RECORTADA
   {lado}». Detecta recortes SUPERIORES que la señal de contenido del kit 118 (SUMA
   TOTAL/FIRMA, solo inferior) no ve.
2. **Código 1D parseado completo** (§1): si el parseo cuadra (prefijo+aritmética), la zona
   del barcode está en la foto. Dato parcial (`7100098…`) ⇒ recorte lateral en la cabecera.
3. **Pie legible**: «KIT …» / «No. Form» — esquina inferior derecha/intacta.
4. **QR decodifica** (§6): cuadrante superior izquierdo completo.

Señales de contenido (ya en kit 118, Task ejecutor): `faltaSeccionInferior` (P1: SUMA
TOTAL · P2: FIRMA) → techo 7.9 + pill ACTA RECORTADA; tinta al filo → INCOMPLETA.

Señales estructurales:
- Proporción del crop ≈ A4 (0.707); rango sano 0.62–0.80 fuera de él ⇒ sospechoso.
- **Completitud del SET**: mesa completa = 4 capturas (DELEGADOS P1/P2 + TRANSMISIÓN P1/P2)
  — ya vive en `archivarHueco`/chips P1/P2 (store); el RESUMEN muestra cobertura.
- Validación aritmética (suma total = c1+c2+blanco+nulos+no-marcados) queda FUERA (los
  dígitos manuscritos son dominio del flujo de revisión humana, §0 del spec del
  clasificador).

## 6. QR: qué contiene (MEDIDO, no supuesto)

Payload base64 → **32 bytes** en las 12 páginas. Estructura observada:

- Las DOS copias (delegados y transmisión) del MISMO kit y MISMA página comparten los
  **primeros 16 bytes EXACTOS** y difieren en los últimos 16:
  - El Cairo p1: prefijo común `3dd662355af00c20bc5e0eeca848e14d`
  - El Cairo p2: prefijo común `2dccb3318691150024b31536e96cd411`
- Entre páginas del mismo kit: prefijos distintos. Entre kits: nada en común.

Interpretación: `[16 bytes: nonce/clave por (KIT, PÁGINA)] + [16 bytes: ciphertext/firma
por copia]` — blob anti-fraude que valida el visor oficial. **Conclusión operativa**:
- NO parsear el QR como ID (no hay ID en claro).
- USO legítimo: huella única de página de acta (dedupe/pairing futuro — el prefijo de 16
  bytes agrupa las copias del mismo kit+página) y señal de integridad (decodifica ⇒
  cuadrante superior izquierdo completo).

Hex completo de las 12 páginas (para fixtures futuros):

```
ROMA p1  d7808d11f7cf7e3d46e676391623e2535c9fd26530efa157b6ed74f70a504b9b
ROMA p2  1cf0a2c856dc84af94cdab644d93844ae8e1a66fd9b254346d501493b30029ba
CAIRO-T p1 3dd662355af00c20bc5e0eeca848e14d8cb6ce061ab768d616ff3713986edfb6
CAIRO-T p2 2dccb3318691150024b31536e96cd411300125511bcb61f8a8fdd01ca9a3c70a
CAIRO-D p1 3dd662355af00c20bc5e0eeca848e14d756b7fef1de515aa6f6868b5de78ba5e
CAIRO-D p2 2dccb3318691150024b31536e96cd411e8c4c679aab14752c36f243226d5f819
BARCELONA p1 badeab040d60450544410731991b05f2fcb11aeb1bf47584267fab031cf65698
BARCELONA p2 1fbedbd073eed23526b97229d8711517ae8b36bfdfc299f416e800765308faf5
BERLIN-008 p1 de296417ac1425378b83859d4ac5d3248d6200a4aad2a50102b110a656fd57ac
BERLIN-008 p2 d469f515cdeae6c27effab736426efc665aa4df4dc505e576f4e6f971596b852
BERLIN-009 p1 3ilk…(ver fichero) · p2 1Gn1… (base64 en §9)
```

(Nota: BERLIN-009 = archivo «(1)»; sus hex p1 `AI89tTvl…` = `008f3db53be5…` y p2 `FDAfIpzn…`
= `1430...` — se dejan en base64 original por brevedad; el prefijo-compartido se verificó
solo en EL CAIRO, las demás páginas son hipótesis a confirmar con más actas.)

Solo UN QR por página decodificó (zxing-cpp; el bloque izquierdo parece traer un segundo
código abajo que no decodifica en el render — asumir 0..1 lecturas por página).

## 7. Las 3 URLs de la Registraduría — qué son

| URL | Qué es | Hallazgo |
|---|---|---|
| `e14segundavueltapresidente.registraduria.gov.co/home` | Visor ciudadano de actas (Angular `E14VisorCiudadano`) | Build `main-TZAWWPHN`; backend **AWS AppSync GraphQL** (`y7knfv4pgjguvn5wev2fcct4c4.appsync-api.us-east-2.amazonaws.com/graphql`) con API key en runtime — **sin API pública documentada** |
| `e14segundavueltapresidentet.registraduria.gov.co/home` | Segunda build del visor (bundles distintos: `main-RR3ZX436`) | Mismo HTML shell, assets diferentes; DNS/CDN intermitente desde sandbox |
| `wapp.registraduria.gov.co/electoral/2026/presidente-de-la-republica-segunda-vuelta/` | Portal informativo de la segunda vuelta | Cartillas, protocolos, tarjeta electoral, términos de entrega y **`IMG/pdf/puestos_votacion_exterior.pdf` (7.4 MB)** — lista oficial de puestos del exterior (corpus DIVIPOL exterior) |

Veredicto práctico:
1. **No minar la API** (AppSync con auth, frágil y fuera de alcance). El acta ya trae su ID.
2. **Uso legítimo de las fuentes**: (a) descargar actas a mano como corpus de QA con ground
   truth; (b) `puestos_votacion_exterior.pdf` para validar/ampliar la base exterior
   (mesas por puesto); (c) los resultados del visor para validar dígitos extraídos.
3. Los filenames del visor NO fiables (§4.3) → nombrar siempre desde contenido.

## 8. Gap vs clasificador actual → kit 119/120

| Capacidad | Estado en `src/lib/e14/clasificador.ts` (main cf8e06c) | Kit 120 |
|---|---|---|
| Gramática completa del código 1D | Parcial: d9, d12-13, d14-15 como respaldos sueltos | `codigoUnicoE14()` parseo total + fixture 12/12 |
| Cruce banda↔d9 | Solo respaldo si banda ausente | Discrepancia ⇒ conf 0.75 + aviso |
| Cruce VerPag↔código | Código solo si VerPag ausente | Discrepancia ⇒ gana código + aviso |
| KIT desde código si pie falla | No (→ export `SINKIT`) | Sí |
| Registro kit→mesa | No existe | `kits.ts` con 6 verificadas + guardas |
| Esquinas fiduciales | No | `marcasEsquina()` + pill lado |
| QR | No | FUERA (documentado §6; huella futura) |

Dependencias de rama: PR #6 (visor-accion-score) → kit 118 (actas-vivas-paginas-v1) → kit
120 (este; toca clasificador.ts y el canal de integridad del 118).

## 9. Anexos

- Filenames oficiales observados: `E14_XXX_X_88_495_010_02_000_X_XXX.pdf` (Roma),
  `E14_XXX_X_88_355_003_08_000_X_XXX.pdf` (Barcelona),
  `E14_XXX_X_88_120_005_02_000_X_XXX.pdf` + `(1)` (Berlin 008 y 009 — MISMO nombre),
  `transmision el cairo.pdf` / `delegados el cairo.pdf` (renombrados por el dueño).
  Estructura: `E14_{XXX}_{X}_{CONSULADO 88}_{PAIS}_{ZONA}_{PUESTO}_{MESA=000}_{X}_{XXX}`.
- Export de la app ya observado en uploads del dueño: `E14_SINKIT_88_120_15_02_012_TRANSMISION-1`
  (sin kit leído) y `E14_CAPTURA_HHMMSS` — el kit 120 elimina la mayoría de `SINKIT`.
- Decoder sandbox: `python3.13` + `pymupdf` + `zxing-cpp` (pip). Comando reproducible:
  renderizar a 200 dpi y `zxingcpp.read_barcodes(img)`; QR → base64 de 32 bytes.
