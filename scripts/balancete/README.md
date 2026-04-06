# Parser de balancete (pipeline semântico)

Fluxo: extração PDF → tokenização → detecção de blocos → classificação de linhas → normalização → validação (score). Se a confiança for baixa (`score_ratio` &lt; 0,7), o sistema tenta classificar linhas via **Ollama** (opcional).

## Dependências Python

Na raiz do projeto ou em `scripts/balancete/`:

```bash
pip install -r scripts/balancete/requirements.txt
```

## Ollama (fallback com LLM local)

Instalação no **Linux/macOS**:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull phi3
```

No **Windows**, instale o Ollama pelo instalador em [ollama.com](https://ollama.com/download) e, no terminal:

```bash
ollama pull phi3
```

O cliente usa por padrão `http://localhost:11434/api/generate` e o modelo `phi3`. Com o Ollama parado, o fallback falha em silêncio e permanece o resultado do parser semântico.

## CLI (JSON para o app Node)

```bash
cd scripts/balancete
python parse_balancete_pdf.py caminho/para/balancete.pdf "Nome exibido.pdf"
```

## Módulos

| Arquivo | Função |
|--------|--------|
| `extract_pdf.py` | `extract_pdf_content` — texto e tabelas (pdfplumber) |
| `tokenizer.py` | `tokenize` — linhas → tokens com valor monetário BR |
| `block_detector.py` | `detect_blocks` — RECEITAS / DESPESAS / RESUMO / CONTAS |
| `line_classifier.py` | `classify_lines` — ITEM, CATEGORY, TOTAL, RESUMO, CONTA |
| `normalizer.py` | `normalize` — entradas, resumo, contas |
| `validator.py` | `validate` — score e status |
| `llm_client.py` | `call_llm` — API Ollama |
| `llm_fallback.py` | `classify_with_llm` — JSON por linha |
| `parse_balancete.py` | `parse_pdf` — orquestrador |
| `semantic_bridge.py` | compatibilidade com `leitor_adapter.rows_to_parse_json` |
| `export_xlsx.py` | `export_balancete_to_xlsx` — gera `.xlsx` padrão (abas Lancamentos, Resumo, Contas), **sem template em `models/`** |

### Exportação XLSX (sem template)

O app Node grava `canonical_export.json` e chama:

```bash
python export_xlsx.py caminho/canonical_export.json saida.xlsx
```

Sem argumentos, gera `teste_balancete.xlsx` com dados de exemplo.

O pacote legado `leitor_balancete/` permanece disponível para uso offline (CSV/XLSX) via `python -m leitor_balancete`.
