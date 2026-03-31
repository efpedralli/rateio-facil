"use client";

import { ChangeEvent } from "react";

type Props = {
  disabled: boolean;
  busy: boolean;
  statusMessage: string | null;
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function BalanceteUploadCard({ disabled, busy, statusMessage, onFileSelected }: Props) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "16px",
        background: "#ffffff",
      }}
    >
      <h1 style={{ margin: "0 0 8px 0", fontSize: "1.5rem", lineHeight: 1.2 }}>Balancetes</h1>
      <p style={{ margin: "0 0 12px 0", color: "#4b5563", fontSize: "0.95rem" }}>
        Envie o PDF do balancete. O sistema interpreta receitas, despesas, resumo do mês e resumo das
        contas e gera o <strong>arquivo XLSX de importação</strong> no mesmo layout do modelo oficial
        (planilha pronta para envio ao sistema — não é uma planilha de auditoria).
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={disabled}
          onChange={onFileSelected}
          style={{ maxWidth: "100%" }}
        />
        {statusMessage ? (
          <span style={{ color: "#1f2937", fontSize: "0.9rem" }}>{statusMessage}</span>
        ) : null}
        {busy ? (
          <span style={{ color: "#4b5563", fontSize: "0.9rem" }}>Processando…</span>
        ) : null}
      </div>
    </div>
  );
}
