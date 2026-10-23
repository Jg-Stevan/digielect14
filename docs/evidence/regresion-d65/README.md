# Evidencia — regresión D65 en el zip `4f9c871`

> Conservada el **2026-10-22** (sesión de auditoría Fase 3A.5, rama
> `audit/quality-pass-1`). Es la prueba forense de la **regresión de
> reconstrucción** detectada al cerrar la sospecha B1: el destello D65 T3.3
> (barra `h-1` verde bajo `LISTA && recienListas.has(f.id)`) existía cableado
> en `84cd0be` y el bloque **completo** de barras por fila se perdió en
> `4f9c871` (zip D68-D72 reconstruido sobre `e8c98de`). Sin esta evidencia,
> el hallazgo dependía de un sandbox efímero.

## Archivos

| Archivo | Qué muestra |
|---|---|
| `31-sim.png` | Escáner con **SIM activo**: el «selector de modo» es un segmented **siempre visible** (CÁMARA/SIM/SUBIR). 0 `role=dialog`/`menu` y 0 elementos `scale-0.97` en todo el DOM → el menú modal de modo **nunca se monta** (veredicto B1-c para `modoMenuMontado`). |
| `41-final.png` | Bandeja MASIVA al final del polling de 150 s: filas procesadas/duplicadas con **solo chip %** — ninguna barra de progreso por fila. |
| `v4.log` | Ronda de verificación v4: cierre de onboarding por ref; sonda del menú de modo (`{"dialogs":0,"escala097":0,"segmented":3}`); upload ×3 vía DataTransfer (acta2/3 detectadas DUPLICADA, hamming=0); precalor + dedup v2 en vivo; HTML de la 1.ª fila muestra chip `0%` + `-/-` **sin barra**; contadores globales `{"barrasH1":1,...}` — el único `h-1` de la página NO está en las filas. |
| `v5.log` | Ronda v5 (definitiva): 6 archivos (1 original + 5 dups), clic en PROCESAR COLA, **sonda DOM cada 1.5 s durante 150 s**: `barrasEnBandeja=0` y `verdesEnBandeja=0` en TODAS las muestras; HTML final de cada fila: `?::sin-barra` ×6. La consola prueba que el pipeline SÍ corrió completo (decode-maestro → orientación conf 0.98 → OCR escalonado conf 98.2 % → dedup reutiliza score 4.9): la ausencia de barras es **estructural** (no hay markup que disparar), no un destello no observado. |

## Cómo se generó

- Dev server de `digielect14` en `:3011` (patrón `node + tee` en un bloque —
  el sandbox siega procesos de fondo simples).
- Driver: agent-browser (navegación por ref, `DataTransfer` + evento `change`
  para uploads, clics reales). Actas sintéticas generadas con PIL (marco +
  texto de cabecera).
- Sonda: evaluación JS cada 1.5 s contando, dentro de la bandeja de filas,
  elementos `h-1`, `bg-brand-green`/verde y barras de progreso; snapshot HTML
  de las filas al inicio y al final.
- Escenarios: v4 = 3 archivos (1 original + 2 dups) con polling corto; v5 =
  6 archivos con polling de 150 s hasta observar desenlace.

## Veredictos B1 resumidos (AUDIT.md §2.2)

1. `modoMenuMontado` (ScanView) → **(c)**: wiring de una skin anterior. Nada
   llama `setModoMenuAbierto(true)`; pickaxe: nació huérfano en `4f9c871`.
   Candidato a eliminación (estados + efecto Escape + comentarios).
2. `recienListas` (MasivaView) → **(b) regresión de reconstrucción**: el
   destello D65 T3.3 existió (`84cd0be`) y `4f9c871` perdió el bloque COMPLETO
   de barras por fila (hoy: solo chip %). Comentario L631 sobrevive huérfano.
   La plomería (`recienListas`/`enColaVida`/`posCola`) sigue intacta.
3. Implicación B2 reforzada: re-cablear D65 T3.3 restauraría de una vez las
   barras esActiva/ERROR/LISTA; el QA e65b grepea el FILTRO `colaVida` (no el
   render), así que sigue verde mientras la plomería exista.
