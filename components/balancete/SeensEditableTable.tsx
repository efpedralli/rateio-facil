"use client";

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  type ClipboardEvent,
  type CSSProperties,
} from "react";
import type { CanonicalBalanceteExportPayload } from "@/lib/balancete/canonical-export-payload";
import {
  buildSeensGridRows,
  filterItemEntriesForGroup,
  orderedGroupsFromPayload,
  rowIsBold,
  roundMoney2,
  sumEntryValues,
  updateSeensAccount,
  updateSeensAccountName,
  updateSeensEntry,
  updateSeensGroupName,
  updateSeensMetaText,
  updateSeensSummary,
  type SeensGridRow,
} from "@/lib/balancete/seens-grid-rows";

const moneyFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(n: number): string {
  return moneyFmt.format(n);
}

function parseMoneyInput(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(/R\$/gi, "");
  if (!t) return null;
  const normalized = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : t;
  const x = parseFloat(normalized);
  return Number.isFinite(x) ? roundMoney2(x) : null;
}

function groupBlockTotal(
  payload: CanonicalBalanceteExportPayload,
  section: string,
  group: string
): number {
  const k = `${section}\n${group}`;
  const { groups } = orderedGroupsFromPayload(payload.entries);
  const block = groups.get(k) ?? [];
  return sumEntryValues(filterItemEntriesForGroup(block));
}

function summaryNumber(payload: CanonicalBalanceteExportPayload, key: string): number {
  const v = payload.summary[key];
  return typeof v === "number" && Number.isFinite(v) ? roundMoney2(v) : 0;
}

type FocusRef = { rowIndex: number; col: "desc" | "valor" } | null;

type Props = {
  data: CanonicalBalanceteExportPayload;
  onDataChange: (next: CanonicalBalanceteExportPayload) => void;
  downloading?: boolean;
  onDownload: () => void;
};

export function SeensEditableTable({
  data,
  onDataChange,
  downloading,
  onDownload,
}: Props) {
  const rows = useMemo(() => buildSeensGridRows(data), [data]);
  const [focus, setFocus] = useState<FocusRef>(null);

  const applyPasteGrid = useCallback(
    (startRow: number, startCol: "desc" | "valor", text: string) => {
      const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      if (!lines.length) return;

      let next = data;
      let r = startRow;
      let col = startCol;

      for (const line of lines) {
        if (r >= rows.length) break;
        const parts = line.split("\t");
        const gridRow = rows[r];

        const applyDesc = (s: string) => {
          if (gridRow.kind !== "entry") return;
          next = updateSeensEntry(next, gridRow.entryIndex, {
            descricao: s.trim(),
          });
        };
        const applyVal = (s: string) => {
          const n = parseMoneyInput(s);
          if (n === null) return;
          if (gridRow.kind === "entry") {
            next = updateSeensEntry(next, gridRow.entryIndex, { valor: n });
          } else if (gridRow.kind === "summary_row") {
            next = updateSeensSummary(next, gridRow.summaryKey, n);
          } else if (gridRow.kind === "account_line") {
            next = updateSeensAccount(next, gridRow.accountIndex, gridRow.field, n);
          }
        };

        if (parts.length >= 2) {
          if (gridRow.kind === "entry") {
            applyDesc(parts[0] ?? "");
            applyVal(parts[1] ?? "");
          }
          r += 1;
          col = startCol;
          continue;
        }

        const cell = parts[0] ?? "";
        if (gridRow.kind === "entry") {
          if (col === "desc") {
            applyDesc(cell);
            col = "valor";
          } else {
            applyVal(cell);
            col = "desc";
            r += 1;
          }
        } else if (gridRow.kind === "summary_row") {
          if (col === "valor" || startCol === "valor") applyVal(cell);
          r += 1;
          col = startCol;
        } else if (gridRow.kind === "account_line") {
          if (col === "valor" || startCol === "valor") applyVal(cell);
          r += 1;
          col = startCol;
        } else {
          r += 1;
          col = startCol;
        }
      }

      onDataChange(next);
    },
    [data, onDataChange, rows]
  );

  const onTablePaste = useCallback(
    (e: ClipboardEvent<HTMLTableElement>) => {
      if (!focus) return;
      const t = e.clipboardData?.getData("text/plain");
      if (!t || !t.includes("\t") && !t.includes("\n")) return;
      e.preventDefault();
      applyPasteGrid(focus.rowIndex, focus.col, t);
    },
    [applyPasteGrid, focus]
  );

  return (
    <div style={wrap}>
      <header style={toolbar}>
        <span style={meta}>Modelo Seens</span>
        <button
          type="button"
          style={{
            ...btnPrimary,
            ...(downloading ? { opacity: 0.6, cursor: "not-allowed" } : {}),
          }}
          disabled={!!downloading}
          onClick={onDownload}
        >
          {downloading ? "Gerando XLSX…" : "Baixar modelo Seens (XLSX)"}
        </button>
      </header>

      <div style={scrollWrap}>
        <table style={table} onPaste={onTablePaste} tabIndex={-1}>
          <thead>
            <tr>
              <th style={{ ...th, width: "58%" }}>Descrição (C)</th>
              <th style={{ ...th, ...thRight, width: "42%" }}>Valor (L)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <SeensRowView
                key={row.id}
                row={row}
                rowIndex={rowIndex}
                data={data}
                focus={focus}
                setFocus={setFocus}
                onDataChange={onDataChange}
                bold={rowIsBold(row)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SeensRowView({
  row,
  rowIndex,
  data,
  focus,
  setFocus,
  onDataChange,
  bold,
}: {
  row: SeensGridRow;
  rowIndex: number;
  data: CanonicalBalanceteExportPayload;
  focus: FocusRef;
  setFocus: (f: FocusRef) => void;
  onDataChange: (next: CanonicalBalanceteExportPayload) => void;
  bold: boolean;
}) {
  const tdDesc: CSSProperties = {
    ...td,
    fontWeight: bold ? 600 : 400,
    verticalAlign: "middle",
  };
  const tdVal: CSSProperties = {
    ...td,
    ...tdRight,
    fontWeight: bold ? 600 : 400,
    verticalAlign: "middle",
  };

  if (row.kind === "summary_break") {
    return (
      <tr>
        <td colSpan={2} style={{ height: 10, border: "none", padding: 0 }} />
      </tr>
    );
  }

  if (row.kind === "section") {
    return (
      <tr>
        <td style={{ ...tdDesc, background: "#f3f4f6" }}>
          <EditableText
            value={row.title}
            focused={focus?.rowIndex === rowIndex && focus.col === "desc"}
            onFocus={() => setFocus({ rowIndex, col: "desc" })}
            onBlur={() => setFocus(null)}
            onCommit={(s) =>
              onDataChange(updateSeensGroupName(data, row.section, row.group, s))
            }
          />
        </td>
        <td style={{ ...tdVal, background: "#f3f4f6" }} />
      </tr>
    );
  }

  if (row.kind === "accounts_banner") {
    const title =
      (data.metadata as Record<string, unknown>)?.seens_accounts_banner
        ? String((data.metadata as Record<string, unknown>).seens_accounts_banner)
        : row.title;
    return (
      <tr>
        <td style={{ ...tdDesc, background: "#f3f4f6" }}>
          <EditableText
            value={title}
            focused={focus?.rowIndex === rowIndex && focus.col === "desc"}
            onFocus={() => setFocus({ rowIndex, col: "desc" })}
            onBlur={() => setFocus(null)}
            onCommit={(s) => onDataChange(updateSeensMetaText(data, "seens_accounts_banner", s))}
          />
        </td>
        <td style={{ ...tdVal, background: "#f3f4f6" }} />
      </tr>
    );
  }

  if (row.kind === "account_title") {
    const nome = data.accounts[row.accountIndex]?.nome ?? "CONTA";
    return (
      <tr>
        <td style={{ ...tdDesc, background: "#f9fafb" }}>
          <EditableText
            value={nome}
            focused={focus?.rowIndex === rowIndex && focus.col === "desc"}
            onFocus={() => setFocus({ rowIndex, col: "desc" })}
            onBlur={() => setFocus(null)}
            onCommit={(s) => onDataChange(updateSeensAccountName(data, row.accountIndex, s))}
          />
        </td>
        <td style={{ ...tdVal, background: "#f9fafb" }} />
      </tr>
    );
  }

  if (row.kind === "group_total") {
    const total = groupBlockTotal(data, row.section, row.group);
    return (
      <tr>
        <td style={tdDesc}>TOTAL</td>
        <td style={tdVal}>{formatMoney(total)}</td>
      </tr>
    );
  }

  if (row.kind === "summary_header") {
    const title =
      (data.metadata as Record<string, unknown>)?.seens_month_summary_title
        ? String((data.metadata as Record<string, unknown>).seens_month_summary_title)
        : row.title;
    return (
      <tr>
        <td style={{ ...tdDesc, background: "#f9fafb" }}>
          <EditableText
            value={title}
            focused={focus?.rowIndex === rowIndex && focus.col === "desc"}
            onFocus={() => setFocus({ rowIndex, col: "desc" })}
            onBlur={() => setFocus(null)}
            onCommit={(s) => onDataChange(updateSeensMetaText(data, "seens_month_summary_title", s))}
          />
        </td>
        <td style={{ ...tdVal, background: "#f9fafb" }} />
      </tr>
    );
  }

  if (row.kind === "entry") {
    const ent = data.entries[row.entryIndex];
    const desc = ent?.descricao ?? "";
    const val = ent?.valor ?? 0;
    return (
      <tr>
        <td style={tdDesc}>
          <EditableText
            value={desc}
            focused={focus?.rowIndex === rowIndex && focus.col === "desc"}
            onFocus={() => setFocus({ rowIndex, col: "desc" })}
            onBlur={() => setFocus(null)}
            onCommit={(s) =>
              onDataChange(
                updateSeensEntry(data, row.entryIndex, { descricao: s })
              )
            }
          />
        </td>
        <td style={tdVal}>
          <EditableMoney
            value={val}
            focused={focus?.rowIndex === rowIndex && focus.col === "valor"}
            onFocus={() => setFocus({ rowIndex, col: "valor" })}
            onBlur={() => setFocus(null)}
            onCommit={(n) =>
              onDataChange(
                updateSeensEntry(data, row.entryIndex, { valor: n })
              )
            }
          />
        </td>
      </tr>
    );
  }

  if (row.kind === "summary_row") {
    const num = summaryNumber(data, row.summaryKey);
    return (
      <tr>
        <td style={tdDesc}>{row.label}</td>
        <td style={tdVal}>
          <EditableMoney
            value={num}
            focused={focus?.rowIndex === rowIndex && focus.col === "valor"}
            onFocus={() => setFocus({ rowIndex, col: "valor" })}
            onBlur={() => setFocus(null)}
            onCommit={(n) =>
              onDataChange(updateSeensSummary(data, row.summaryKey, n))
            }
          />
        </td>
      </tr>
    );
  }

  if (row.kind === "account_line") {
    const acc = data.accounts[row.accountIndex];
    const raw =
      acc?.[row.field as keyof typeof acc];
    const num = typeof raw === "number" ? roundMoney2(raw) : 0;
    return (
      <tr>
        <td style={{ ...tdDesc, fontWeight: 400 }}>{row.label}</td>
        <td style={{ ...tdVal, fontWeight: 400 }}>
          <EditableMoney
            value={num}
            focused={focus?.rowIndex === rowIndex && focus.col === "valor"}
            onFocus={() => setFocus({ rowIndex, col: "valor" })}
            onBlur={() => setFocus(null)}
            onCommit={(n) =>
              onDataChange(
                updateSeensAccount(data, row.accountIndex, row.field, n)
              )
            }
          />
        </td>
      </tr>
    );
  }

  return null;
}

function EditableText({
  value,
  focused,
  onFocus,
  onBlur,
  onCommit,
}: {
  value: string;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onCommit: (s: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <input
      type="text"
      value={focused ? draft : value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        setDraft(value);
        onFocus();
      }}
      onBlur={() => {
        onCommit(draft.trim());
        onBlur();
      }}
      style={inputPlain}
    />
  );
}

function EditableMoney({
  value,
  focused,
  onFocus,
  onBlur,
  onCommit,
}: {
  value: number;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onCommit: (n: number) => void;
}) {
  const display = formatMoney(value);
  const [draft, setDraft] = useState(display);
  useEffect(() => {
    if (!focused) setDraft(display);
  }, [display, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? draft : display}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        setDraft(display);
        onFocus();
      }}
      onBlur={() => {
        const n = parseMoneyInput(draft);
        onCommit(n ?? value);
        onBlur();
      }}
      style={inputMoney}
    />
  );
}

const wrap: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  minHeight: 520,
  overflow: "hidden",
};

const toolbar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "14px 16px",
  borderBottom: "1px solid #e5e7eb",
};

const meta: CSSProperties = { fontSize: "0.85rem", color: "#4b5563" };

const btnPrimary: CSSProperties = {
  border: "1px solid #111827",
  borderRadius: 8,
  padding: "10px 14px",
  background: "#111827",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.92rem",
};

const scrollWrap: CSSProperties = {
  overflow: "auto",
  maxHeight: "calc(100vh - 290px)",
  flex: 1,
};

const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const thRight: CSSProperties = { textAlign: "right" };

const td: CSSProperties = {
  borderBottom: "1px solid #f3f4f6",
  padding: "4px 8px",
};

const tdRight: CSSProperties = { textAlign: "right" };

const inputPlain: CSSProperties = {
  width: "100%",
  border: "1px solid transparent",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: "0.88rem",
  background: "transparent",
  boxSizing: "border-box",
};

const inputMoney: CSSProperties = {
  ...inputPlain,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
