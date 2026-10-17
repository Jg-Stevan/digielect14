# TAREA `FILTROS-1`: Comparativa definitiva — 2 motores OCR × 3 filtros (sin bw) + galería visual + ZIP de evidencias

**Repo:** digielect14 · **Tipo:** SOLO laboratorio/bench — cero cambios de producción
**Objetivo:** elegir la combinación motor+filtro con mejor **lectura/coherencia** sobre fotos reales, y preparar el material para la decisión final **visual** (que la toma el dueño mirando la galería), empaquetando todo en un ZIP.

---

## 1. Contexto (ya medido — NO repetir estos experimentos)

- Ranking de laboratorio previo (4 fotos reales, 14 anclas × 4 fotos = 56): **RapidOCR PP-OCRv4 49/56** · Tesseract tuned 39/56 · Tesseract hoy (bw+1600) 27/56.
- En dispositivo (2 capturas reales): rapidocr+raw = CER 28.0% y 20/24 líneas GT vs rapidocr+bw = 35.1% y 16/24. El downscale a 1600 px cuesta ~3 anclas. bw corrompió datos (KIT 399→300, código 1D con dígito cambiado).
- Referencia limpia de scanner (Frankfurt): RapidOCR crudo det1920 = CER 30.2%, 22/24 líneas, 13/14 anclas, 5/5 números exactos.
- **Sanidad:** si en esta corrida RapidOCR sale con CER > 50% o anclas < 40/56, el setup está mal — detener y revisar antes de continuar.

## 2. Restricciones duras

1. **NO modificar nada de producción**: pipeline, filtros del app, gate, bridge con scanner-core, OCR de producción. Solo archivos nuevos bajo `lab/` (o la carpeta de benchmarks que ya se usó en la tarea anterior).
2. **NO commitear modelos** (ONNX/tessdata) al repo; usar los ya descargados en caché del lab.
3. **Reutilizar** los scripts del laboratorio de la tarea anterior (comparativa de motores) y los GT ya existentes.
4. Los filtros `original` / `texto-claro` / `gris` deben generarse con las **MISMAS funciones del app** (importar; si no se puede, replicar 1:1 con comentario indicando el archivo de origen) para que el resultado sea trasladable a producción.

## 3. Insumos

- **Fotos reales (4):** Frankfurt-P2 foto campo (1) · Frankfurt-P2 foto campo (2) · El-Cairo-P1 (votos a mano) · Frankfurt-P2 limpia (scanner).
- **GT:** lista de 14 anclas por foto + texto GT de 24 líneas de Frankfurt (del lab previo). Para las otras 3 fotos, si no existe texto GT de líneas: generarlo UNA vez (consenso de rapidocr+raw full-res y tesseract-full-res, validado contra anclas y campos) y guardarlo en `lab/gt/<foto>.txt` para reuso futuro.
- **Motores (2):**
  - `rapidocr-v4` — RapidOCR PP-OCRv4, mismo setup del lab (det+cls+rec, det_limit_side_len=1920).
  - `tesseract-tuned` — Tesseract tuned a resolución completa (la config que logró 39/56).

## 4. Matriz de prueba

| Dimensión | Valores |
|---|---|
| Motores | rapidocr-v4, tesseract-tuned |
| Filtros | **original** (recorte sin filtro), **texto-claro** (filtro text del app), **gris** (gray del app). **bw DESCARTADO.** |
| Fotos | 4 |
| Repeticiones | 3 por celda → reportar **mediana** |
| Resolución | recorte a resolución nativa (igual que los recorte-* del dispositivo, ~900×2700). Sin downscale-1600 en la corrida principal. |
| Total | 2 × 3 × 4 = **24 celdas** × 3 runs = **72 inferencias** |

*Extra opcional (no bloqueante): repetir solo la celda ganadora a 1600 px para documentar el costo del downscale en el ganador.*

## 5. Métricas por celda

- **Tiempos (ms, mediana de 3):** build del filtro · carga de modelo (rapidocr) · inferencia · total.
- **Precisión:** CER % vs GT de su foto · anclas X/14 · líneas GT X/24 · números exactos 5/5 (ZONA, PUESTO, MESA, KIT, código 1D de 15 dígitos) · conf media · chars/palabras.
- **Coherencia:** simRef vs consenso de la variante + estabilidad entre runs (delta CER max−min).

## 6. Pasos

1. Leer worklog/artefactos del lab anterior; localizar las 4 fotos, los GT y los scripts reutilizables.
2. Construir variantes: por foto, recorte con el mismo pipeline de crop del lab previo, y generar original / texto-claro / gris con las funciones del app. Guardar JPEG q90 (variantes) + PNG (láminas).
3. Correr la matriz completa (72 inferencias). Un proceso por celda para memoria limpia; log por celda con prefijo `[FILTROS-1]`.
4. Calcular métricas y armar tabla de ranking estilo lab previo (anclas totales /56 y CER promedio por combinación motor×filtro).
5. **Criterio de elección lectura/coherencia:** 1º anclas totales (desempate: líneas GT), 2º CER promedio, 3º tiempo mediana. Reportar ganador general **y** ganador por motor.
6. **Material visual:** por foto, lámina comparativa lado a lado (original | texto-claro | gris) con etiquetas grandes + franja de zoom de zonas críticas (cabecera E-14, fila ZONA/PUESTO/MESA, código 1D). Generar `galeria.html` simple (lado a lado, sin JS complejo) para que el dueño elija el filtro más agradable a la vista. **El agente NO decide lo estético.**
7. **Empaquetar** `comparativa-filtros-e14-YYYYMMDD.zip`:
   - `/variantes` — 12 imágenes (4 fotos × 3 filtros, JPEG q85–90)
   - `/laminas` — láminas comparativas + detalles zoom
   - `/galeria.html`
   - `resultados.json` + `resultados.txt` (mismo estilo del informe telemetría: tablas, ranking, tiempos, CER, recomendación)
   - `/textos` — salida OCR cruda por celda (24 .txt)
   - Meta: **< 30 MB**
8. Dejar copia del reporte TXT+JSON fuera del zip en `lab/resultados/`.
9. Append al worklog (formato estándar) con Task ID `FILTROS-1`.
10. Responder al dueño: tabla de ranking, ganador en lectura/coherencia, ruta del ZIP, y qué observar en la galería.

## 7. Criterios de aceptación

- [ ] 24/24 celdas sin error, 3 runs por celda, medianas reportadas
- [ ] CER calculado contra GT para las 4 fotos
- [ ] Ranking con números comparables al lab previo (rapidocr en el rango 45–52/56)
- [ ] Láminas visuales legibles (etiquetas claras, zonas críticas en zoom)
- [ ] ZIP abre, < 30 MB, contiene todo lo listado
- [ ] `git status` muestra solo archivos nuevos bajo lab/ (producción intacta)
- [ ] Worklog actualizado

## 8. Notas técnicas / pitfalls

- **RapidOCR:** medir carga de modelo SEPARADA de la inferencia (en móvil fue det 1.1–3.1 s + rec 5.0–6.9 s). Reusar la sesión entre fotos para medir inferencia pura y reportar la carga aparte.
- **CER:** normalizar igual que el lab previo (minúsculas, sin acentos, espacios colapsados) para que los números sean comparables.
- **Tesseract tuned full-res es lento** a resolución nativa: si una celda pasa de 60 s, documentarlo — es dato, no bug.
- Verificar que `texto-claro` NO degenere en binarización dura tipo bw (bw fue descartado por corrupción de datos).
- Memoria: procesar foto por foto y liberar (las variantes PNG nativas pesan ~4–6 MB c/u).
- Todo el texto del reporte y las láminas **en español**.
