"use client";

import type { CSSProperties } from "react";
import type { BalanceteValidationIssue } from "@/lib/balancete/types";

type Props = {
  issues: BalanceteValidationIssue[];
};

export function BalanceteIssuesList({ issues }: Props) {
  if (!issues.length) {
    return (
      <p style={{ margin: 0, color: "#6b7280", fontSize: "0.92rem" }}>Nenhum aviso ou erro registrado.</p>
    );
  }

  const sorted = [...issues].sort((a, b) => {
    if (a.type !== b.type) return a.type === "ERROR" ? -1 : 1;
    return a.code.localeCompare(b.code);
  });

  return (
    <div style={{ overflow: "auto", maxHeight: "320px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            <th style={th}>Tipo</th>
            <th style={th}>Código</th>
            <th style={th}>Mensagem</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((issue, i) => (
            <tr key={`${issue.code}-${i}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={td}>
                <span
                  style={{
                    fontWeight: 600,
                    color: issue.type === "ERROR" ? "#b91c1c" : "#a16207",
                  }}
                >
                  {issue.type}
                </span>
              </td>
              <td style={td}>{issue.code}</td>
              <td style={{ ...td, whiteSpace: "normal", maxWidth: "420px" }}>{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  color: "#374151",
};

const td: CSSProperties = {
  padding: "8px 10px",
  verticalAlign: "top",
  color: "#111827",
};
