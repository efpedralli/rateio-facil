from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from llm_client import call_llm


def build_prompt(lines: List[str]) -> str:
    joined = "\n".join(lines)
    return f"""
Classifique cada linha abaixo em:

RECEITA, DESPESA, RESUMO, CONTA ou IGNORAR.

Responda apenas JSON:

[
  {{ "linha": "...", "tipo": "RECEITA|DESPESA|RESUMO|CONTA|IGNORAR" }}
]

Linhas:
{joined}
"""


def _extract_json_array(text: str) -> str:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1)
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return text


def classify_with_llm(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    lines = [t["raw"] for t in tokens]
    if not lines:
        return tokens

    prompt = build_prompt(lines)
    response = call_llm(prompt)
    if not response.strip():
        return tokens

    try:
        parsed = json.loads(_extract_json_array(response))
    except json.JSONDecodeError:
        return tokens

    if not isinstance(parsed, list):
        return tokens

    mapping: Dict[str, str] = {}
    for item in parsed:
        if not isinstance(item, dict):
            continue
        linha = item.get("linha")
        tipo = item.get("tipo")
        if linha is not None and tipo is not None:
            mapping[str(linha).strip()] = str(tipo).upper().strip()

    for token in tokens:
        key = str(token.get("raw") or "").strip()
        if key in mapping:
            token["llm_type"] = mapping[key]

    return tokens
