"use client";

type Props = {
  downloadUrl: string | null;
  disabled?: boolean;
};

export function BalanceteDownloadButton({ downloadUrl, disabled }: Props) {
  if (!downloadUrl) return null;

  return (
    <a
      href={downloadUrl}
      download
      style={{
        display: "inline-block",
        border: "1px solid #111827",
        borderRadius: "8px",
        padding: "10px 14px",
        background: "#111827",
        color: "#fff",
        textDecoration: "none",
        fontSize: "0.92rem",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      Baixar arquivo de importação (XLSX)
    </a>
  );
}
