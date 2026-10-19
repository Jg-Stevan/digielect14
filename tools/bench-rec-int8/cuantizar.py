#!/usr/bin/env python3
"""KIT bench e14-rec-int8-v1 (T1): cuantiza dinámicamente el rec PP-OCRv4 a
int8 para el banco de pruebas. NO es producción: el artifact vive aquí y NO
se commitea (.gitignore). Requiere: pip install onnxruntime onnx

DESVIACIÓN DOCUMENTADA (kit §0.4 y §3-T2.7) respecto al script literal del kit:
1. `quantize_dynamic` directo sobre el ONNX exportado por Paddle2ONNX falla con
   `ValueError: Expected conv2d_157.w_0 to be an initializer` (los pesos llegan
   como nodos Constant, no initializers). Se integra el paso PREVIO OFICIAL de
   onnxruntime (`quant_pre_process` / `onnxruntime.quantization.preprocess`,
   recomendado por el propio warning de la herramienta), con
   `--skip_symbolic_shape` porque con este modelo el shape inference simbólico
   aborta con "Incomplete symbolic shape inference".
2. El kit pedía `weight_type=QuantType.QInt8`. Con QInt8 el modelo cuantizado
   produce SALIDA DEGENERADA (texto vacío, conf 0) — verificado idéntico en
   CPU EP (onnxruntime 1.31.0, python) y en el EP wasm del banco (ort-web
   1.30.0), con el preprocess idéntico al motor: NO es un bug del banco ni del
   EP, es el artifact QInt8. Se aplica el fallback EXPLÍCITO del kit §3-T2.7:
   `QuantType.QUInt8`, que SÍ decodifica texto correcto (evidencia completa en
   docs/REPORTE-e14-bench-rec-int8-v1.md). Nada más cambia.
"""
import sys
from pathlib import Path
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.quantization import preprocess  # noqa: F401  (garantiza import)
import subprocess

AQUI = Path(__file__).parent
FUENTE = AQUI / "ch_PP-OCRv4_rec_infer.onnx"      # copia desde public/models/rapidocr/
PREPROCESADO = AQUI / "ch_PP-OCRv4_rec_preprocesado.onnx"  # intermedio (ignorado)
DESTINO = AQUI / "ch_PP-OCRv4_rec_int8.onnx"

def main() -> int:
    if not FUENTE.exists():
        print(f"FALTA {FUENTE}: copia el modelo desde public/models/rapidocr/")
        return 1
    # Paso previo oficial de ORT: optimización que pliega Constant -> initializer.
    # skip_symbolic_shape: el shape inference simbólico falla con este export
    # Paddle2ONNX ("Incomplete symbolic shape inference") y no es necesario para
    # quantize_dynamic (formato QOperator, sin QDQ).
    subprocess.run(
        [
            sys.executable, "-m", "onnxruntime.quantization.preprocess",
            "--input", str(FUENTE),
            "--output", str(PREPROCESADO),
            "--skip_symbolic_shape", "true",
        ],
        check=True,
    )
    quantize_dynamic(str(PREPROCESADO), str(DESTINO), weight_type=QuantType.QUInt8)  # kit §3-T2.7: fallback QInt8→QUInt8 (QInt8 salida degenerada, ver REPORTE)
    mb = lambda p: p.stat().st_size / 1024 / 1024
    print(f"fp32 {mb(FUENTE):.2f} MB -> int8 {mb(DESTINO):.2f} MB")
    return 0

if __name__ == "__main__":
    sys.exit(main())
