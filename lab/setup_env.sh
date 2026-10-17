#!/usr/bin/env bash
# setup_env.sh — entorno del lab FILTROS-1 (kit §2.2: NADA de esto se commitea;
# todo vive en lab/cache/ — modelos desde el repo, tessdata y venv descargados).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p cache out

# 1) venv + dependencias Python (rapidocr_onnxruntime==1.4.4 = paquete del
#    bench del dueño; los modelos PP-OCRv4 vienen embebidos en el paquete).
if [ ! -d cache/venv ]; then
  python3 -m venv cache/venv
fi
cache/venv/bin/pip install --quiet --upgrade pip
cache/venv/bin/pip install --quiet "rapidocr_onnxruntime==1.4.4" "opencv-python-headless" "numpy" "pillow"

# 2) tessdata español (Tesseract «tuned» — perfil reconstruido; la config
#    exacta del lab previo se perdió con el sandbox, ver README §Desviaciones).
mkdir -p cache/tessdata
if [ ! -f cache/tessdata/spa.traineddata ]; then
  echo "[FILTROS-1] descargando spa.traineddata (tessdata_best)…"
  curl -fsSL -o cache/tessdata/spa.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/main/spa.traineddata
fi
# Los configs (tsv/txt) viven junto al tessdata del sistema — TESSDATA_PREFIX
# propio los oculta: copiarlos para que `… tsv` resuelva (read_params_file).
CONF_SRC="$(ls -d /usr/share/tesseract-ocr/*/tessdata/configs 2>/dev/null | head -1 || true)"
if [ -n "$CONF_SRC" ] && [ ! -d cache/tessdata/configs ]; then
  cp -r "$CONF_SRC" cache/tessdata/configs
fi

# 3) verificación de tesseract del sistema (5.x) — el binario NO se descarga.
tesseract --version | head -1

# 4) sonda de motores + carga de RapidOCR (carga medida aparte, kit §8.1).
cache/venv/bin/python - <<'PY'
import sys, os
sys.path.insert(0, os.getcwd())
from ocr_engines import RapidOCRV4, TesseractTuned, motores_disponibles
print("[FILTROS-1] motores:", motores_disponibles())
r = RapidOCRV4(1920)
print(f"[FILTROS-1] RapidOCR listo — carga {r.carga_ms} ms (det 1920/max)")
t = TesseractTuned()
print("[FILTROS-1] Tesseract tuned listo (spa tessdata_best, oem 1, psm 6)")
PY
echo "[FILTROS-1] entorno listo ✔"
