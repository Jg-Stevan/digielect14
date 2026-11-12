/**
 * 7.9 (plan de remediación, cierra C4) — SNAPSHOT del formato del
 * log-contrato D51. Los casos de oro reproducen BYTE A BYTE las líneas que
 * la concatenación manual de los dos pipelines emitía para un escenario
 * fijo (el propio grep del repo los confirma: `…total=…ms (decode=…
 * motor=… ocrValido=… clasif={…} metricas={…})…`). Si un test rojo sale
 * aquí, el cambio de formato es un CAMBIO DE CONTRATO con los instrumentos
 * del mantenedor: los tokens nuevos van AL FINAL (D51) — nunca en medio.
 */
import { describe, expect, it } from "vitest";
import { construirLogD51, ORDEN_LOG_D51 } from "./log-contrato";

describe("7.9 · constructor del log-contrato D51", () => {
  it("CASO DE ORO — escaneo completo (condicionales activos) byte a byte", () => {
    // Escenario: acta con guard sospechoso (borde=S con perdón), lazo
    // perdonado, sin votos marcados, as-is, chip SIM 8.2, diag adjunto.
    const cuerpo = construirLogD51(
      [
        ["decode", 512],
        ["detect", 90],
        ["proceso", 1402],
        ["calidad", 210],
        ["ocr", 6891],
        ["motor", "worker"],
        ["ocrValido", String(true)],
        ["cabeceraE14", String(true)],
        ["completa", String(false)],
        ["senal", String(true)],
        ["vacia", String(false)],
        ["votos", "8.8%"],
        ["SIN_VOTOS", true],
        ["lado", "S"],
        ["lazo", "perdonado"],
        ["esquinas", "FALTA_bl"],
        ["recorte", "as-is"],
        ["borde", "S"],
        ["tintaFilo", String(false)],
        ["franja", "[12.3,4.5]"],
        ["fondo", String(false)],
        ["perdon", "S"],
        ["quad", `[${["0.000,0.000", "1.000,0.000", "1.000,1.000", "0.000,1.000"].join(" ")}]`],
        ["piso10", 1],
        ["origen", "sobel"],
        ["score", 6.4],
        ["filtro", "bw"],
        ["ocrIn", "original"],
        ["ocr", "rapidocr"],
        ["conf", "0.97"],
        ["det", "977ms"],
        ["rec", "373ms"],
        ["lectura", "FUERTE"],
        ["anclas", 9],
        ["piso", String(true)],
        ["clasif", "{dep:88,mun:335,zon:05,std:02,mesa:003,pag:1/2,tipo:T,nivel:AUTO}"],
        ["crop", "1200x2200"],
        ["metricas", "{sharpness:100 brightness:95 contrast:22 contEff:80 level:good}"],
      ],
      ORDEN_LOG_D51,
    );
    expect(cuerpo).toBe(
      "decode=512 detect=90 proceso=1402 calidad=210 ocr=6891 motor=worker " +
        "ocrValido=true cabeceraE14=true completa=false senal=true vacia=false " +
        "votos=8.8% SIN_VOTOS lado=S lazo=perdonado esquinas=FALTA_bl recorte=as-is " +
        "borde=S tintaFilo=false franja=[12.3,4.5] fondo=false perdon=S " +
        "quad=[0.000,0.000 1.000,0.000 1.000,1.000 0.000,1.000] piso10=1 origen=sobel " +
        "score=6.4 filtro=bw ocrIn=original ocr=rapidocr conf=0.97 det=977ms rec=373ms " +
        "lectura=FUERTE anclas=9 piso=true " +
        "clasif={dep:88,mun:335,zon:05,std:02,mesa:003,pag:1/2,tipo:T,nivel:AUTO} " +
        "crop=1200x2200 metricas={sharpness:100 brightness:95 contrast:22 contEff:80 level:good}",
    );
  });

  it("CASO DE ORO — recorte manual (sin decode/detect, con manual/escudo-manual)", () => {
    const cuerpo = construirLogD51(
      [
        ["proceso", 2210],
        ["calidad", 190],
        ["ocr", 4402],
        ["motor", "canvas"],
        ["ocrValido", String(true)],
        ["cabeceraE14", String(true)],
        ["completa", String(false)],
        ["senal", String(true)],
        ["vacia", String(false)],
        ["votos", "skip-pag2"],
        ["esquinas", "OK"],
        ["manual", 1],
        ["escudo-manual", 1],
        ["quad", `[${["0.1,0.1", "0.9,0.1", "0.9,0.9", "0.1,0.9"].join(" ")}]`],
        ["piso10", 0],
        ["score", 7.9],
        ["filtro", "original"],
        ["ocrIn", "original"],
        ["ocr", "rapidocr"],
        ["conf", "?"],
        ["det", "812ms"],
        ["rec", "290ms"],
        ["lectura", "MEDIA"],
        ["anclas", 4],
        ["piso", String(false)],
        ["clasif", "sin-clasificar"],
        ["crop", "full"],
        ["metricas", "{sharpness:80 brightness:95 contrast:22 contEff:80 level:fair}"],
      ],
      ORDEN_LOG_D51,
    );
    expect(cuerpo).toBe(
      "proceso=2210 calidad=190 ocr=4402 motor=canvas ocrValido=true cabeceraE14=true " +
        "completa=false senal=true vacia=false votos=skip-pag2 esquinas=OK manual=1 " +
        "escudo-manual=1 quad=[0.1,0.1 0.9,0.1 0.9,0.9 0.1,0.9] piso10=0 score=7.9 " +
        "filtro=original ocrIn=original ocr=rapidocr conf=? det=812ms rec=290ms " +
        "lectura=MEDIA anclas=4 piso=false clasif=sin-clasificar crop=full " +
        "metricas={sharpness:80 brightness:95 contrast:22 contEff:80 level:fair}",
    );
  });

  it("CASO DE ORO — sufijo tras el paréntesis (campos aditivos, orden de inserción)", () => {
    // El segmento EXTERNO al paréntesis no tiene orden canónico: TODOS sus
    // tokens son aditivos (D51) y viajan en inserción.
    const sufijo = construirLogD51(
      [["sim", "8.2"], ["diag", 1], ["detectOrigen", "worker"], ["detectReintento", 1]],
      [],
    );
    expect(sufijo).toBe("sim=8.2 diag=1 detectOrigen=worker detectReintento=1");
  });

  it("los tokens NUEVOS (fuera de ordenFijo) van AL FINAL — la regla D51 como código", () => {
    const linea = construirLogD51(
      [["campoNuevo", "valor"], ["decode", 10], ["otroNuevo", 2]],
      ORDEN_LOG_D51,
    );
    expect(linea).toBe("decode=10 campoNuevo=valor otroNuevo=2");
  });

  it("las claves duplicadas se consumen en orden (el `ocr=` doble del contrato)", () => {
    const linea = construirLogD51([["ocr", 6891], ["motor", "worker"], ["ocr", "rapidocr"]], ORDEN_LOG_D51);
    expect(linea).toBe("ocr=6891 motor=worker ocr=rapidocr");
  });

  it("condicionales apagados: false no emite y no desplaza el orden", () => {
    const linea = construirLogD51(
      [["votos", "9.7%"], ["SIN_VOTOS", false], ["recortada", false], ["esquinas", "OK"]],
      ORDEN_LOG_D51,
    );
    expect(linea).toBe("votos=9.7% esquinas=OK");
  });

  it("los flags k=true/k=false del contrato viajan como string, no como boolean", () => {
    // `ocrValido=true` es k=v (el boolean está reservado al token desnudo) y
    // el orden CANÓNICO manda: `recortada` va antes que `piso` en ordenFijo.
    const linea = construirLogD51(
      [["piso", String(false)], ["ocrValido", String(true)], ["recortada", 1]],
      ORDEN_LOG_D51,
    );
    expect(linea).toBe("ocrValido=true recortada=1 piso=false");
  });

  it("entradas vacías → línea vacía (el sufijo condicional del paréntesis)", () => {
    expect(construirLogD51([], [])).toBe("");
  });
});
