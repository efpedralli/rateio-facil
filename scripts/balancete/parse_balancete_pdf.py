"""
CLI: PDF → pipeline semântico (parse_balancete) → JSON canônico (stdout) para o engine Node.

Uso:
  python parse_balancete_pdf.py <caminho_pdf> [nome_original_arquivo]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from leitor_adapter import rows_to_parse_json
from parse_balancete import parse_pdf
from semantic_bridge import validated_to_rows


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python parse_balancete_pdf.py <pdf> [nome_exibicao]", file=sys.stderr)
        sys.exit(2)
    pdf_path = sys.argv[1]
    file_name = sys.argv[2] if len(sys.argv) > 2 else pdf_path
    validated = parse_pdf(Path(pdf_path))
    full_text = str(validated.get("source_text") or "")
    rows = validated_to_rows(validated, file_name=file_name, full_text=full_text)
    result = rows_to_parse_json(
        rows, file_name, parser_layout_id="semantic_pipeline_v1"
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
