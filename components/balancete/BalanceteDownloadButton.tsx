"use client";

type Props = {
  downloadUrl: string | null;
  disabled?: boolean;
  label?: string;
  variant?: "primary" | "secondary";
};

const primaryStyle = {
  display: "inline-block" as const,
  border: "1px solid #111827",
  borderRadius: "8px",
  padding: "10px 14px",
  background: "#111827",
  color: "#fff",
  textDecoration: "none" as const,
  fontSize: "0.92rem",
};

const secondaryStyle = {
  ...primaryStyle,
  border: "1px solid #6b7280",
  background: "#ffffff",
  color: "#111827",
};

export function BalanceteDownloadButton({
  downloadUrl,
  disabled,
  label = "Baixar arquivo de importação (XLSX)",
  variant = "primary",
}: Props) {
  if (!downloadUrl) return null;

  const base = variant === "secondary" ? secondaryStyle : primaryStyle;

  return (
    <a
      href={downloadUrl}
      download
      style={{
        ...base,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {label}
    </a>
  );
}
