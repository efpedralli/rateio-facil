"use client";

import type { BalanceteValidationSummary } from "@/lib/balancete/import-types";
import type { BalanceteJobSummary } from "@/lib/balancete/types";

type Props = {
  summary: BalanceteJobSummary | null;
  validationsOk: boolean | null;
};

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li style={{ listStyle: "none", marginLeft: "-18px", paddingLeft: 0 }}>
      <span style={{ marginRight: 6 }}>{ok ? "✓" : "⚠"}</span>
      {label}
    </li>
  );
}

export function BalanceteSummaryCard({ summary, validationsOk }: Props) {
  if (!summary) return null;

  const vs: BalanceteValidationSummary | undefined = summary.validationSummary;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "16px",
        background: "#ffffff",
      }}
    >
      <h2 style={{ margin: "0 0 12px 0", fontSize: "1rem", fontWeight: 600 }}>Resumo</h2>
      <ul
        style={{
          margin: 0,
          paddingLeft: "18px",
          color: "#374151",
          fontSize: "0.92rem",
          lineHeight: 1.6,
        }}
      >
        <li>Lançamentos do mês (itens): {summary.lancamentosItemCount ?? summary.itemCount}</li>
        <li>Linhas do resumo do mês (PDF): {summary.resumoMesLineCount ?? 0}</li>
        <li>Linhas no resumo das contas: {summary.resumoContaCount}</li>
        <li>Linhas parseadas no total (incl. títulos/subtotais): {summary.entryCount}</li>
        <li>Grupos detectados: {summary.groupCount}</li>
        <li>Avisos e erros: {summary.issueCount} (erros: {summary.errorCount}, avisos: {summary.warningCount})</li>
        {summary.importFill ? (
          <li>
            Preenchimento do modelo: {summary.importFill.filledCells} células preenchidas;{" "}
            {summary.importFill.unmatchedPoolLines} linha(s) extra sem slot;{" "}
            {summary.importFill.unusedTemplateSlots} linha(s) do modelo sem valor
          </li>
        ) : null}
        {summary.competenceLabel ? (
          <li style={{ overflowWrap: "anywhere" }}>Competência (PDF): {summary.competenceLabel}</li>
        ) : null}
        {summary.condominiumName ? (
          <li style={{ overflowWrap: "anywhere" }}>Condomínio (PDF): {summary.condominiumName}</li>
        ) : null}
      </ul>
      {vs ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 6px 0", fontSize: "0.88rem", fontWeight: 600, color: "#111827" }}>
            Conferência com totais do PDF
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "18px",
              color: "#374151",
              fontSize: "0.88rem",
              lineHeight: 1.55,
            }}
          >
            <CheckRow ok={vs.groupSubtotalsOk} label="Subtotais por grupo" />
            <CheckRow ok={vs.receitasTotalOk} label="Total de receitas do mês" />
            <CheckRow ok={vs.despesasTotalOk} label="Total de despesas do mês" />
            <CheckRow ok={vs.resultadoMesOk} label="Resultado do mês (receitas − despesas)" />
            <CheckRow ok={vs.resumoContasOk} label="Equação resumo das contas (saldo)" />
            <CheckRow ok={vs.totalDisponivelOk} label="Total disponível vs saldos atuais" />
            {vs.unmatchedTemplateRows > 0 ? (
              <li style={{ listStyle: "disc" }}>
                Linhas do modelo sem correspondência: {vs.unmatchedTemplateRows}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {validationsOk !== null ? (
        <p
          style={{
            margin: "12px 0 0 0",
            fontSize: "0.9rem",
            fontWeight: 600,
            color: validationsOk ? "#047857" : "#b45309",
          }}
        >
          Situação geral: {validationsOk ? "nenhum erro bloqueante" : "há erros ou avisos a revisar"}
        </p>
      ) : null}
    </div>
  );
}
