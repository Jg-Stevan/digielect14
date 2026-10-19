# REPORTE — KIT bench e14-rec-int8-v1 (Agente 2 / Agente B) — Cuantización int8 del rec PP-OCRv4 (SOLO banco de pruebas)

> Rama `bench/e14-rec-int8-v1` (desde main `3ecf046` — post-merge `e14-informe-analisis-v1` y `docs-deploy-vercel`). PR en DRAFT.
> **Naturaleza: instrumento de medición. Cero cambios de producción.** `src/`, `public/`, `next.config.ts`, `vercel.json`, `package.json`/`bun.lock`, `.github/` INTACTOS (diff verificado VACÍO).

## 1. Resumen

Se construyó el banco de pruebas pedido (`tools/bench-rec-int8/`): `cuantizar.py` (T1, cuantización dinámica), `bench.html` (T2, banco standalone en navegador con EP wasm idéntico a producción), `README.md` (T3, reproducción) y esta evidencia. El banco corre fp32 vs int8 sobre un corpus sintético determinista de 60 líneas estilo acta, con el pre/post EXACTO del motor (`rapidocr.ts`: lote de 6 ordenado por ratio, `W = floor(48·max(320/48, ratios))`, tensor NCHW BGR `(x/255−0.5)/0.5`, CTC greedy con `ppocr_keys.txt`), protocolo de 2 pasadas (caliente descartada + medida) y descarga manual del JSON.

**Veredicto con los umbrales del kit §2: NO-GO en los 3 criterios** (en la máquina del agente). La cuantización dinámica QUInt8 del rec NO acelera en EP wasm (0.96×, requiere ≥1.3×), degrada el texto (10% idéntico, requiere ≥99%) y baja la conf media 13.2 puntos (permite ≤0.5). Además, la variante QInt8 literal del kit produce **salida degenerada** (texto vacío) — hallazgo documentado con doble verificación (CPU EP y wasm EP).

Decisión que este kit NO toma (kit §0.1): la adopción se decidiría con otro kit; aquí solo queda evidencia. Con estos números, la idea de int8 dinámico del rec queda SIN SOPORTE PARA AVANZAR (NO-GO), salvo que la máquina del dueño diga lo contrario.

## 2. Whitelist vs diff real

| Archivo (kit §1) | Estado |
|---|---|
| `tools/bench-rec-int8/cuantizar.py` | NUEVO ✓ |
| `tools/bench-rec-int8/bench.html` | NUEVO ✓ |
| `tools/bench-rec-int8/README.md` | NUEVO ✓ |
| `.gitignore` | +2 líneas (comentario + `tools/bench-rec-int8/*.onnx`) ✓ |
| `docs/REPORTE-e14-bench-rec-int8-v1.md` | NUEVO ✓ (este archivo) |
| `docs/worklog.md`, `AGENTS.md`, `docs/ROADMAP.md` | entradas append ✓ |
| `docs/DECISIONS.md` | NO tocado ✓ (sin decisión, solo evidencia) |

- `git diff main --stat -- src/ public/ next.config.ts vercel.json` → **VACÍO** (verificado §4.2).
- Artifact `.onnx` NO commiteado: `git status` no los lista; `git check-ignore` confirma los 3 (`*_infer.onnx` copia, `*_preprocesado.onnx` intermedio, `*_int8.onnx` generado).
- `package.json`/`bun.lock` INTACTOS; dependencias de python (`onnxruntime` 1.31.0, `onnx` 1.23.2) SOLO tooling local del banco.

## 3. Verificación §4 (en orden)

1. `bun run lint` → 0 errores, 0 warnings · `bunx tsc --noEmit` → 0 · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` → OK (3 páginas estáticas; `tools/` no entra en el build).
2. Diff de producción CERO (tabla §2).
3. Corrida completa del banco con ambos modelos → JSON §4.
4. **Determinismo:** 2 corridas → `pctTextoIdéntico` 10% y `lineasIdenticas` 6/60 y `deltaConf` 13.198 EXACTAMENTE iguales; ms: fp32 5606.1→5151.5 (−8.1%), int8 5837.5→6119.5 (+4.8%) — dentro del ±10% permitido.
5. `git status`: solo `M .gitignore` + `?? tools/` — ningún `.onnx` como candidato a commit ✓.

## 4. JSON del banco (corrida medida — completo)

Hardware del agente: **2 núcleos lógicos** (sandbox: `navigator.hardwareConcurrency=2` → `numThreads=min(4,2)=2`, `crossOriginIsolated=true` vía COOP/COEP del servidor estático) · Navegador: **HeadlessChrome/155.0.0.0** (X11; Linux x86_64) — mismo motor Chrome que el dueño (Chrome 155). ORT-web 1.30.0 con binarios vendidos byte-idénticos (`public/vendor/onnxruntime/`).

```json
{
  "hardware": "2 núcleos lógicos (navigator.hardwareConcurrency)",
  "navegador": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
  "numThreads": 2,
  "corpus": 60,
  "fp32": {
    "msTotal": 5606.1,
    "msPorLinea": 93.435,
    "confMedia": 0.9761,
    "lineasAceptadasTEXT05": 60,
    "accTextoGT": 23.33
  },
  "int8": {
    "msTotal": 5837.5,
    "msPorLinea": 97.292,
    "confMedia": 0.8441,
    "lineasAceptadasTEXT05": 60,
    "accTextoGT": 8.33
  },
  "comparacion": {
    "pctTextoIdéntico": 10,
    "deltaConf": 13.198,
    "lineasIdenticas": 6,
    "speedup": 0.96
  },
  "umbrales": {
    "velocidadMin": "1.3x",
    "textoIdenticoMin": "99%",
    "deltaConfMaxPuntos": 0.5
  },
  "verdicto": "NO-GO",
  "ortWeb": "?",
  "ep": "wasm (vendido public/vendor/onnxruntime/, byte-idéntico a onnxruntime-web 1.30.0)",
  "crossOriginIsolated": true,
  "fecha": "2026-10-19T20:11:35.038Z"
}
```

<details>
<summary><strong>detalle (60 líneas, mismo orden para ambos modelos)</strong> — expandir</summary>

```json
[
  {
    "i": 0,
    "esperado": "ACTA 352 DE 5827 - MESA 83",
    "fp32": {
      "texto": "ACTA 352 DE 5827 - MESA 83",
      "conf": 0.978
    },
    "int8": {
      "texto": "ACTA 352 DE 5827 - MESA 83",
      "conf": 0.9022
    },
    "identico": true
  },
  {
    "i": 1,
    "esperado": "PUESTO 15565 MUNICIPIO 809 DEPARTAMENTO 90",
    "fp32": {
      "texto": "PUESTO 15565 MUNICIPI0 809 DEPARTAMENT0 90",
      "conf": 0.9817
    },
    "int8": {
      "texto": "PUESTO 15565 MUNICIPIO 89 DEPARTAMENTO 90",
      "conf": 0.8536
    },
    "identico": false
  },
  {
    "i": 2,
    "esperado": "FECHA 66/54/2004 HORA 48:08",
    "fp32": {
      "texto": "FECHA 66/54/2004 H0RA 48:08",
      "conf": 0.9922
    },
    "int8": {
      "texto": "FfCHA 66/54/26θ4 HORA 4:08",
      "conf": 0.7433
    },
    "identico": false
  },
  {
    "i": 3,
    "esperado": "TRANSMISION 389964 5656 ESTADO OK",
    "fp32": {
      "texto": "TRANSMISION 389964 5656 ESTAD0 0K",
      "conf": 0.9748
    },
    "int8": {
      "texto": "TRANSMISION 389964 5656 ESTAD0 0K",
      "conf": 0.8401
    },
    "identico": true
  },
  {
    "i": 4,
    "esperado": "CODIGO E14 0152491604897",
    "fp32": {
      "texto": "CODIG0 E14 0152491604897",
      "conf": 0.9857
    },
    "int8": {
      "texto": "CODIG0 E14 @152491664897",
      "conf": 0.8391
    },
    "identico": false
  },
  {
    "i": 5,
    "esperado": "TOTAL VOTOS 0149 5099 801 30",
    "fp32": {
      "texto": "TOTAL VOT0S 0149 5099 801 30",
      "conf": 0.9398
    },
    "int8": {
      "texto": "TOTAL VoT0S 0149 5099 801 30",
      "conf": 0.7973
    },
    "identico": false
  },
  {
    "i": 6,
    "esperado": "TESTIGO 10746 FIRMA 605469 49",
    "fp32": {
      "texto": "TESTIG0 10746 FIRMA 605469 49",
      "conf": 0.9937
    },
    "int8": {
      "texto": "TESTIG0 1@746 FIRMA 6@5469 49",
      "conf": 0.9089
    },
    "identico": false
  },
  {
    "i": 7,
    "esperado": "URNA 4913 - SUFRAGIOS 0014 - BLANCOS 646",
    "fp32": {
      "texto": "URNA 4913 - SUFRAGI0S 0014 - BLANCOS 646",
      "conf": 0.967
    },
    "int8": {
      "texto": "URNA 4913 - SUFRAGIOS @014 - BLANCOS 646",
      "conf": 0.8764
    },
    "identico": false
  },
  {
    "i": 8,
    "esperado": "CANDIDATO 796 VOTOS 6873 PUESTO 44",
    "fp32": {
      "texto": "CANDIDAT0 796 VOT0S 6873 PUEST0 44",
      "conf": 0.9457
    },
    "int8": {
      "texto": "CANDIDAT0796 V0TOS 6873 PUEST0 44",
      "conf": 0.8723
    },
    "identico": false
  },
  {
    "i": 9,
    "esperado": "DIGIELECT VERIF 47:69:33 LOTE 999",
    "fp32": {
      "texto": "DIGIELECT VERIF 47:69:33 LOTE 999",
      "conf": 0.9967
    },
    "int8": {
      "texto": "dIGIELECT VErIf 47:69:33 LoTE 999",
      "conf": 0.8042
    },
    "identico": false
  },
  {
    "i": 10,
    "esperado": "ACTA 230 DE 1743 - MESA 49",
    "fp32": {
      "texto": "ACTA 230 DE 1743 - MESA 49",
      "conf": 0.9739
    },
    "int8": {
      "texto": "ACTA 23θ DF 1743 - MESA 49",
      "conf": 0.8854
    },
    "identico": false
  },
  {
    "i": 11,
    "esperado": "PUESTO 95577 MUNICIPIO 949 DEPARTAMENTO 15",
    "fp32": {
      "texto": "PUESTO 95577 MUNICIPI0 949 DEPARTAMENT0 15",
      "conf": 0.9765
    },
    "int8": {
      "texto": "PUESTO 95577 MUNICIPIO 949 DEPARTAMENTO 15",
      "conf": 0.8913
    },
    "identico": false
  },
  {
    "i": 12,
    "esperado": "FECHA 28/65/2090 HORA 91:95",
    "fp32": {
      "texto": "FECHA 28/65/2090 H0RA 91:95",
      "conf": 0.9835
    },
    "int8": {
      "texto": "FECHA 28/65/209@ HoRA 91:95",
      "conf": 0.7823
    },
    "identico": false
  },
  {
    "i": 13,
    "esperado": "TRANSMISION 234332 2558 ESTADO OK",
    "fp32": {
      "texto": "TRANSMISION 234332 2558 ESTAD0 OK",
      "conf": 0.9792
    },
    "int8": {
      "texto": "TRANSMISIOn 234332 2558 ESTAD00K",
      "conf": 0.8484
    },
    "identico": false
  },
  {
    "i": 14,
    "esperado": "CODIGO E14 2421077206021",
    "fp32": {
      "texto": "CODIG0 E14 2421077206021",
      "conf": 0.9796
    },
    "int8": {
      "texto": "CODIG0 E14 2421θ77266θ21",
      "conf": 0.7807
    },
    "identico": false
  },
  {
    "i": 15,
    "esperado": "TOTAL VOTOS 0426 8561 727 71",
    "fp32": {
      "texto": "TOTAL VOT0S 0426 8561 727 71",
      "conf": 0.9517
    },
    "int8": {
      "texto": "TOTAl VoT0S @426 8561 727 71",
      "conf": 0.8508
    },
    "identico": false
  },
  {
    "i": 16,
    "esperado": "TESTIGO 43997 FIRMA 213028 68",
    "fp32": {
      "texto": "TESTIG0 43997 FIRMA 213028 68",
      "conf": 0.9758
    },
    "int8": {
      "texto": "TESTIG0 43997 FIRMA 213028 68",
      "conf": 0.8903
    },
    "identico": true
  },
  {
    "i": 17,
    "esperado": "URNA 6058 - SUFRAGIOS 9528 - BLANCOS 361",
    "fp32": {
      "texto": "URNA 6058 - SUFRAGI0S 9528 - BLANCOS 361",
      "conf": 0.9746
    },
    "int8": {
      "texto": "URNA 6658 - SUFRAGIOS 9528 - BLANC0S 361",
      "conf": 0.8348
    },
    "identico": false
  },
  {
    "i": 18,
    "esperado": "CANDIDATO 316 VOTOS 9947 PUESTO 82",
    "fp32": {
      "texto": "CANDIDAT0 316 VOTOS 9947 PUEST0 82",
      "conf": 0.9632
    },
    "int8": {
      "texto": "CANDIDATO 316 YOTOS 9947PUEST0 82",
      "conf": 0.8766
    },
    "identico": false
  },
  {
    "i": 19,
    "esperado": "DIGIELECT VERIF 52:79:04 LOTE 990",
    "fp32": {
      "texto": "DIGIELECT VERIF 52:79:04 LOTE 990",
      "conf": 0.9919
    },
    "int8": {
      "texto": "dIGIELECT VErIF 52: 79:@4 LOTE 990",
      "conf": 0.8125
    },
    "identico": false
  },
  {
    "i": 20,
    "esperado": "ACTA 153 DE 4998 - MESA 64",
    "fp32": {
      "texto": "ACTA 153 DE 4998 - MESA 64",
      "conf": 0.977
    },
    "int8": {
      "texto": "ACTA 153 DF 4998 - MESA 64",
      "conf": 0.9103
    },
    "identico": false
  },
  {
    "i": 21,
    "esperado": "PUESTO 43948 MUNICIPIO 519 DEPARTAMENTO 65",
    "fp32": {
      "texto": "PUESTO 43948 MUNICIPI0 519 DEPARTAMENT0 65",
      "conf": 0.9795
    },
    "int8": {
      "texto": "PUESTO 43948 MUNICIPI0 519 DEPARTAMENTO 65",
      "conf": 0.9029
    },
    "identico": false
  },
  {
    "i": 22,
    "esperado": "FECHA 61/28/2010 HORA 86:56",
    "fp32": {
      "texto": "FECHA 61/28/2010 H0RA 86:56",
      "conf": 0.9601
    },
    "int8": {
      "texto": "FfCHA 61/28/201θ HORA 86:56",
      "conf": 0.8299
    },
    "identico": false
  },
  {
    "i": 23,
    "esperado": "TRANSMISION 479800 2829 ESTADO OK",
    "fp32": {
      "texto": "TRANSMISION 479800 2829 ESTAD0 0K",
      "conf": 0.9798
    },
    "int8": {
      "texto": "TRANSMISION 4798@ 2829 ESTAD00K",
      "conf": 0.7669
    },
    "identico": false
  },
  {
    "i": 24,
    "esperado": "CODIGO E14 4419254372378",
    "fp32": {
      "texto": "CODIG0 E14 4419254372378",
      "conf": 0.993
    },
    "int8": {
      "texto": "CoDIG0 E14 4419254372378",
      "conf": 0.8625
    },
    "identico": false
  },
  {
    "i": 25,
    "esperado": "TOTAL VOTOS 3468 2862 098 46",
    "fp32": {
      "texto": "TOTAL V0T0S 3468 2862 098 46",
      "conf": 0.9577
    },
    "int8": {
      "texto": "TOTAl voT0S 3468 2862 098 461",
      "conf": 0.8048
    },
    "identico": false
  },
  {
    "i": 26,
    "esperado": "TESTIGO 51482 FIRMA 606299 25",
    "fp32": {
      "texto": "TESTIGO 51482 FIRMA 606299 25",
      "conf": 0.9771
    },
    "int8": {
      "texto": "TESTIG0 51482 FIRMA 6@6299 25",
      "conf": 0.888
    },
    "identico": false
  },
  {
    "i": 27,
    "esperado": "URNA 7168 - SUFRAGIOS 1898 - BLANCOS 489",
    "fp32": {
      "texto": "URNA 7168 - SUFRAGI0S 1898 - BLANCOS 489",
      "conf": 0.9795
    },
    "int8": {
      "texto": "uRNA 7168 - SUFRAGIOS 1898 - BLANCOS 489",
      "conf": 0.8335
    },
    "identico": false
  },
  {
    "i": 28,
    "esperado": "CANDIDATO 046 VOTOS 3286 PUESTO 05",
    "fp32": {
      "texto": "CANDIDAT0 046 VOTOS 3286 PUEST0 05",
      "conf": 0.9435
    },
    "int8": {
      "texto": "CANDIDAT0 @46 V0TOS 3286 PUEST0 05",
      "conf": 0.7962
    },
    "identico": false
  },
  {
    "i": 29,
    "esperado": "DIGIELECT VERIF 54:52:29 LOTE 081",
    "fp32": {
      "texto": "DIGIELECT VERIF 54:52:29 LOTE 081",
      "conf": 0.9906
    },
    "int8": {
      "texto": "dIGIELECT VERIF 54:52:29 LOTE 081",
      "conf": 0.8703
    },
    "identico": false
  },
  {
    "i": 30,
    "esperado": "ACTA 468 DE 9622 - MESA 18",
    "fp32": {
      "texto": "ACTA 468 DE 9622 - MESA 18",
      "conf": 0.9838
    },
    "int8": {
      "texto": "ACTA 468 DE 9622 - MESA 18",
      "conf": 0.9208
    },
    "identico": true
  },
  {
    "i": 31,
    "esperado": "PUESTO 28934 MUNICIPIO 581 DEPARTAMENTO 26",
    "fp32": {
      "texto": "PUESTO 28934 MUNICIPI0 581 DEPARTAMENT0 26",
      "conf": 0.9784
    },
    "int8": {
      "texto": "PUESTO 28934 MUNICIPIO 581 DEPARTAMENTO 26",
      "conf": 0.8487
    },
    "identico": false
  },
  {
    "i": 32,
    "esperado": "FECHA 88/37/2042 HORA 88:46",
    "fp32": {
      "texto": "FECHA 88/37/2042 H0RA 88:46",
      "conf": 0.9931
    },
    "int8": {
      "texto": "FfCHA /37/2042 HORA 8: 46",
      "conf": 0.7338
    },
    "identico": false
  },
  {
    "i": 33,
    "esperado": "TRANSMISION 606998 0703 ESTADO OK",
    "fp32": {
      "texto": "TRANSMISION 606998 0703 ESTAD0 0K",
      "conf": 0.9878
    },
    "int8": {
      "texto": "TRANSMIS10n 606998 @763 ESTAD00K",
      "conf": 0.7468
    },
    "identico": false
  },
  {
    "i": 34,
    "esperado": "CODIGO E14 9132898384356",
    "fp32": {
      "texto": "CODIG0 E14 9132898384356",
      "conf": 0.9924
    },
    "int8": {
      "texto": "C0bIG0 E14 9132898384356",
      "conf": 0.8739
    },
    "identico": false
  },
  {
    "i": 35,
    "esperado": "TOTAL VOTOS 3482 4141 743 18",
    "fp32": {
      "texto": "TOTAL V0T0S 3482 4141 743 18",
      "conf": 0.9675
    },
    "int8": {
      "texto": "TOTAl VoT0S 3482 4141 743 18",
      "conf": 0.8744
    },
    "identico": false
  },
  {
    "i": 36,
    "esperado": "TESTIGO 61366 FIRMA 566861 64",
    "fp32": {
      "texto": "TESTIG0 61366 FIRMA 566861 64",
      "conf": 0.9934
    },
    "int8": {
      "texto": "TESTIG0 61366 FIRMA 566861 64",
      "conf": 0.94
    },
    "identico": true
  },
  {
    "i": 37,
    "esperado": "URNA 4158 - SUFRAGIOS 3782 - BLANCOS 998",
    "fp32": {
      "texto": "URNA 4158 - SUFRAGI0S 3782 - BLANCOS 998",
      "conf": 0.9711
    },
    "int8": {
      "texto": "URNA 4158 - SUFRAGIOS 3782 - BLANCOS 998",
      "conf": 0.8676
    },
    "identico": false
  },
  {
    "i": 38,
    "esperado": "CANDIDATO 349 VOTOS 8463 PUESTO 68",
    "fp32": {
      "texto": "CANDIDAT0 349 VOTOS 8463 PUEST0 68",
      "conf": 0.9539
    },
    "int8": {
      "texto": "CANDIDAT0 349 V0TOS 8463 PUEST0 68",
      "conf": 0.8638
    },
    "identico": false
  },
  {
    "i": 39,
    "esperado": "DIGIELECT VERIF 79:19:74 LOTE 684",
    "fp32": {
      "texto": "DIGIELECT VERIF 79:19:74 LOTE 684",
      "conf": 0.9931
    },
    "int8": {
      "texto": "dIGIELECT VErIF 79f19:74 LOTE 684",
      "conf": 0.824
    },
    "identico": false
  },
  {
    "i": 40,
    "esperado": "ACTA 625 DE 6112 - MESA 94",
    "fp32": {
      "texto": "ACTA 625 DE 6112 - MESA 94",
      "conf": 0.9823
    },
    "int8": {
      "texto": "ACTA 625 DF 6112 - MESA 94",
      "conf": 0.9015
    },
    "identico": false
  },
  {
    "i": 41,
    "esperado": "PUESTO 45518 MUNICIPIO 614 DEPARTAMENTO 14",
    "fp32": {
      "texto": "PUESTO 45518 MUNICIPI0 614 DEPARTAMENT0 14",
      "conf": 0.9585
    },
    "int8": {
      "texto": "PUESTO 45518 MUNICIPI0 614 DEPARTAMENTO 14",
      "conf": 0.8896
    },
    "identico": false
  },
  {
    "i": 42,
    "esperado": "FECHA 25/82/2014 HORA 95:61",
    "fp32": {
      "texto": "FECHA 25/82/2014 H0RA 95:61",
      "conf": 0.9811
    },
    "int8": {
      "texto": "FECHA 25/82/2014 HORA 9:61",
      "conf": 0.8192
    },
    "identico": false
  },
  {
    "i": 43,
    "esperado": "TRANSMISION 533618 4230 ESTADO OK",
    "fp32": {
      "texto": "TRANSMISION 533618 4230 ESTAD0 0K",
      "conf": 0.9811
    },
    "int8": {
      "texto": "TRANSMISION 533618 423 FSTAD0 0K",
      "conf": 0.8372
    },
    "identico": false
  },
  {
    "i": 44,
    "esperado": "CODIGO E14 7327963463030",
    "fp32": {
      "texto": "CODIG0 E14 7327963463030",
      "conf": 0.9858
    },
    "int8": {
      "texto": "C0bIG0 E14 7327963463030",
      "conf": 0.8512
    },
    "identico": false
  },
  {
    "i": 45,
    "esperado": "TOTAL VOTOS 7657 5990 273 88",
    "fp32": {
      "texto": "TOTAL VOTOS 7657 5990 273 88",
      "conf": 0.9255
    },
    "int8": {
      "texto": "ToTAl voToS 7657 5990 273 88",
      "conf": 0.8508
    },
    "identico": false
  },
  {
    "i": 46,
    "esperado": "TESTIGO 73173 FIRMA 154133 01",
    "fp32": {
      "texto": "TESTIG0 73173 FIRMA 154133 01",
      "conf": 0.9738
    },
    "int8": {
      "texto": "TESTIG0 73173 FIRMA 154133 01",
      "conf": 0.8905
    },
    "identico": true
  },
  {
    "i": 47,
    "esperado": "URNA 5351 - SUFRAGIOS 5553 - BLANCOS 001",
    "fp32": {
      "texto": "URNA 5351 - SUFRAGI0S 5553 - BLANCOS 001",
      "conf": 0.9618
    },
    "int8": {
      "texto": "URNA 5351 - SUFRAGIOS 5553 - BLANCOS 0θ1",
      "conf": 0.8413
    },
    "identico": false
  },
  {
    "i": 48,
    "esperado": "CANDIDATO 666 VOTOS 0564 PUESTO 48",
    "fp32": {
      "texto": "CANDIDAT0 666 VOTOS 0564 PUEST0 48",
      "conf": 0.9597
    },
    "int8": {
      "texto": "CANDIDATO 666 VOTOS @564 PUEST0 48",
      "conf": 0.8449
    },
    "identico": false
  },
  {
    "i": 49,
    "esperado": "DIGIELECT VERIF 09:80:22 LOTE 494",
    "fp32": {
      "texto": "DIGIELECT VERIF 09:80:22 LOTE 494",
      "conf": 0.9939
    },
    "int8": {
      "texto": "DIGIELECT VERIF θ9:80:22 LOTE 494",
      "conf": 0.8456
    },
    "identico": false
  },
  {
    "i": 50,
    "esperado": "ACTA 275 DE 1407 - MESA 98",
    "fp32": {
      "texto": "ACTA 275 DE 1407 - MESA 98",
      "conf": 0.9775
    },
    "int8": {
      "texto": "ACTA 275 DF 1407 - MESA 98",
      "conf": 0.8488
    },
    "identico": false
  },
  {
    "i": 51,
    "esperado": "PUESTO 28599 MUNICIPIO 395 DEPARTAMENTO 00",
    "fp32": {
      "texto": "PUESTO 28599 MUNICIPI0 395 DEPARTAMENT0 00",
      "conf": 0.9798
    },
    "int8": {
      "texto": "PUEST0 28599 MUNICIP10 395 DEPARTAMENTO 00",
      "conf": 0.829
    },
    "identico": false
  },
  {
    "i": 52,
    "esperado": "FECHA 59/18/2068 HORA 94:07",
    "fp32": {
      "texto": "FECHA 59/18/2068 H0RA 94:07",
      "conf": 0.9862
    },
    "int8": {
      "texto": "FfCHA 59/18/2068 HORA 94:07",
      "conf": 0.7488
    },
    "identico": false
  },
  {
    "i": 53,
    "esperado": "TRANSMISION 988098 2602 ESTADO OK",
    "fp32": {
      "texto": "TRANSMISION 988098 2602 ESTAD0 0K",
      "conf": 0.989
    },
    "int8": {
      "texto": "TRANSMISIOn 988θ98 26θ2 ESTAD00K",
      "conf": 0.7787
    },
    "identico": false
  },
  {
    "i": 54,
    "esperado": "CODIGO E14 0216687098774",
    "fp32": {
      "texto": "CODIG0 E14 0216687098774",
      "conf": 0.9958
    },
    "int8": {
      "texto": "CoDIG0 E14 @216687098774",
      "conf": 0.8414
    },
    "identico": false
  },
  {
    "i": 55,
    "esperado": "TOTAL VOTOS 2138 5150 390 39",
    "fp32": {
      "texto": "TOTAL V0T0S 2138 5150 390 39",
      "conf": 0.9793
    },
    "int8": {
      "texto": "TOTAl VoT0S 2138 5150 390 391",
      "conf": 0.7984
    },
    "identico": false
  },
  {
    "i": 56,
    "esperado": "TESTIGO 33480 FIRMA 179172 98",
    "fp32": {
      "texto": "TESTIG0 33480 FIRMA 179172 98",
      "conf": 0.9815
    },
    "int8": {
      "texto": "TESTIG0 33486 FIRMA 179172 98",
      "conf": 0.8806
    },
    "identico": false
  },
  {
    "i": 57,
    "esperado": "URNA 3703 - SUFRAGIOS 1627 - BLANCOS 790",
    "fp32": {
      "texto": "URNA 3703 - SUFRAGI0S 1627 - BLANCOS 790",
      "conf": 0.979
    },
    "int8": {
      "texto": "uRNA 3703 - SUFRAGI0S 1627 - BLANCOS 79@",
      "conf": 0.8471
    },
    "identico": false
  },
  {
    "i": 58,
    "esperado": "CANDIDATO 250 VOTOS 2507 PUESTO 82",
    "fp32": {
      "texto": "CANDIDATO 250 VOTOS 2507 PUEST0 82",
      "conf": 0.9446
    },
    "int8": {
      "texto": "CANDIDAT0 250 VOTOS 2507 PUEST0 82",
      "conf": 0.8152
    },
    "identico": false
  },
  {
    "i": 59,
    "esperado": "DIGIELECT VERIF 45:37:55 LOTE 772",
    "fp32": {
      "texto": "DIGIELECT VERIF 45:37:55 LOTE 772",
      "conf": 0.9902
    },
    "int8": {
      "texto": "DIGIELECT VErIF 45:37:55 L0TE 772",
      "conf": 0.8353
    },
    "identico": false
  }
]
```
</details>

## 5. Tabla fp32 vs int8

| Métrica | fp32 (original) | int8 (QUInt8) | Criterio kit §2 | ¿Cumple? |
|---|---|---|---|---|
| Peso | 10.35 MiB (10.86 MB) | **2.75 MiB (2.88 MB, −73.5%)** | (informativo) | — |
| ms total (60 líneas) | 5606.1 | 5837.5 | — | — |
| **ms/línea** | 93.44 | 97.29 | speedup ≥ 1.3× | ❌ **0.96×** |
| conf media | 97.61% | 84.41% | \|Δ\| ≤ 0.5 puntos | ❌ **Δ 13.198** |
| **texto idéntico** | — | 6/60 | ≥ 99% | ❌ **10%** |
| aceptadas TEXT_SCORE 0.5 | 60/60 | 60/60 | (informativo) | — |
| acc vs ground truth (exacta) | 23.33% | 8.33% | (informativo) | — |

**Veredicto: NO-GO** (falla cualquiera → NO-GO; aquí fallan los tres).

Lectura del detalle: fp32 lee el corpus casi perfecto (única desviación sistemática: `O`↔`0`, ambigüedad de la fuente monospace — p. ej. `MUNICIPI0`); int8 QUInt8 introduce ERRORES REALES en lo crítico de un acta (números/códigos): `809→89`, `2004→26θ4`, `48:08→4:08`, `0152491604897→@152491664897`, con conf ~0.74-0.85. La pérdida de dígitos en actas es exactamente lo que el dueño NO puede permitirse.

## 6. Hallazgo adicional — QInt8 (literal del kit) produce salida degenerada

El kit §3-T1 pedía `weight_type=QuantType.QInt8`. Con QInt8 el modelo cuantizado CREA sesión sin error pero **decodifica texto vacío con conf 0.0000 en TODAS las líneas** — verificado por partida doble con el preprocess idéntico al motor:

| Runtime | Modelo | Texto (línea `PUESTO 15565 MUNICIPIO 809 DEPARTAMENTO 90`) | conf |
|---|---|---|---|
| CPU EP (python, onnxruntime 1.31.0) | fp32 | `PUESTO 15565 MUNICIPI0 809 DEPARTAMENT0 90` | 0.9660 |
| CPU EP (python, onnxruntime 1.31.0) | QInt8 | `` (vacío) | 0.0000 |
| CPU EP (python, onnxruntime 1.31.0) | **QUInt8** | `PUESTO 15565 MUNICIPI0 809 DEPARTAMENTO 90` | 0.7911 |
| EP wasm del banco (ort-web 1.30.0) | QInt8 | `` (vacío) — 0/60 líneas, conf media 0 | 0.0000 |

NO es un bug del banco ni del EP wasm: es el artifact QInt8. Se aplicó el fallback EXPLÍCITO del kit §3-T2.7 (`QuantType.QUInt8`), que sí decodifica, y ese es el artifact del banco. Implicación práctica: si algún día se re-intenta int8 dinámico en este repo, la variante viable es QUInt8 — y aun así NO-GO según §5.

## 7. Desviaciones (kit §0.4)

1. **T1: paso previo oficial de ORT obligatorio.** `quantize_dynamic` directo falla con `ValueError: Expected conv2d_157.w_0 to be an initializer` (export Paddle2ONNX: pesos como nodos `Constant`, no initializers). `cuantizar.py` integra `onnxruntime.quantization.preprocess` (lo recomienda el propio warning de ORT) con `--skip_symbolic_shape` (el shape inference simbólico aborta con «Incomplete symbolic shape inference» con este modelo).
2. **T1: QInt8 → QUInt8** (fallback §3-T2.7) por la salida degenerada de QInt8 (§6).
3. **T2: `wasmPaths` resuelto desde la PÁGINA.** La ruta relativa literal del kit (`../../public/vendor/onnxruntime/`) la resuelve el build ESM de ORT contra la URL del MÓDULO (`node_modules/onnxruntime-web/dist/`), produciendo `/node_modules/public/vendor/…` (error capturado: «no available backend found… Failed to fetch dynamically imported module …/node_modules/public/vendor/onnxruntime/ort-wasm-simd-threaded.mjs»). El banco usa el MISMO literal resuelto explícitamente: `new URL("../../public/vendor/onnxruntime/", location.href).href` — mismo directorio vendido, byte-idéntico.
4. **T2: el banco omite `ort.env.wasm.proxy`.** El motor lo usa para no bloquear el main thread; el kit no lo exige y no afecta cifras (solo quién ejecuta la inferencia). Documentado en README.
5. **Interpretación de «delta ≤ 0.5 puntos»:** conf en escala 0-100 (puntos porcentuales). El JSON publica `confMedia` sin escala para re-evaluar si el dueño prefiere otra lectura.
6. **Importación de ORT en la página standalone:** desde `node_modules/onnxruntime-web/dist/ort.wasm.min.mjs` (misma versión 1.30.0 fijada en package.json — los binarios vendidos son byte-idénticos, `cmp` verificado). Requiere `bun install` previo; documentado en README. Sin CDN (determinismo/offline).

Ninguna otra desviación. `src/` y el resto de zonas prohibidas intocadas.

## 8. Pasos para el dueño

1. `bun install` (si no está) y leer `tools/bench-rec-int8/README.md`.
2. Regenerar artifact y correr el banco en **SU máquina (4 núcleos / 8 GB / Chrome 155)** — los números que deciden son los suyos:
   ```bash
   cp public/models/rapidocr/ch_PP-OCRv4_rec_infer.onnx tools/bench-rec-int8/
   pip install onnxruntime onnx
   python3 tools/bench-rec-int8/cuantizar.py
   # servir la RAÍZ del repo estático con COOP/COEP (para numThreads=4) y abrir
   # http://localhost:PORT/tools/bench-rec-int8/bench.html → «DESCARGAR JSON»
   ```
3. Si SU corrida también da NO-GO (esperable: las 3 brechas son grandes): archivar la idea int8 del rec (o explorar otra variante con OTRO kit — p. ej. rec fp16 o modelo más pequeño, fuera del alcance de este kit).
4. El speedup del rec NO es el único camino de reducción (mandato «toca reducir más los tiempos»): el worklog y el ROADMAP recogen las palancas restantes (p. ej. pre-warm del OCR, batching ya presente, paralelismo de actas).

— Agente 2 (Agente B), sesión sandbox, `2026-10-19` (Bogotá). Banco ejecutado íntegro en navegador real (HeadlessChrome 155); evidencia: este reporte + `tools/bench-rec-int8/README.md` + docs/worklog.md.
