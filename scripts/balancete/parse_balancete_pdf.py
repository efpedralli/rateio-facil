"""
CLI: PDF → leitor_balancete.parse_pdf → JSON canônico (stdout) para o engine Node.

Uso:
  python parse_balancete_pdf.py <caminho_pdf> [nome_original_arquivo]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from leitor_balancete.parse_balancete import parse_pdf
from leitor_adapter import rows_to_parse_json


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python parse_balancete_pdf.py <pdf> [nome_exibicao]", file=sys.stderr)
        sys.exit(2)
    pdf_path = sys.argv[1]
    file_name = sys.argv[2] if len(sys.argv) > 2 else pdf_path
    rows = parse_pdf(Path(pdf_path))
    result = rows_to_parse_json(rows, file_name)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
