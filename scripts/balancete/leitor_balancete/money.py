from __future__ import annotations

import re
from typing import Optional, Tuple

# Valores monetários em formato brasileiro dentro do texto
RE_BRL_TOKEN = re.compile(
    r"\(?\s*(?:R\$\s*)?[\-\d]{1,3}(?:\.\d{3})*,\d{2}\)?"
)


def brl_to_float(token: str) -> float:
    t = token.strip()
    neg = t.startswith("(") and t.endswith(")")
    if neg:
        t = t[1:-1]
    t = t.replace("R$", "").replace("$", "").strip()
    t = t.replace(".", "").replace(",", ".")
    v = float(t)
    return -v if neg else v


def last_money_on_line(line: str) -> Optional[Tuple[float, str]]:
    """
    Retorna (valor, texto_antes_do_valor) usando o último token monetário da linha.
    Ignora matches que são claramente datas ou referências MM/AAAA isoladas.
    """
    line = line.strip()
    if not line:
        return None
    matches = list(RE_BRL_TOKEN.finditer(line))
    if not matches:
        return None
    m = matches[-1]
    raw = m.group(0)
    # Evita confundir "01/2026" — não deve casar pois nosso padrão exige ,dd
    try:
        val = brl_to_float(raw)
    except ValueError:
        return None
    before = line[: m.start()].rstrip()
    # Remove separadores comuns no fim da descrição
    before = re.sub(r"[\s\-–—:;]+$", "", before)
    return val, before


def first_money_on_line(line: str) -> Optional[Tuple[float, str]]:
    line = line.strip()
    if not line:
        return None
    m = RE_BRL_TOKEN.search(line)
    if not m:
        return None
    try:
        val = brl_to_float(m.group(0))
    except ValueError:
        return None
    rest = line[m.end() :].strip()
    before = line[: m.start()].rstrip()
    return val, before
