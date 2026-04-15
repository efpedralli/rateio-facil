from __future__ import annotations

import re
import sys
import unicodedata
from typing import Iterable, Optional, Tuple


_RE_MOJIBAKE_HINT = re.compile(
    r"(?:Ã.|Â.|â€™|â€œ|â€|â€“|â€”|â€¢|â„¢|â‚¬|â€¦|â€\")"
)
_RE_REPLACEMENT = re.compile(r"\ufffd")


def _normalize_spaces(s: str) -> str:
    return re.sub(r"[\u00a0\s]+", " ", s).strip()


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _quality_score(s: str) -> int:
    """
    Menor é melhor.
    Penaliza: '�' e padrões típicos de mojibake.
    """
    if s is None:
        return 10**9
    rep = s.count("\ufffd")
    moj = len(_RE_MOJIBAKE_HINT.findall(s))
    # Ã e Â isolados também são sinais fortes
    extra = s.count("Ã") + s.count("Â")
    return rep * 1000 + moj * 50 + extra * 10 + len(s) // 200


def _try_recode(s: str, *, src: str, dst: str) -> Optional[str]:
    """
    Tenta reparar texto que virou mojibake por decode errado.
    Usa apenas modo estrito (nunca errors='replace').
    """
    try:
        b = s.encode(src, errors="strict")
        return b.decode(dst, errors="strict")
    except UnicodeError:
        return None


def repair_mojibake(text: str) -> Tuple[str, bool]:
    """
    Repara mojibake comum pt-BR.
    Estratégia:
    - só tenta se houver sinais ('Ã', 'Â', sequências 'â€', ou '�')
    - avalia candidatos (latin1->utf8, cp1252->utf8, e repetição simples)
    - só aplica se ficar *melhor* por score.
    Retorna (texto, changed).
    """
    if text is None:
        return "", False
    original = str(text)
    s0 = _nfc(_normalize_spaces(original))

    if not (("Ã" in s0) or ("Â" in s0) or _RE_MOJIBAKE_HINT.search(s0) or _RE_REPLACEMENT.search(s0)):
        return s0, s0 != original

    candidates = [s0]

    for src in ("latin1", "cp1252"):
        c1 = _try_recode(s0, src=src, dst="utf-8")
        if c1:
            candidates.append(_nfc(_normalize_spaces(c1)))
            # alguns casos são duplo-encodados (raros): tenta mais uma rodada
            c2 = _try_recode(c1, src=src, dst="utf-8")
            if c2:
                candidates.append(_nfc(_normalize_spaces(c2)))

    best = min(candidates, key=_quality_score)
    changed = best != s0
    return best, changed


def normalize_extracted_text(text: str, *, warn_context: str = "") -> str:
    """
    Normalização final obrigatória:
    - tentar reparar mojibake
    - NFC
    - normalizar espaços
    - trim
    - se ainda tiver '�', registrar warning (sem substituir silenciosamente)
    """
    s, _ = repair_mojibake(text)
    s = _nfc(_normalize_spaces(s))
    if "\ufffd" in s:
        ctx = f" ({warn_context})" if warn_context else ""
        print(f"[WARN] Texto contém '�' após reparo{ctx}: {s[:160]}", file=sys.stderr)
    return s

