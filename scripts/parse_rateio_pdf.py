import sys, json, re
import pdfplumber

MONEY_RE = re.compile(r"(-?\d[\d.]*,\d{2})\s*$", re.UNICODE)

# Depois de normalizar, esperamos algo como:
# "BLOCO 01 101 - NOME"
HEADER_NORMAL_RE = re.compile(
    r"^BLOCO\s+(\d{1,4})\s+(\d{1,6})\s*[-–]{1,2}\s*(.+)$",
    re.IGNORECASE
)

# Linha duplicada típica do seu PDF: "BBLLOOCCOO ..." (B repetido 2x, etc.)
# Aqui detectamos sinais fortes do padrão duplicado.
DUPLICATED_HINT_RE = re.compile(r"B+B+L+L+O+O+C+C+O+O+", re.IGNORECASE)

def clean_line(s: str) -> str:
    s = (s or "").replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def br_money_to_float(s: str) -> float:
    s = s.replace(".", "").replace(",", ".")
    return float(s)

def undouble_pairs(s: str) -> str:
    """
    Remove duplicação em pares: AA -> A, BB -> B, etc.
    Mantém caracteres únicos.
    Ex:
      BBLLOOCCOO -> BLOCO
      0011 -> 01
      110011 -> 101
    """
    out = []
    i = 0
    while i < len(s):
        if i + 1 < len(s) and s[i] == s[i + 1]:
            out.append(s[i])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)

def detect_duplicated_text(sample_lines: list[str]) -> bool:
    """
    Detecta se o PDF está com caracteres duplicados.
    Critérios (qualquer um acende):
    - aparece "BBLLOOCCOO" / padrão forte
    - existe linha que vira um cabeçalho válido só após desduplicar
    """
    # 1) sinal forte
    for ln in sample_lines:
        if DUPLICATED_HINT_RE.search(ln):
            return True

    # 2) tentativa: se ao desduplicar a linha vira um header válido, é bem provável
    for ln in sample_lines:
        ln_clean = clean_line(ln)
        if "BLOCO" in ln_clean.upper():
            # se já for header normal, não precisamos marcar como duplicado
            if HEADER_NORMAL_RE.match(ln_clean):
                continue
            ln_und = clean_line(undouble_pairs(ln_clean))
            if HEADER_NORMAL_RE.match(ln_und):
                return True

    return False

def normalize_header_line(line: str, duplicated: bool) -> str:
    """
    Normaliza apenas linhas candidatas a cabeçalho de unidade.
    Se duplicated=True, tenta corrigir duplicação *mas só se isso fizer sentido*.
    """
    line = clean_line(line)

    # se já é um header normal, não toca
    if HEADER_NORMAL_RE.match(line):
        return line

    if not duplicated:
        return line

    # Só tenta desduplicar se há indício de duplicação na própria linha
    # (ex: "BBLLOOCCOO", ou muitos caracteres duplicados)
    if DUPLICATED_HINT_RE.search(line) or "BLOCO" in line.upper():
        candidate = clean_line(undouble_pairs(line))

        # Só aceitamos a versão desduplicada se virar header válido
        if HEADER_NORMAL_RE.match(candidate):
            return candidate

    return line

def parse_pdf(pdf_path: str):
    units = []
    current = None

    # 1) Coleta um sample inicial para detectar duplicação
    sample = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:3]:  # basta 1-3 páginas
            t = page.extract_text() or ""
            for raw in t.splitlines():
                if raw.strip():
                    sample.append(raw)
            if len(sample) >= 80:
                break

    duplicated = detect_duplicated_text(sample)

    # 2) Parse real
    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if not text.strip():
                continue

            for raw in text.splitlines():
                raw_clean = clean_line(raw)
                if not raw_clean:
                    continue

                # Normaliza somente se parecer header
                maybe_header = raw_clean
                if "BLOCO" in raw_clean.upper() or DUPLICATED_HINT_RE.search(raw_clean):
                    maybe_header = normalize_header_line(raw_clean, duplicated)

                m = HEADER_NORMAL_RE.match(maybe_header)
                if m:
                    if current:
                        units.append(current)

                    bloco_raw, unidade_raw, nome = m.group(1), m.group(2), m.group(3)

                    # bloco "01"
                    bloco = str(int(bloco_raw)).zfill(2) if bloco_raw.isdigit() else bloco_raw.zfill(2)
                    # unidade "101" etc.
                    unidade = str(int(unidade_raw)) if unidade_raw.isdigit() else unidade_raw

                    current = {
                        "bloco": bloco,
                        "unidade": unidade,
                        "nome": nome.strip(),
                        "lines": [],
                        "pageStart": page_index,
                    }
                    continue

                # linhas internas da unidade
                if current:
                    line = raw_clean  # NÃO desduplicar aqui (evita estragar números como 11)
                    mm = MONEY_RE.search(line)
                    value = None
                    desc = line

                    if mm:
                        value = br_money_to_float(mm.group(1))
                        desc = clean_line(line[: mm.start()].strip(" -"))

                    current["lines"].append({
                        "page": page_index,
                        "desc": desc,
                        "value": value
                    })

    if current:
        units.append(current)

    return {
        "units": units,
        "meta": {
            "parserVersion": "mvp-0.3",
            "duplicatedTextDetected": duplicated,
            "unitHeadersFound": len(units),
        }
    }

if __name__ == "__main__":
    pdf_path = sys.argv[1]
    data = parse_pdf(pdf_path)
    print(json.dumps(data, ensure_ascii=False))