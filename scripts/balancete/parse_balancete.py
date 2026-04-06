from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Union

from block_detector import detect_blocks
from extract_pdf import extract_pdf_content
from line_classifier import classify_lines
from llm_fallback import classify_with_llm
from normalizer import normalize
from tokenizer import (
    pre_normalize_line_for_ocr,
    refine_trailing_composition_amounts,
    tokenize,
)
from validator import validate


def parse_pdf(path: Union[str, Path]) -> Dict[str, Any]:
    path = Path(path)
    content = extract_pdf_content(path)

    text_lines = content["text_lines"]
    normalized_lines: List[str] = []
    for line in text_lines:
        s = str(line).strip()
        if not s:
            continue
        normalized_lines.append(pre_normalize_line_for_ocr(s))

    tokens = tokenize(normalized_lines)
    tokens = detect_blocks(tokens)
    tokens = classify_lines(tokens)
    tokens = refine_trailing_composition_amounts(tokens)

    normalized = normalize(tokens)
    validated = validate(normalized)

    score = validated["score"]
    ratio = validated["score_ratio"]
    print(
        "[INFO] Score:",
        score,
        "/",
        validated["max_score"],
        f"({ratio:.2f})",
        file=sys.stderr,
    )

    if ratio < 0.7:
        print("[WARN] Usando LLM fallback", file=sys.stderr)

        tokens = classify_with_llm(tokens)
        tokens = refine_trailing_composition_amounts(tokens)
        normalized = normalize(tokens)
        validated = validate(normalized)

    validated["source_text"] = "\n".join(normalized_lines)
    return validated
