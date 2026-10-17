# KIT e14-diagnostico-autoenvio-v1 — "POR QUÉ NO SE ENVIÓ" (paquete ZIP + reporte de comportamiento)

Repo: `Jg-Stevan/digielect14` · Base: `origin/main` (o la rama más adelantada mergeada — §8)
Rama nueva: `feat/diagnostico-autoenvio` · Fecha: 2026-10-17 · Estado: PLAN para agente

---

## §0 — Decisión del dueño (literal)

> "necesitamos hacer un scprit para que nos haga un reporte automaticamente de como se
> esta comportando el proyecto para que — Analice los tiempos de captura y otras cosas
> que nos ayuden a identificar lo que estamos buscando > cuando una imagen no se envie
> automaticamente que descargue un archivo comprimido del por que la imagen no se envio
> automaticamente, (la idea es que la mayor parte de las imagenes se envien
> automaticamente), el archivo debe de contener (imagen original sin recortar y el
> resultado final para hacer la comparativa)"

**Aclaración de forma**: esto NO es un script externo — la data nace EN el
dispositivo (el app es el que escanea y decide). Es una **feature del app** con 2
entregas:

1. **PAQUETE DE DIAGNÓSTICO AUTOMÁTICO** — cada vez que un acta NO se auto-envía,
   el app descarga un ZIP: `original.jpg` (sin recortar) + `final.jpg` (resultado)
   + el POR QUÉ (JSON estructurado + TXT legible) + el reporte agregado del
   comportamiento (viaja pegado).
2. **REPORTE DE COMPORTAMIENTO** — estadística acumulada del puesto: tasa de
   auto-envío, causas top, tiempos p50/p95 por etapa. Card en RESUMEN + exportable.

Objetivo de producto: **subir la tasa de auto-envío**. El reporte la mide y ranking
de causas; el ZIP da la evidencia visual caso a caso para arreglarlas.

---

## §1 — Cómo funciona hoy el auto-envío (verificado en main/feat/score-lectura)

- `store.ts → analisisCompletado()` (L~606): SOLO `status === "OPTIMA"` se auto-envía
  (`ENVIADA` + `enviadoAutomaticamente`). Todo lo demás queda en REVISIÓN:
  - `ADVERTENCIA` (6.5–7.9) — va a decisión humana
  - `RECHAZADA` (<6.5) — rescaneo requerido
  - rechazos directos: `INCOMPLETA` · `SIN_VOTOS` (gate de marcadores) · `BAJO` (sin señal)
- El path de recorte (`confirmarRecorte` L~755) re-evalúa y auto-envía igual si da OPTIMA.
- El Acta YA trae: `fotoOriginal` (cruda del disparo/import, sin recortar),
  `fotoProcesada` (warp+realce), `score`, `status`, `rechazo`, `metricas`,
  `motor`, `filtro`, `quadDetectado`, `ocrTexto`, `clasificacion`, `intento`,
  `recortada`, `recorteLado`.
- Lo que SOLO vive en el log de auditoría (y hay que capturar): `ms.*` (tiempos),
  techos aplicados (fair/poor/sin-señal/escudo-fondo/recortada/lectura), señal de
  lectura (`lectura=/anclas=`), `senalActa`, `procesadaVacia`, densidad de votos,
  `crop=` (bbox real), `piso=`.

**Definición operativa de "no se envió automáticamente"**: el desenlace del pipeline
devuelve status ≠ OPTIMA (y `!simular`). ESE es el trigger — no usar
`enviadoAutomaticamente` (el humano puede enviar después desde REVISIÓN; el paquete
se genera en el desenlace, antes de esa decisión).

---

## §2 — Alcance

### CAMBIA

- **C1 — `DiagnosticoActa` adjunto por el bridge** (2 sitios: escaneo y recorte,
  justo donde hoy se escribe el log de auditoría): helper ÚNICO `construirDiagnostico()`
  que empaca TODO lo que ya está en scope y lo cuelga en `acta.diagnostico`
  (campo nuevo OPCIONAL en `types.ts`). En `simular` NO se adjunta nunca.
- **C2 — Módulo nuevo `src/lib/e14/diagnostico.ts`** (puro, sin React):
  - `causaPrincipal(d: DiagnosticoActa): string` — cadena determinista (§4)
  - `descargarPaqueteDiagnostico(acta)` — arma el ZIP (§3) y dispara la descarga
  - `registrarDesenlace(acta)` — acumula en localStorage (`e14-diag-v1`, cap 500,
    evict más viejo, try/catch)
  - `reporteComportamiento()` → agregados + render TXT/JSON
- **C3 — Trigger en el store**: en `analisisCompletado()` (rama no-OPTIMA) y en el
  else del path de recorte: `if (acta.diagnostico) { registrarDesenlace(acta);
  descargarPaqueteDiagnostico(acta); }` + toast «Diagnóstico descargado».
- **C4 — Botón manual en REVISIÓN**: cuando `acta.diagnostico` existe y
  `status !== "ENVIADA"` → botón compacto «DIAGNÓSTICO ↓» que re-descarga el ZIP
  (red de seguridad si el navegador bloqueó la descarga automática — pitfall §9.1).
- **C5 — Card en RESUMEN**: «COMPORTAMIENTO» — tasa de auto-envío grande, 3 causas
  top con barra proporcional, botón «EXPORTAR REPORTE» (ZIP con JSON+TXT).
- **C6 — Dependencia**: `bun add fflate` (zip STORE sin recomprimir — ~2 KB).

### NO CAMBIA (lista dura)

- **Pipeline, gate, score, techos, marcadores, completitud — 0 cambios de decisión.**
  El diagnóstico es OBSERVACIÓN PASIVA: nunca altera el desenlace.
- **SIM nunca**: 0 descargas, 0 registros (los chips y el ciclo rotativo intactos).
- `evaluarGate`, `statusDeScore`, el score v2 (kit anterior), PROD-1/PROD-2.
- Nada se sube a la red — todo local; el dueño comparte los ZIPs como ya comparte
  los informes.
- Las fotos van BYTE A BYTE del dataURL al ZIP (sin re-encode — pitfall §9.3).
- ScanView y el chip de disparo en vivo: intocables (orden previa del dueño).

---

## §3 — El paquete ZIP (contrato exacto)

Nombre: `e14-diag-<mesa|titulo-sanitizado>-<HHMMSS>-i<intento>.zip`

```
├── original.jpg        fotoOriginal SIN recortar (bytes del dataURL, sin re-encode)
├── final.jpg           fotoProcesada (si existe — siempre existe en el desenlace)
├── diagnostico.json    el registro estructurado completo (§3-A)
├── diagnostico.txt     el POR QUÉ legible (§4 — causa principal arriba, desglose después)
├── ocr.txt             ocrTexto crudo (vacío → archivo con nota «(sin texto OCR)»)
└── comportamiento.txt  reporte agregado al momento (piggyback — §5)
```

### §3-A `diagnostico.json` (shape único, mismo de los 2 sitios del bridge)

```ts
interface DiagnosticoActa {
  ts: string;                 // ISO local
  actaId: string; intento: number; maxIntentos: number;
  status: ActaStatus;         // el del DESENLACE (pre-decisión humana)
  rechazo: Acta["rechazo"];
  score: { visual: number; final: number; techos: string[] };
  // techos en ORDEN de aplicación, p.ej. ["techo-fair:7.9","lectura-DEBIL:5.9","escudo-fondo:7.9"]
  metricas: { sharpness: number; sharpnessHi: number; brightness: number;
              contrast: number; contrastPapel: number; contrasteEfectivo: number };
  level: string;              // excellent|good|fair|poor
  lectura: { nivel: string; anclas: number; chars: number };
  senalActa: boolean; ocrValido: boolean;
  gate: { completa: boolean; fondo: boolean; recortada: boolean; ladoEsquina: string | null;
         votos: { densidadPct: number | null; skipPag2: boolean; ok: boolean };
         procesadaVacia: boolean; clasifNivel: string };
  captura: { motor: string; filtro: string; crop: { w: number; h: number; fallback: boolean };
             quad: Quad };
  tiempos: { procesoMs: number; calidadMs: number; ocrMs: number; totalMs: number };
}
```

---

## §4 — `causaPrincipal()` (el "por qué" en UNA línea — reglas deterministas, en orden)

1. `rechazo.tipo === "SIN_VOTOS"` → «zona de votos sin tinta»
2. `rechazo.tipo === "INCOMPLETA"` → «tinta impresa cortada al filo del recorte»
3. `rechazo.tipo === "BAJO"` → «sin señal del acta (no se leyó cabecera/mesa/tipo)»
4. `status === "RECHAZADA"`:
   - `level === "poor"` → «foto físicamente deficiente (blur/exposición)»
   - `lectura.nivel === "DEBIL"` → «casi nada leído (anclas=<k>)»
   - sino → «métricas visuales bajas (nitidez/brillo/contraste)»
5. `status === "ADVERTENCIA"`:
   - techos incluye `recortada` → «acta recortada (lazo=<ladoEsquina>|secciones)»
   - techos incluye `escudo-fondo` → «fondo/sombra incluido en el recorte»
   - techos incluye `techo-fair` → «nitidez/exposición ACEPTABLE pero no alta»
   - techos incluye `lectura-DEBIL` → «lectura débil frena el piso»
   - sino → «score visual <8 sin techo específico»
6. fallback → «ver diagnostico.json»

---

## §5 — Reporte de comportamiento (agregado)

Fuente: entradas acumuladas `{ts, status, autoEnviada: boolean, score, lectura.nivel,
techos, causaPrincipal, tiempos}`. Métricas:

- **tasa de auto-envío** = autoEnviadas/total (la métrica del dueño)
- **histograma de causas** (de las no-auto) — ordenado desc
- **distribución de status** (OPTIMA/ADVERTENCIA/RECHAZADA/SIN_VOTOS/INCOMPLETA/BAJO)
- **tiempos p50/p95** de proceso/calidad/ocr/total (ms)
- **cruce lectura × auto-envío** (FUERTE→% auto, MEDIA→%, DEBIL→% — esperado 100/medio/0)
- **por intento** (i1..i4 → % auto)

TXT render legible (mismo estilo de los informes) + JSON crudo. Persistencia
localStorage `e14-diag-v1` cap 500 entradas.

---

## §6 — Especificación por archivo

### A) `src/lib/e14/types.ts`
- `interface DiagnosticoActa {…}` (§3-A) exportada + `Acta.diagnostico?: DiagnosticoActa`.

### B) `src/lib/e14/scanner-core-bridge.ts` (2 sitios — escaneo ~L1096 y recorte ~L1407)
- Import del helper nuevo (o helper local `construirDiagnostico` reusado por ambos).
- Justo DESPUÉS de escribir el log de auditoría (todo en scope): montar el objeto y
  adjuntarlo al acta que se retorna. `simular` → no adjuntar (guard existente).
- Techos a capturar: los que el sitio ya conoce — level caps (fair/poor) se deducen
  del level final; `escudo-fondo` = `verificacionResuelta?.fondo`; `recortada`;
  `TECHO_SIN_SENAL` si `!senalActa`; `lectura-DEBIL`/`piso-lectura-FUERTE` de `senal`.
  **Pasa las mismas expresiones que ya usa el log — NO re-evaluar nada nuevo.**
- Traza nueva en el log: `diag=1` cuando se adjuntó (verificable en QA).

### C) `src/lib/e14/diagnostico.ts` (NUEVO)
- ZIP con `zipSync` de fflate (STORE — JPEGs ya comprimidos): decodificar dataURL
  → `Uint8Array` (helper `dataUrlABytes` con `atob` — mismo patrón que el hashing
  de integridad), `original.jpg`/`final.jpg`, textos con `strToU8`.
- Descarga: `Blob` + `<a download>` click programático + revocar URL.
- Toast lo emite el store (no el módulo) — el módulo devuelve `{ok, bytes, ms}`.
- Todo try/catch: si el ZIP falla, el desenlace del acta NO se afecta jamás (la
  descarga es un efecto secundario — pitfall §9.9).

### D) `src/lib/e14/store.ts`
- C3 (§2) en `analisisCompletado()` (rama no-OPTIMA, DESPUÉS de montar la vista) y
  en el else del path de recorte. Toast informativo. NUNCA en OPTIMA/ENVIADA.

### E) `src/components/e14/screens/ReviewView.tsx`
- C4: botón «DIAGNÓSTICO ↓» compacto (misma fila de acciones del kit
  visor-accion-score), visible solo con `acta.diagnostico && status !== "ENVIADA"`.

### F) `src/components/e14/screens/ResumenView.tsx`
- C5: card COMPORTAMIENTO (tasa + 3 causas top + export). Datos de
  `reporteComportamiento()` reactivos al store (suscriptor zustand o re-cálculo en
  render — ligero).

---

## §7 — Validación headless del agente (obligatoria antes del PR)

1. `bun run lint` + `tsc --noEmit` → 0.
2. **SIM**: 3 chips → 0 descargas, 0 entradas en localStorage, logs sin `diag=1`.
3. **Import Frankfurt P1 real** → OPTIMA → auto-envío, **0 ZIP**, 1 entrada
   `autoEnviada:true` en el acumulador.
4. **Caso no-auto forzado** (sin SIM): importar una foto no-acta (p.ej. escritorio)
   → RECHAZADA/BAJO → ZIP descargado; abrir el ZIP y verificar: original.jpg es la
   foto cruda SIN recortar, final.jpg el resultado, causaPrincipal coherente con el
   status, comportamiento.txt con tasa 1/2.
5. **Recorte manual** de esa acta → 2º desenlace → 2º paquete con `i2`.
6. Reporte de RESUMEN = números de localStorage (misma fuente).

---

## §8 — Rama base y entregables

- **Base**: la rama de producción más adelantada ya mergeada. Si PROD-1
  (`feat/ocr-lee-original`) o score-lectura ya están en main → branquear de main
  actualizado; si NO → main normal (el kit no depende de ellos; los techos de
  lectura son campos aditivos — si existen se reportan, si no, la lista no los trae).
- Conflicto esperado y trivial con esas ramas (misma zona del log de auditoría):
  mantener AMBOS tokens en la línea (`ocrIn=` + `lectura=` + `diag=`).
- Rama `feat/diagnostico-autoenvio` · PR sin merge (espera auditoría).
- `docs/REPORTE-diagnostico-autoenvio-v1.md` con la evidencia de §7 (screenshots no
  — logs + listado del contenido del ZIP con tamaños).
- Prohibido: `bun run build`, tocar `packages/`, mover el dev server.

---

## §9 — Pitfalls

1. **La descarga automática sin gesto del usuario puede ser bloqueada** por el
   navegador → por eso el botón de REVISIÓN (C4) es OBLIGATORIO, no opcional. El
   auto-disparo va con try/catch y toast.
2. **SIM nunca descarga nada** — doble guard (bridge no adjunta + store no dispara).
   Romper esto rompe la demo del dueño (no-regresión dura).
3. **NUNCA re-encodear los JPEG** (canvas/toDataURL) — artefactos falsos arruinan
   la comparativa original vs final. Bytes directos del dataURL.
4. **localStorage lanza en modo privado/Safari** — todo try/catch con fallback a
   memoria (el reporte de la sesión sobrevive, el persistente no — honesto).
5. **Peso del ZIP**: original puede ser 12MP (~5-8 MB) → ZIP de 8-15 MB. OK para
   evidencia; nombre corto, sanitizado (sin espacios/tildes/`:`).
6. **NO reconstruir el diagnóstico desde los console.logs** — una sola fuente de
   verdad: el objeto que el bridge adjunta donde HOY escribe el log. Duplicar = dos
   verdades que divergen.
7. **El paquete no cambia el desenlace** — si la descarga falla, el acta sigue su
   flujo normal (efecto secundario puro, try/catch en todo).
8. **Cap 500 entradas** — el localStorage del dispositivo no es infinito; evict FIFO.
9. **No bloquear el hilo en el desenlace**: zipSync de ~12 MB tarda <300 ms (STORE);
   medir y loggear `diag=<ms>ms`; si en QA se nota jank, subir a worker (decisión
   documentada, NO en este kit).
10. **`intento` va en el nombre del archivo** — 4 intentos de la misma acta = 4
    paquetes comparables (la evolución quad/legibilidad intento a intento es
    justo la evidencia que el dueño quiere).
