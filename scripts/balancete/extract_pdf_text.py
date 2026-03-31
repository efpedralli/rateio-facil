"""
Extração linear de texto do PDF (sem OCR, sem inferência de tabela visual).
Usado pelo parser de balancete para alimentar heurísticas linha a linha.
"""

from __future__ import annotations

import re
from typing import List

try:
    import pdfplumber
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "pdfplumber não instalado. Rode: pip install -r scripts/balancete/requirements.txt"
    ) from e


_WS = re.compile(r"\s+")


def normalize_raw_line(s: str) -> str:
    s = (s or "").replace("\u00a0", " ").replace("\ufffd", "")
    s = _WS.sub(" ", s).strip()
    return s


def extract_lines_from_pdf(pdf_path: str) -> List[str]:
    lines: List[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            for raw in text.splitlines():
                n = normalize_raw_line(raw)
                if n:
                    lines.append(n)
    return lines
