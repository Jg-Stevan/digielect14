# REPORTE — KIT e14-rastreo-tiempos-v1 (+ e14-sin-relleno-v1)

Fecha: 2026-10-29 · Base: main `0bef6a6` · Autor: sesión Z.ai (petición del dueño)

## 0. Petición del dueño

1. «Test/diagnóstico/informe/rastreo automatizado para medir los tiempos de
   digitalización, bastante completo para tener datos reales, que se active
   desde el modo desarrollador (hoy "modo diagnostico") y rastree como lo
   usaría un usuario normal».
2. «Eliminar los datos de simulación/relleno que existan — la app va al
   público y no debe tener relleno de prueba; si se requiere la simulación,
   dejar el botón en el módulo de actas».

## 1. KIT e14-rastreo-tiempos-v1 — rastreo de tiempos

### Arquitectura (observación pasiva — regla de oro respetada)

El motor se suscribe al `useE14Store` y CRONOMETRA el ciclo real de
digitalización SIN tocar pipeline/gate/scores/reglas de negocio. Cero
dependencias nuevas. Archivos:

- `src/lib/e14/rastreo/tipos.ts` — contratos (unidad, sesión, eventos,
  metas de fluidez).
- `src/lib/e14/rastreo/motor.ts` — observador: captura → resuelto →
  revisión → envío, reintentos agrupados en UNA unidad, dwell por vista,
  sesión persistida (localStorage `e14-rastreo-v1`, sobrevive recargas).
- `src/lib/e14/rastreo/informe.ts` — agregación (p50/p95/media/min/max),
  informe JSON auto-descriptivo + TXT legible + CSV (BOM UTF-8), descargas
  con el patrón `descargarBlob` (D1: nada sale sin pulsar descargar).
- `src/components/e14/dev/SeccionRastreo.tsx` — sección 9 del PanelDev:
  switch armado (SÍ/NO), cronómetro de fase en vivo (1 s, solo con el
  panel abierto), KPIs (actas, enviadas, promedio, actas/hora, pipeline
  p50·p95, re-escaneos), 3 botones de informe, protocolo de prueba y
  «vaciar datos» armado.
- `src/app/page.tsx` — bootstrap idempotente `iniciarRastreo()` (retoma la
  sesión activa tras una recarga).

### QUÉ mide

| Fase | Fuente del dato |
|---|---|
| `pipelineMs` | pared: disparo → acta resuelta (store: vista `analizando` → `actaActual`) |
| internos (decode/detect/calidad/ocr/proceso/total) | `DiagnosticoActa.tiempos` REAL del bridge del último intento |
| `revisionMs` | pared: entrada a REVISIÓN con acta sin resolver → decisión (null = auto-envío ÓPTIMA) |
| `totalMs` | pared: inicio de unidad → desenlace terminal (reintentos incluidos) |
| `envioMs` | `diagnostico.tiempos.envioMs` (BASELINE del envío — §G.1 obs) |
| navegación | permanencia + visitas por vista (cómo se mueve el operador) |
| re-escaneos | intentos − 1 por unidad; `statusPorIntento` conserva cada desenlace |

Las actas de los chips TEST SCORES (fuente `SIMULACION`) se marcan `sim` y
**jamás** entran en los agregados reales (van aparte en el informe).

### Metas de fluidez (referencias — NO gates)

Acta total ≤ 90 s · pipeline ≤ 45 s (gama media, OCR caliente). El informe
cuenta cuántas unidades las superan (`sobreMeta`).

### Privacidad (mismo espíritu D1/D4 de obs)

Solo tiempos/estados/contadores. IDs con `fnv1a8` (jamás el id plano). SIN
fotos, SIN OCR, SIN puesto/mesa en claro. Persistencia local (localStorage);
nada sale sin descarga manual.

## 2. KIT e14-sin-relleno-v1 — fuera el relleno de prueba

- **Arranque/jornada REAL vacíos** (`store.ts`): sin `mesasIniciales()` (el
  mock MESA 01/02/03 ya no arranca montado), `completadas/asignadasHoy/cola
  Offline/solicitudesRescaneo` en 0 y `historial: []`. `reiniciarJornada`
  también resetea a cero HONESTO.
- **`seed.ts` recortado**: fuera `progresoInicial` (12/9 «75%»),
  `COLA_OFFLINE_INICIAL`, `SOLICITUDES_RESCANEO_INICIAL` e
  `historialInicial` (filas 14:32/14:28/14:21 de mentira). Lo que queda
  (`mesasIniciales`, `guionDePuesto`, `PUESTO_SIMULADO`, `ACTA_MOCK`) SOLO
  alimenta el MODO SIMULACIÓN y los datos de pantalla del editor (fase
  lógica L1).
- **Simulación con un solo botón, en ACTAS** (como pidió el dueño): el
  toggle «SIM» de ActasView sigue siendo la única vía para llenar la vista
  con datos demo. Al apagarlo sin puesto real, la vista vuelve a estado
  REAL vacío («AÚN NO HAY ACTAS ESCANEADAS») — antes re-montaba el mock.
- **Barra TEST SCORES fuera del flujo público** (`ScanView.tsx`): los chips
  ÓPTIMA/MEDIO/BAJA solo se muestran con «SIM» encendido o en modo
  desarrollador — el usuario final ve el escáner limpio.
- **Fallback honesto del título** (`scanner-core-bridge.ts`): una acta real
  sin clasificación ya NO hereda «ROMA - CONSULADO» del mock — muestra
  «ACTA SIN IDENTIFICAR» y ubicación «—» (la mesa real se conserva).
- **Contador de envíos honesto** (`store.ts`): fuera el cap
  `Math.min(+1, asignadasHoy)` herencia del seed 12/9 (con asignadasHoy 0
  congelaba `completadas` a cero para siempre).

## 3. Renombrado «modo diagnóstico» → «modo desarrollador»

UI renombrada (TuercaResumen, PanelDev, TopBar): título del panel, fila de
estado, confirmaciones, aria-labels y titles. Las claves internas
(`e14-dev-mode`, `guardarModoDev`) quedan intactas — solo cambió el copy
visible. La sección nueva se organiza como §9 del panel (append-only,
numeración 1-8 intacta).

## 4. Gates

- `bunx tsc --noEmit` → 0 errores.
- `bun run lint` → 0 problemas.
- `bun run test` → vitest **233/233** (16 archivos).
- Validado en navegador (modo desarrollador §9): activar rastreo → capturas
  SIM y por IMPORTAR → cronómetro de fase en vivo → informe JSON/TXT/CSV
  descargado con datos reales → detener sesión → «vació datos» armado.

## 5. Fuera de alcance (documentado)

- `hashMock()` (hash demo del envío local) se conserva — es el BASELINE
  documentado del ledger D1 y no es visible en la UI.
- Candidatos/firmas/código de barras de `ACTA_MOCK` dentro del `Acta` se
  conservan (datos de pantalla del editor, fase lógica — la REVISIÓN no los
  renderiza; los QA del repo escanean esos literales).
