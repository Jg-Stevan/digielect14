# Banco det 1280 vs 1920 — KIT e14-bench-tiempos-v1 B3 (SOLO banco, cero producción)

Instrumento de medición para el **GO/NO-GO DURO** de bajar `det_limit_side_len` de 1920 a 1280
(OCR escalonado: det 1280 con re-OCR a 1920 solo si la lectura sale débil; det escala
~(1280/1920)² ≈ 0.44× del tiempo). **Este banco NO cambia nada de producción**: `src/`,
`public/` y configuración quedan intactos; la constante `DET_CAP` vive SOLO aquí.

- **GO (kit §3):** mismos votos leídos que a 1920 en **TODO** el corpus + lecturas FUERTE idénticas.
- **NO-GO:** un solo voto perdido → se queda en 1920 (cero daño).

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone: pipeline completo det→cls→rec replicado de `rapidocr.ts` con `DET_CAP` ∈ {1920 (producción), 1280 (candidato)} — la ÚNICA diferencia, en op4 (det-preprocess). Corpus acta-like sintético determinista + copia local congelada de `senal-lectura.ts`. |

## Cómo reproducir (pasos exactos)

```bash
bun install
# Servir la RAÍZ del repo con COOP/COEP (Cross-Origin-Opener-Policy: same-origin,
# Cross-Origin-Embedder-Policy: require-corp) → numThreads=min(4,cores) como Vercel.
# Abrir: http://localhost:PORT/tools/bench-det1280/bench.html
# Botón «DESCARGAR JSON» manual (§0.2). window.__benchJson = lectura programática.
```

## Qué mide y cómo (protocolo)

1. **Pipeline réplica exacta** de `rapidocr.ts @ b8b3e12`: preDet ops 1-4 (op1 `reduce_max_side`
   1920 INTACTO — es el preprocess fijo del paquete; **op4 usa `DET_CAP`** — `det_limit_side_len`
   es exactamente el parámetro que op4 implementa, `det_limit_type='max'`), DB-postprocess JS puro
   (binarización 0.3 → dilate 2×2 → CCL → convex hull → min-area rect → box_score_fast → unclip 1.6),
   crops desde la FUENTE, cls lote 6 (producción), rec lote 6 con `W=floor(48·max(320/48,r))`,
   BGR `(x/255−0.5)/0.5`, CTC greedy, filtro TEXT_SCORE 0.5. Sesiones det+cls+rec COMPARTIDAS
   entre los 2 caps (solo cambia el pre-det) — misma sesión, misma tabla.
2. **Corpus acta-like SINTÉTICO determinista** (seed `0xe14de7a2`): 4 páginas tira vertical E-14
   1000×2920 (ratio ≈2.92 como las reales): cabecera gruesa (TARJETA ELECTORAL E-14 /
   REGISTRADURIA / CONSULADO-PAÍS / ZONA-PUESTO / MESA / Ver-Pag), grilla 5×6 de votos
   **manuscritos pequeños** (serif itálica 56px con jitter/rotación determinista — el riesgo real
   de B3), banda KIT + código 1D de 15 dígitos, pie SUMA TOTAL. 30 votos/página × 4 = 120 votos,
   valores únicos por página y distintos de los números de cabecera. Cero fotos reales (las valida
   el dueño después).
3. **Métricas por arm:** nº de cajas del det, **votos leídos** (regex `\bvalor\b` sobre el texto
   normalizado — `norm()` idéntica a `senal-lectura.ts`), texto de cabecera (las 10 ANCLAS_LECTURA),
   lectura **FUERTE/MEDIA/DEBIL** con `senalDeLectura` congelada (copia local documentada), ms det/cls/rec.
4. **Esquema escalonado estimado:** página a 2.ª pasada si a 1280 pierde votos o sale DEBIL →
   `msEscalonado = Σ ms@1280 + Σ ms@1920 (2ª pasada)`; ahorro % vs todo-1920.
5. **Protocolo:** por cada arm, pasada caliente descartada + pasada medida. **Determinismo:** ×2 con
   «REPETIR CORRIDA» — métricas de texto EXACTAS y ms dentro de ±10%.

## Veredicto medido (ver REPORTE para la evidencia completa)

**GO** en sandbox 2 núcleos / HeadlessChrome 155 / numThreads=2: 120/120 votos leídos a 1280,
FUERTE 4/4 idénticas, 10/10 anclas por página en ambos caps, 71 cajas/página en AMBOS caps.
det 2461→1074 ms (**−56.4%**, ratio 0.436 ≈ teoría 0.444). Ahorro total del esquema escalonado
en ESTE corpus: ~9-9.5% (rec domina con 30 celdas/página — en actas reales con menos cajas el
share del det es mayor y el ahorro relativo crece). **Advertencia honesta:** el corpus es
sintético — la validación física con fotos reales del dueño es la que manda (kit §4).
