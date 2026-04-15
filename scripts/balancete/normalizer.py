from __future__ import annotations

import os
import re
import sys
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from text_repair import normalize_extracted_text


def _llm_to_block_type(
    token: Dict[str, Any],
) -> Tuple[Optional[str], Optional[str], bool]:
    """
    Retorna (bloco, tipo, skip).
    skip=True → ignorar linha na saída.
    """
    lt = token.get("llm_type")
    if not lt:
        return None, None, False
    lt = str(lt).upper().strip()
    if lt == "IGNORAR":
        return None, None, True
    valor = token.get("valor")
    if lt == "RECEITA":
        return "RECEITAS", "ITEM" if valor is not None else "CATEGORY", False
    if lt == "DESPESA":
        return "DESPESAS", "ITEM" if valor is not None else "CATEGORY", False
    if lt == "RESUMO":
        return "RESUMO", "RESUMO", False
    if lt == "CONTA":
        return "CONTAS", "CONTA", False
    return None, None, False


def _effective_block_and_type(token: Dict[str, Any]) -> Tuple[str, str, bool]:
    lb, lt_type, skip = _llm_to_block_type(token)
    if skip:
        return "", "", True
    if lb and lt_type:
        return lb, lt_type, False
    block = str(token.get("block") or "UNKNOWN")
    typ = str(token.get("type") or "CATEGORY").upper()
    return block, typ, False


def normalize(tokens: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Estrutura semântica: entries (lançamentos), resumo (lista), contas.
    Respeita token['llm_type'] no lugar de type quando existir.
    """
    entries: List[Dict[str, Any]] = []
    resumo: List[Dict[str, Any]] = []
    contas: List[Dict[str, Any]] = []

    last_cat: Dict[str, str] = {
        "RECEITAS": "GERAL",
        "DESPESAS": "GERAL",
    }

    _DEBUG_REJECT = os.getenv("BALANCETE_DEBUG_GROUP_REJECT", "").strip() not in ("", "0", "false", "False")

    _KNOWN_REAL_GROUPS = frozenset(
        {
            # Chelsea / obrigatórios
            "encargos sociais / impostos / taxas",
            "manutenção e conservação",
            "serviços públicos",
            "serviços financeiros",
            "despesas administrativas",
            "despesas extraordinárias",
            "outros",
            # grupos comuns que aparecem como título isolado
            "receitas",
            "despesas",
        }
    )
    _INVALID_GROUP_EXACT = frozenset(
        {
            "do condominio",
            "do condomínio",
            "do condominio)",
            "do condomínio)",
            "mercado do condominio",
            "mercado do condomínio",
            "automático",
            "automatico",
            "débito automático",
            "debito automatico",
            "facil",
            "fácil",
            "condominio",
            "condomínio",
            "condominio)",
            "condomínio)",
        }
    )
    _RE_STARTS_WITH_PREP = re.compile(r"(?is)^(?:DO|DA|DE)\b")

    def _strip_accents(s: str) -> str:
        return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")

    def _norm_key(s: str) -> str:
        return _strip_accents(str(s or "").strip().lower())

    def _relevant_words(s: str) -> List[str]:
        t = _norm_key(normalize_extracted_text(s or "", warn_context="parser_group_title"))
        parts = [p for p in re.split(r"[^a-z0-9]+", t) if p]
        stop = {"do", "da", "de", "dos", "das", "e", "em", "no", "na", "nos", "nas", "a", "o", "as", "os"}
        generic = {"condominio", "condominio)"}
        out: List[str] = []
        for p in parts:
            if p in stop:
                continue
            if p in generic:
                continue
            out.append(p)
        return out

    def is_real_group_title(raw_group: str, *, prev_was_item: bool, prev_was_total: bool) -> Tuple[bool, str, str]:
        """
        Valida título de grupo antes de promover para categoria/grupoOrigem.
        Retorna (ok, normalized, reason_if_rejected).
        """
        norm = normalize_extracted_text(raw_group or "", warn_context="parser_group_title")
        low = _norm_key(norm)
        if not norm:
            return False, norm, "empty"
        if sum(1 for c in norm if c.isalpha()) < 5:
            return False, norm, "too_few_letters"
        if low in _INVALID_GROUP_EXACT:
            return False, norm, "explicit_blacklist"
        if _RE_STARTS_WITH_PREP.match(norm.strip()):
            return False, norm, "starts_with_preposition"
        if low in _KNOWN_REAL_GROUPS:
            # permite 1 palavra (OUTROS) via set também
            return True, norm, ""
        rel = _relevant_words(norm)
        if len(rel) < 2:
            return False, norm, "too_few_relevant_words"
        # heurística de contexto: se a linha anterior era ITEM, é muito provável ser continuação, não grupo
        if prev_was_item and not prev_was_total:
            return False, norm, "looks_like_continuation_after_item"
        # após TOTAL: só aceitar se for claramente um título “real” (>=2 relevantes já garante mínimo)
        if prev_was_total and len(rel) < 2:
            return False, norm, "after_total_requires_real_title"
        return True, norm, ""

    def _append_continuation_to_last_entry(text: str) -> bool:
        """Anexa continuação à última descrição de lançamento (ITEM/TOTAL/RESUMO/CONTA) se existir."""
        nonlocal entries, resumo, contas
        t = " ".join(str(text or "").split()).strip()
        if not t:
            return True

        # Preferência: último lançamento (item/total) — preserva descrição completa
        if entries:
            last = entries[-1]
            if last.get("tipo") in ("item", "total") and last.get("valor") is not None:
                last_desc = str(last.get("descricao") or "").strip()
                last["descricao"] = (last_desc + " " + t).strip() if last_desc else t
                return True
        # Se não houver item, tenta resumo/contas
        if resumo:
            last = resumo[-1]
            if last.get("valor") is not None:
                last_desc = str(last.get("descricao") or "").strip()
                last["descricao"] = (last_desc + " " + t).strip() if last_desc else t
                return True
        if contas:
            last = contas[-1]
            if last.get("valor") is not None:
                last_desc = str(last.get("descricao") or "").strip()
                last["descricao"] = (last_desc + " " + t).strip() if last_desc else t
                return True
        return False

    prev_was_item = False
    prev_was_total = False

    for t in tokens:
        block, typ, skip = _effective_block_and_type(t)
        if skip:
            continue

        raw = str(t.get("raw") or "").strip()
        valor = t.get("valor")
        clean = str(t.get("clean") or "")

        # Continuação de descrição (linha quebrada por texto longo): nunca vira lançamento novo.
        if typ == "CONTINUATION" and raw:
            _append_continuation_to_last_entry(raw)
            prev_was_item = True if entries and entries[-1].get("tipo") in ("item", "total") else prev_was_item
            prev_was_total = True if entries and entries[-1].get("tipo") == "total" else prev_was_total
            continue

        if block == "CONTAS" and typ in ("CONTA", "ITEM", "TOTAL", "RESUMO"):
            if valor is not None:
                contas.append(
                    {
                        "descricao": raw,
                        "valor": float(valor),
                        "tipo": "conta",
                    }
                )
            continue

        if block == "RESUMO" or typ == "RESUMO":
            if valor is not None:
                resumo.append(
                    {
                        "descricao": raw,
                        "valor": float(valor),
                    }
                )
            elif typ == "RESUMO" and raw:
                resumo.append({"descricao": raw, "valor": None})
            continue

        if block == "RECEITAS":
            if typ == "CATEGORY" and raw:
                ok, norm, reason = is_real_group_title(raw, prev_was_item=prev_was_item, prev_was_total=prev_was_total)
                if not ok:
                    # regra: se não é grupo real, tratar como continuação/ruído e nunca promover
                    _append_continuation_to_last_entry(norm or raw)
                    if _DEBUG_REJECT:
                        print(
                            f"[DEBUG] reject_group(RECEITAS) raw={raw!r} norm={norm!r} reason={reason}",
                            file=sys.stderr,
                        )
                else:
                    last_cat["RECEITAS"] = norm
                    entries.append(
                        {
                            "bloco": "RECEITAS",
                            "categoria": last_cat["RECEITAS"],
                            "descricao": norm,
                            "valor": None,
                            "tipo": "categoria",
                        }
                    )
            elif typ in ("ITEM", "TOTAL") and valor is not None:
                desc = raw
                entries.append(
                    {
                        "bloco": "RECEITAS",
                        "categoria": last_cat["RECEITAS"],
                        "descricao": desc,
                        "valor": float(valor),
                        "tipo": "item" if typ == "ITEM" else "total",
                    }
                )
                prev_was_item = True
                prev_was_total = typ == "TOTAL"
            continue

        if block == "DESPESAS":
            if typ == "CATEGORY" and raw:
                ok, norm, reason = is_real_group_title(raw, prev_was_item=prev_was_item, prev_was_total=prev_was_total)
                if not ok:
                    _append_continuation_to_last_entry(norm or raw)
                    if _DEBUG_REJECT:
                        print(
                            f"[DEBUG] reject_group(DESPESAS) raw={raw!r} norm={norm!r} reason={reason}",
                            file=sys.stderr,
                        )
                else:
                    last_cat["DESPESAS"] = norm
                    entries.append(
                        {
                            "bloco": "DESPESAS",
                            "categoria": last_cat["DESPESAS"],
                            "descricao": norm,
                            "valor": None,
                            "tipo": "categoria",
                        }
                    )
            elif typ in ("ITEM", "TOTAL") and valor is not None:
                entries.append(
                    {
                        "bloco": "DESPESAS",
                        "categoria": last_cat["DESPESAS"],
                        "descricao": raw,
                        "valor": float(valor),
                        "tipo": "item" if typ == "ITEM" else "total",
                    }
                )
                prev_was_item = True
                prev_was_total = typ == "TOTAL"
            continue

        # UNKNOWN / fallback: linha com valor vira item conforme heurística de palavras
        if valor is not None and any(
            x in clean for x in ("despesa", "débito", "debito", "saída", "saida")
        ):
            entries.append(
                {
                    "bloco": "DESPESAS",
                    "categoria": last_cat["DESPESAS"],
                    "descricao": raw,
                    "valor": float(valor),
                    "tipo": "item",
                }
            )
        elif valor is not None and any(
            x in clean for x in ("receita", "crédito", "credito", "entrada")
        ):
            entries.append(
                {
                    "bloco": "RECEITAS",
                    "categoria": last_cat["RECEITAS"],
                    "descricao": raw,
                    "valor": float(valor),
                    "tipo": "item",
                }
            )

    return {
        "entries": entries,
        "resumo": resumo,
        "contas": contas,
    }
