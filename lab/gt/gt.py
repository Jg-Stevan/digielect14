# -*- coding: utf-8 -*-
"""gt.py — Ground truth del lab FILTROS-1 (repo digielect14).

FUENTE VERBATIM (byte a byte del Apéndice B del kit informe-telemetria-ocr-v1,
hoy en PR #10 → src/lib/e14/informe/analisis-texto.ts):
  · CODIGOS_GT · GT_F_LINES (24 líneas impresas Frankfurt P2) · GT_ANCLAS (F/EG)
  · norm() (uppercase → NFD sin diacríticos → [^A-Z0-9]+ → " " → trim)
  · lev() / sim() (Levenshtein dos filas / similitud 1 − lev/max)
  · lógica de líneas GT con n-grams 1..4 y tolerancia sim ≥ 0.8.

Fotos del kit (4): tres comparten la GT "F" (mismo impreso Frankfurt P2:
KIT 745 · mesa 012 · código 710007453010202) y una es "EG" (El Cairo P1,
KIT 399 · mesa 001 · código 710003993010102). Para EG NO hay GT de líneas en
el informe (kit FILTROS-1 §3): generarla UNA vez por consenso (gen_gt.py) y
guardarla en lab/gt/EG-P1.txt.
"""

from __future__ import annotations

import re
import unicodedata
from typing import List, Optional, Tuple

# ─── Normalización (idéntica al laboratorio) ────────────────────────────────


def norm(s: str) -> str:
    """uppercase → NFD sin diacríticos → [^A-Z0-9]+ → ' ' → trim."""
    s = s.upper()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return s.strip()


def lev(a: str, b: str) -> int:
    """Distancia de Levenshtein clásica (dos filas)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        curr = [i] + [0] * len(b)
        ca = a[i - 1]
        for j in range(1, len(b) + 1):
            cost = 0 if ca == b[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[len(b)]


def sim(a: str, b: str) -> float:
    """Similitud 1 − lev/max(len) (0..1)."""
    m = max(len(a), len(b))
    if m == 0:
        return 1.0
    return 1.0 - lev(a, b) / m


# ─── Apéndice B — GT embebida ───────────────────────────────────────────────

CODIGOS_GT = {"F": "710007453010202", "EG": "710003993010102"}

GT_F_LINES: List[str] = [
    # Frankfurt P2 — SOLO texto impreso (24 líneas)
    "710007453010202",
    "VER. 01 PAG. 2 DE 2",
    "ACTA DE ESCRUTINIO DE LOS",
    "JURADOS DE VOTACION",
    "E-14",
    "TRANSMISION",
    "ELECCION PRESIDENCIA Y",
    "VICEPRESIDENCIA DE LA REPUBLICA",
    "JUNIO 21 DE 2026",
    "REGISTRADURIA",
    "CONSULADO: 88 - CONSULADOS",
    "PAIS: 120 - ALEMANIA",
    "ZONA: 15 PUESTO: 02 MESA: 012",
    "LUGAR: Frankfurt Consulado",
    "X 2-11-83-18 X",
    "CONSTANCIAS DE LOS JURADOS DE VOTACION",
    "HUBO RECUENTO DE VOTOS? SI NO",
    "SOLICITADO POR:",
    "EN REPRESENTACION DE:",
    "FIRMA JURADO 1",
    "FIRMA JURADO 2",
    "FIRMA JURADO 3",
    "FIRMA JURADO 4",
    "KIT 745",
]

# Anclas EXACTAS (14) — mismas del marcador unificado del laboratorio.
# Port de las RegExp de analisis-texto.ts (mismos patrones, flags i).
GT_ANCLAS: "dict[str, List[Tuple[str, re.Pattern]]]" = {
    "F": [
        ("cabecera E-14", re.compile(r"E\s*-\s*14", re.I)),
        ("REGISTRADURÍA", re.compile(r"REGISTRADUR[IÍ]A", re.I)),
        ("TRANSMISIÓN", re.compile(r"TRANSMISI", re.I)),
        ("CONSULADO 88", re.compile(r"CONSULADO.*88|88.*CONSULAD", re.I)),
        ("PAÍS 120 ALEMANIA", re.compile(r"ALEMANIA", re.I)),
        ("ZONA 15 (exacto)", re.compile(r"ZONA[::\s.]*15(?!\d)", re.I)),
        ("PUESTO 02", re.compile(r"PUESTO[::\s.]*0?2(?!\d)", re.I)),
        ("MESA 012", re.compile(r"MESA[::\s.]*012(?!\d)", re.I)),
        ("KIT 745", re.compile(r"KIT[::\s.]*745", re.I)),
        ("Ver Pag 2 de 2", re.compile(r"Ver\.?\s*:?\s*0?1\s*Pag\.?\s*:?\s*0?2\s*de\s*0?2", re.I)),
        ("código 1D completo", re.compile(r"710007453010202")),
        ("LUGAR Frankfurt", re.compile(r"Frankfurt", re.I)),
        ("CONSTANCIAS", re.compile(r"CONSTANCIAS", re.I)),
        ("FIRMA", re.compile(r"FIRMA", re.I)),
    ],
    "EG": [
        ("cabecera E-14", re.compile(r"E\s*-\s*14", re.I)),
        ("REGISTRADURÍA", re.compile(r"REGISTRADUR[IÍ]A", re.I)),
        ("TRANSMISIÓN", re.compile(r"TRANSMISI", re.I)),
        ("CONSULADO 88", re.compile(r"CONSULADO.*88|88.*CONSULAD", re.I)),
        ("PAÍS 335 EGIPTO", re.compile(r"EGIPTO", re.I)),
        ("ZONA 05 (exacto)", re.compile(r"ZONA[::\s.]*0?5(?!\d)", re.I)),
        ("PUESTO 02", re.compile(r"PUESTO[::\s.]*0?2(?!\d)", re.I)),
        ("MESA 001", re.compile(r"MESA[::\s.]*001(?!\d)", re.I)),
        ("KIT 399", re.compile(r"KIT[::\s.]*399", re.I)),
        ("Ver Pag 1 de 2", re.compile(r"Ver\.?\s*:?\s*0?1\s*Pag\.?\s*:?\s*0?1\s*de\s*0?2", re.I)),
        ("código 1D completo", re.compile(r"710003993010102")),
        ("LUGAR El Cairo", re.compile(r"CAIRO", re.I)),
        ("SUMA TOTAL (P1)", re.compile(r"SUMA\s*TOTAL", re.I)),
        ("NIVELACIÓN MESA", re.compile(r"NIVELACI[OÓ]N", re.I)),
    ],
}

# Anclas de la P1 de Frankfurt (humo del rig — subset de F válido para la
# página 1: sin Ver-Pag-2-de-2, sin CONSTANCIAS, sin FIRMA).
ANCLAS_F_P1 = [
    "cabecera E-14",
    "REGISTRADURÍA",
    "TRANSMISIÓN",
    "CONSULADO 88",
    "PAÍS 120 ALEMANIA",
    "ZONA 15 (exacto)",
    "PUESTO 02",
    "MESA 012",
    "KIT 745",
    "código 1D completo",
    "LUGAR Frankfurt",
]


def gt_de_texto(texto: str) -> Optional[str]:
    """Resuelve la GT por código 1D en el texto (patrón gtDeTexto del informe)."""
    if CODIGOS_GT["F"] in texto:
        return "F"
    if CODIGOS_GT["EG"] in texto:
        return "EG"
    return None


def anclas_gt(texto: str, gt_key: str) -> Tuple[int, int, List[str]]:
    """(hits, total, misses) de las 14 anclas exactas."""
    hits, miss = 0, []
    for nombre, re_ in GT_ANCLAS[gt_key]:
        if re_.search(texto):
            hits += 1
        else:
            miss.append(nombre)
    return hits, len(GT_ANCLAS[gt_key]), miss


def lineas_gt(texto: str, gt_lines: List[str]) -> Tuple[int, int, List[str]]:
    """Líneas GT recuperadas con tolerancia sim ≥ 0.8 (misma matemática del
    informe: n-grams de 1..4 tokens; ventana |len(seg)−len(nl)| ≤ max(4, 40%))."""
    texto_norm = norm(texto)
    tokens = [t for t in texto_norm.split(" ") if t]
    ngrams: List[str] = []
    for n in range(1, 5):
        for i in range(0, len(tokens) - n + 1):
            ngrams.append(" ".join(tokens[i : i + n]))
    falladas: List[str] = []
    rec = 0
    for linea in gt_lines:
        nl = norm(linea)
        if not nl:
            continue
        hallada = nl in texto_norm
        if not hallada and len(nl) >= 8:
            for seg in ngrams:
                if abs(len(seg) - len(nl)) > max(4, int(len(nl) * 0.4)):
                    continue
                if sim(nl, seg) >= 0.8:
                    hallada = True
                    break
        if hallada:
            rec += 1
        else:
            falladas.append(linea)
    return rec, len(gt_lines), falladas


def cer(texto: str, gt_lines: List[str]) -> float:
    """CER % = lev(norm(GT), norm(texto)) / len(norm(GT)) · 100."""
    norm_gt = norm("\n".join(gt_lines))
    return 100.0 * lev(norm_gt, norm(texto)) / max(1, len(norm_gt))


def numeros_exactos(texto: str, gt_key: str) -> Tuple[int, int, List[str]]:
    """5 números exactos: ZONA · PUESTO · MESA · KIT · código 1D (15 d).
    (kit FILTROS-1 §5). Extraídos con la familia de camposNum del informe."""
    esperados = {
        "F": {"ZONA": "15", "PUESTO": "02", "MESA": "012", "KIT": "745", "COD": CODIGOS_GT["F"]},
        "EG": {"ZONA": "05", "PUESTO": "02", "MESA": "001", "KIT": "399", "COD": CODIGOS_GT["EG"]},
    }[gt_key]
    ok: List[str] = []
    zona = re.search(r"ZONA[::\s.]*0?(\d+)", texto, re.I)
    puesto = re.search(r"PUESTO[::\s.]*0?(\d+)", texto, re.I)
    mesa = re.search(r"MESA[::\s.]*0?(\d+)", texto, re.I)
    kit = re.search(r"KIT[::\s.]*0?(\d+)", texto, re.I)
    cod = re.search(r"\b(\d{15})\b", texto)
    def _eq(captura, esperado):
        return captura is not None and int(captura) == int(esperado)

    if zona and _eq(zona.group(1), esperados["ZONA"]):
        ok.append("ZONA")
    if puesto and _eq(puesto.group(1), esperados["PUESTO"]):
        ok.append("PUESTO")
    if mesa and _eq(mesa.group(1), esperados["MESA"]):
        ok.append("MESA")
    if kit and _eq(kit.group(1), esperados["KIT"]):
        ok.append("KIT")
    if cod and cod.group(1) == esperados["COD"]:
        ok.append("CÓDIGO 1D")
    return len(ok), 5, ok
