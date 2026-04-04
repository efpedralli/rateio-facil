from __future__ import annotations

import re
from pathlib import Path
from typing import List

import click

from .export_excel import save_csv, save_xlsx12
from .parse_balancete import parse_pdf

# Pasta padrão na raiz do projeto (relativa ao diretório de trabalho atual)
DEFAULT_PDF_DIR = Path("pdfs")
DEFAULT_SAIDA_DIR = Path("saida")

_RE_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_stem(pdf_path: Path) -> str:
    """Nome base seguro para Windows (evita caracteres inválidos no arquivo)."""
    stem = pdf_path.stem
    stem = _RE_INVALID_FILENAME.sub("_", stem)
    stem = stem.strip(" .")
    if not stem:
        stem = "balancete"
    return stem[:200]


def _list_pdfs_in_dir(directory: Path) -> List[Path]:
    if not directory.is_dir():
        return []
    return sorted(directory.glob("*.pdf"))


def _resolve_input_paths(explicit: tuple[Path, ...]) -> List[Path]:
    if explicit:
        return list(explicit)
    found = _list_pdfs_in_dir(DEFAULT_PDF_DIR)
    if not found:
        hint = (
            f"Coloque arquivos .pdf em {DEFAULT_PDF_DIR.resolve()} "
            "ou informe os caminhos dos PDFs na linha de comando."
        )
        if not DEFAULT_PDF_DIR.is_dir():
            raise click.UsageError(
                f"A pasta {DEFAULT_PDF_DIR} não existe. Crie-a e adicione os PDFs, "
                "ou passe os arquivos como argumentos. " + hint
            )
        raise click.UsageError(
            f"Nenhum PDF em {DEFAULT_PDF_DIR.resolve()}. " + hint
        )
    return found


@click.command()
@click.argument(
    "pdfs",
    nargs=-1,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
@click.option(
    "--saida",
    "saida_dir",
    type=click.Path(path_type=Path),
    default=DEFAULT_SAIDA_DIR,
    help="Pasta onde serão gravados um .csv e um .xlsx por PDF (nome base = nome do PDF).",
)
def main(pdfs: tuple, saida_dir: Path) -> None:
    """Lê um ou mais PDFs de balancete e grava um CSV e um XLSX por arquivo.

    Sem argumentos, lê todos os *.pdf da pasta ``pdfs/`` (na raiz do projeto).
    """
    paths = _resolve_input_paths(pdfs)
    saida_dir = saida_dir.resolve()
    saida_dir.mkdir(parents=True, exist_ok=True)

    if not pdfs:
        click.echo(f"Lendo {len(paths)} PDF(s) em {DEFAULT_PDF_DIR.resolve()}")
    click.echo(f"Saída: {saida_dir}")

    total_linhas = 0
    for pdf_path in paths:
        linhas = parse_pdf(pdf_path)
        total_linhas += len(linhas)
        base = _safe_stem(pdf_path)
        csv_path = saida_dir / f"{base}.csv"
        xlsx_path = saida_dir / f"{base}.xlsx"
        save_csv(linhas, csv_path)
        save_xlsx12(linhas, xlsx_path)
        click.echo(f"  {pdf_path.name} -> {csv_path.name} ({len(linhas)} linhas), {xlsx_path.name}")

    click.echo(f"Concluído: {len(paths)} PDF(s), {total_linhas} linhas no total.")


if __name__ == "__main__":
    main()
