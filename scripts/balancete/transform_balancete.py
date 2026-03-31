"""
Ponto de entrada da transformação: linhas → JSON canônico + legado (entries/resumoContas).

A lógica vive em `semantic_balancete.py` (segmentação semântica, sem layout fixo).
"""

from __future__ import annotations

from typing import Any, Dict, List

from semantic_balancete import transform_semantic_document


def transform_lines_to_result(lines: List[str], file_name: str) -> Dict[str, Any]:
    return transform_semantic_document(lines, file_name)
