from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class LinhaNormalizada:
    arquivo_origem: str
    condominio: str
    periodo: str
    bloco: str
    categoria: str
    descricao: str
    valor: Optional[float]
    tipo_linha: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "arquivo_origem": self.arquivo_origem,
            "condominio": self.condominio,
            "periodo": self.periodo,
            "bloco": self.bloco,
            "categoria": self.categoria,
            "descricao": self.descricao,
            "valor": self.valor,
            "tipo_linha": self.tipo_linha,
        }


@dataclass
class ParseContext:
    condominio: str = ""
    periodo: str = ""
    rows: List[LinhaNormalizada] = field(default_factory=list)
