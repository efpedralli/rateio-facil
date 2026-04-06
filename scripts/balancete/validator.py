from __future__ import annotations

from typing import Any, Dict, List


MAX_SCORE = 6


def _sum_items(data: Dict[str, Any], bloco: str) -> float:
    total = 0.0
    for e in data.get("entries") or []:
        if e.get("bloco") != bloco:
            continue
        if e.get("tipo") != "item":
            continue
        v = e.get("valor")
        if v is None:
            continue
        total += float(v)
    return total


def _sum_matches_resumo(data: Dict[str, Any]) -> bool:
    sum_r = _sum_items(data, "RECEITAS")
    sum_d = _sum_items(data, "DESPESAS")
    resumo: List[Dict[str, Any]] = list(data.get("resumo") or [])

    if resumo:
        tol_r = max(5.0, 0.02 * max(sum_r, 1.0))
        tol_d = max(5.0, 0.02 * max(sum_d, 1.0))
        ok_r = sum_r <= 0
        ok_d = sum_d <= 0
        for r in resumo:
            desc = (r.get("descricao") or "").lower()
            v = r.get("valor")
            if v is None:
                continue
            fv = float(v)
            if "receit" in desc and "total" in desc and sum_r > 0:
                ok_r = ok_r or abs(fv - sum_r) <= tol_r
            if "despes" in desc and "total" in desc and sum_d > 0:
                ok_d = ok_d or abs(fv - sum_d) <= tol_d
        if sum_r > 0 and sum_d > 0:
            return ok_r and ok_d
        if sum_r > 0:
            return ok_r
        if sum_d > 0:
            return ok_d
        return False

    if sum_r > 0 and sum_d > 0:
        tol = max(10.0, 0.03 * max(sum_r, sum_d))
        return abs(sum_r - sum_d) <= tol
    return False


def validate(data: Dict[str, Any]) -> Dict[str, Any]:
    score = 0
    entries = data.get("entries") or []

    has_rec = any(e.get("bloco") == "RECEITAS" for e in entries)
    has_desp = any(e.get("bloco") == "DESPESAS" for e in entries)
    has_resumo = bool(data.get("resumo"))
    has_contas = bool(data.get("contas"))

    if has_rec:
        score += 1
    if has_desp:
        score += 1
    if has_resumo:
        score += 1
    if _sum_matches_resumo(data):
        score += 2
    if has_contas:
        score += 1

    ratio = score / MAX_SCORE if MAX_SCORE else 0.0
    status = "OK" if ratio >= 0.7 else "LOW_CONFIDENCE"

    return {
        "data": data,
        "score": score,
        "max_score": MAX_SCORE,
        "score_ratio": ratio,
        "status": status,
    }
