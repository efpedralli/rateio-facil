from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Union

from block_detector import detect_blocks
from extract_pdf import extract_pdf_content
from line_classifier import classify_lines
from llm_fallback import classify_with_llm
from normalizer import normalize
from tokenizer import refine_trailing_composition_amounts, tokenize
from validator import validate


def parse_pdf(path: Union[str, Path]) -> Dict[str, Any]:
    path = Path(path)
    content = extract_pdf_content(path)

    tokens = tokenize(content["text_lines"])
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

    validated["source_text"] = "\n".join(content["text_lines"])
    return validated
