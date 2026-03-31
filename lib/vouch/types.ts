export type VouchCampo = {
    ordem: number;
    item: number;
    descricao: string;
    antecipa?: boolean | null;
    repassa?: boolean | null;
    parcela?: number | null;
    parcelas?: number | null;
  };
  
  export type VouchUnidadeDado = {
    bloco: string;
    unidade: string;
    total: number;
    composicao: Array<{
      ordem: number;
      item: number;
      descricao: string;
      valor: number;
      parcela?: number | null;
      parcelas?: number | null;
    }>;
  };
  
  export type VouchRateioPayload = {
    rateioId: string;
    condominioNome: string;
    competencia: string;
    campos: VouchCampo[];
    unidades: VouchUnidadeDado[];
  };