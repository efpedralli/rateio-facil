from __future__ import annotations

import re
from typing import Optional, Tuple

# Exige dois-pontos após "Condomínio" para não confundir com "Taxa de Condomínio - Ref: ..."
RE_CONDOMINIO = re.compile(
    r"(?:Condom[ií]nio|Cond\.)\s*:\s*(.+)$",
    re.IGNORECASE,
)
RE_CONDOMINIO_SEM_DOIS_PONTOS = re.compile(
    r"^Cond\.?\s+(.+)$",
    re.IGNORECASE,
)
RE_PERIODO_ATE = re.compile(
    r"(\d{2}/\d{2}/\d{4})\s*(?:at[ée]|ATÉ)\s*(\d{2}/\d{2}/\d{4})",
    re.IGNORECASE,
)
RE_PERIODO_LABEL = re.compile(
    r"Per[ií]odo\s*:\s*(\d{2}/\d{2}/\d{4})\s*[aà]\s*(\d{2}/\d{2}/\d{4})",
    re.IGNORECASE,
)
RE_BALANCETE_DEMO = re.compile(
    r"BALANCETE\s+DEMONSTRATIVO\s+(\d{2}/\d{2}/\d{4})\s*(?:ATÉ|até|ATE)\s*(\d{2}/\d{2}/\d{4})",
    re.IGNORECASE,
)


def extract_condominio(line: str) -> Optional[str]:
    s = line.strip()
    m = RE_CONDOMINIO.search(s)
    if m:
        return re.sub(r"\s+", " ", m.group(1).strip())
    m = RE_CONDOMINIO_SEM_DOIS_PONTOS.match(s)
    if m and len(m.group(1)) < 100:
        return re.sub(r"\s+", " ", m.group(1).strip())
    return None


def extract_periodo(text: str) -> str:
    for line in text.splitlines():
        s = line.strip()
        m = RE_PERIODO_ATE.search(s)
        if m:
            return f"{m.group(1)} a {m.group(2)}"
        m = RE_PERIODO_LABEL.search(s)
        if m:
            return f"{m.group(1)} a {m.group(2)}"
        m = RE_BALANCETE_DEMO.search(s)
        if m:
            return f"{m.group(1)} a {m.group(2)}"
    return ""


def extract_condominio_principal(text: str) -> str:
    """Prioriza linha 'Condomínio: ...' em todo o texto."""
    for line in text.splitlines():
        ex = extract_condominio(line)
        if ex:
            return ex
    return extract_condominio_from_title(text)


def extract_condominio_from_title(text: str) -> str:
    """Tenta nome do condomínio em linhas típicas de cabeçalho."""
    for line in text.splitlines()[:40]:
        s = line.strip()
        if not s:
            continue
        ex = extract_condominio(s)
        if ex:
            return ex
        low = s.lower()
        if "condomínio" in low and "taxa de condomínio" not in low and "demonstrativo" not in low:
            if len(s) < 120 and ":" not in s:
                return s
    return ""
