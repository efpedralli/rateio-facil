"""
CLI: lê PDF, extrai texto, aplica transform_balancete e imprime JSON no stdout.

Uso:
  python parse_balancete_pdf.py <caminho_pdf> [nome_original_arquivo]
"""

from __future__ import annotations

import json
import sys

from extract_pdf_text import extract_lines_from_pdf
from transform_balancete import transform_lines_to_result


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python parse_balancete_pdf.py <pdf> [nome_exibicao]", file=sys.stderr)
        sys.exit(2)
    pdf_path = sys.argv[1]
    file_name = sys.argv[2] if len(sys.argv) > 2 else pdf_path
    lines = extract_lines_from_pdf(pdf_path)
    result = transform_lines_to_result(lines, file_name)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
