from __future__ import annotations

from pathlib import Path
from typing import List

import pdfplumber


def extract_pages_text(path: Path) -> List[str]:
    """Extrai texto página a página (preserva ordem de leitura do PDF)."""
    texts: List[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            texts.append(t or "")
    return texts


def extract_full_text(path: Path) -> str:
    return "\n".join(extract_pages_text(path))
