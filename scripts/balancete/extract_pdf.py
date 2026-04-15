from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Union

import pdfplumber

from text_repair import normalize_extracted_text


def extract_pdf_content(path: Union[str, Path]) -> Dict[str, Any]:
    """Extrai texto linha a linha e tabelas de um PDF (pdfplumber)."""
    path = Path(path)
    text_lines: List[str] = []
    tables: List[Any] = []

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            raw = page.extract_text()
            if raw:
                for line in raw.splitlines():
                    s = line.strip()
                    if s:
                        text_lines.append(
                            normalize_extracted_text(s, warn_context=f"{path.name}:page{page.page_number}")
                        )
            page_tables = page.extract_tables()
            if page_tables:
                tables.extend(page_tables)

    return {"text_lines": text_lines, "tables": tables}
