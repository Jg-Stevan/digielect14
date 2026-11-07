# Ventana §6.7 — orden por defecto de motores (C3/C4/C5)

> Estado: **abierta** desde el 2026-11-07 (deploys de C1/C2 live). No se toca
> el default hasta cerrarla. Decisión registrada en `DECISIONS.md` **D85**.

## 1 · Qué se mide y por qué

El router OCR murió (§4.1 del mapa v2.3) y con él sus priors: la cascada
decide **después** de leer, contra el gate del acta. Falta fijar con datos el
**orden por defecto** de motores. El criterio es uno solo:

> **min ms/acta aceptada, con falso-acepto = 0.**

- *ms/acta aceptada*: coste total de lectura (todas las etapas intentadas,
  incluida la ganadora; ecos agregados excluidos) dividido entre las actas
  que ese motor aceptó. Lo computa `agregarLecturas()` del paquete.
- *falso-acepto*: acta que el gate marcó AUTO y que en revisión humana no lo
  era. **Un solo falso-acepto descalifica al candidato**, por rápido que sea.

## 2 · De dónde salen los números

La telemetría se emite por acta y se persiste en dos superficies:

| Producto | Dónde vive | Cómo se saca |
|---|---|---|
| digielect14 (móvil) | `PerfActa.lectura` en el buffer `e14-obs` | Reporte de observabilidad (JSON/ZIP): campo `lecturaResumen` |
| supervision-e14 (masiva) | `MetricaActa.lectura` en `e14-masiva-metricas-v1` | Informe de la corrida (JSON): `actas[].lectura` + `lecturaResumen` |

Ambos agregados tienen la misma forma:

```json
{
  "actas": 512, "aceptadas": 508, "sinAceptante": 4,
  "porAceptante": {
    "rapidocr": { "actas": 505, "intentos": 731, "msTotal": 1010000,
                  "msPorActa": 2000, "msPorMotor": { "rapidocr": 940000, "tesseract": 70000 } }
  }
}
```

`msPorActa` es el número de la comparación; `msPorMotor` explica de dónde
sale (cuánto se gastó en el motor que perdió el gate).

## 3 · Cómo se corre la ventana

1. **Deploys live**: ambos productos con C1/C2 en producción (verificado el
   2026-11-07 — D `Deploy to GitHub Pages` y S `Deploy Cloudflare Pages` en
   verde sobre `main`).
   > Nota operativa (2026-11-07): el primer deploy de D sobre `main` se
   > atascó en Pages — `actions/deploy-pages` creaba el deployment pero
   > GitHub nunca lo procesaba (`Current status:` vacío hasta el timeout de
   > 10 min). La versión de Pages es el SHA del commit, así que reintentar el
   > MISMO commit reutiliza la versión atascada y vuelve a fallar: la
   > republicación se dispara con un commit nuevo. La ventana de D cuenta
   > desde el deploy que sale en verde, no desde el merge.
2. **Uso normal**: no se cambia ningún flag ni la config de motores durante
   la ventana — la ventana mide el default vigente.
3. **Exportar periódicamente** (semanal): el buffer `e14-obs` retiene 500
   eventos / 30 días (tope del contrato §4.1). Cada export trae el agregado
   de lo retenido; para acumular varias semanas se suman los agregados de
   las exportaciones sucesivas (campos aditivos, sin doble conteo por
   acta). **No** usar «vaciar después de descargar» durante la ventana.
4. **Cierre**: ≥ 2 semanas **o** ≥ 500 actas aceptadas **por producto**, lo
   que llegue primero.
5. **Falso-acepto**: sobre una muestra de las actas AUTO de cada motor
   (mínimo 50 por motor), revisión humana contra el acta física. El sample
   se declara en el mismo informe del cierre.

## 4 · Qué se decide al cerrar (C4/C5)

- Si un candidato cumple **falso-acepto = 0** y su `msPorActa` mejora al
  default vigente en **≥ 15 %**, se cambia el **default por configuración**
  (orden de motores = datos; los órdenes históricos viajan inyectados). La
  decisión se registra como una entrada nueva de `DECISIONS.md`, con la
  tabla de números y la fecha del cierre.
- Si no hay candidato que cumpla, o la mejora es menor al margen, la
  decisión es **no cambiar el default** — también se documenta (con los
  números) para que la próxima ventana no repita el trabajo.

## 5 · Límites honestos

- El buffer de 500 eventos **no** es un archivo histórico: la ventana se
  cierra con exportaciones acumuladas, no leyendo IDB al final.
- `msPorMotor` excluye los eventos agregados de cierre (eco de la corrida)
  por diseño — sumarlos duplicaría el tiempo. Ver `colectorLectura()`.
- SIM no emite telemetría (los chips 8.2/7.0/4.3 se miden contra el motor
  de siempre); una corrida simulada no cuenta para la ventana.
