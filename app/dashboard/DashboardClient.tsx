"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

type Condominio = {
  id: string;
  externalId: string;
  nome: string;
};

type FileMeta = {
  rateioId: string;
  originalName: string;
  contentType: string;
  previewUrl: string;
};

type RateioRowValue = string | number | null;

type RateioResult = {
  condominioNome: string;
  columns: string[];
  rows: Array<Record<string, RateioRowValue>>;
};

type DashboardState =
  | "idle"
  | "loadingCondominios"
  | "uploading"
  | "parsing"
  | "loadingRateio"
  | "ready"
  | "error";

type AppRole = "ADMIN" | "OPERATOR";

type DashboardClientProps = {
  userRole: AppRole;
  userEmail: string;
};

type UploadResponse = {
  ok: boolean;
  rateio?: {
    id: string;
    arquivo?: {
      originalName?: string;
      mimeType?: string;
      path?: string;
    };
  };
  error?: string;
};

type ParseResponse = {
  ok: boolean;
  error?: string;
};

type RateioDetailResponse = {
  ok: boolean;
  condominio?: string;
  unidades?: Array<{
    bloco: string | null;
    unidade: string | null;
    total: number | null;
    composicao: Array<{
      descricao: string | null;
      valor: number | null;
    }>;
  }>;
  error?: string;
};

type PendenciasResponse = {
  ok: boolean;
  pendencias?: Array<unknown>;
};

const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "message/rfc822",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatBrl(value: RateioRowValue) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return brlFormatter.format(value);
  }

  if (typeof value === "string") {
    const normalized = Number(
      value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
    );

    if (Number.isFinite(normalized)) {
      return brlFormatter.format(normalized);
    }
  }

  return "—";
}

function formatCellValue(value: RateioRowValue) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function toCompetencia(monthValue: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(monthValue)) return null;
  return monthValue.replace("-", "");
}

function toPreviewUrl(rateioId: string) {
  return `/api/rateios/${encodeURIComponent(rateioId)}/arquivo`;
}

function buildRateioResult(payload: RateioDetailResponse): RateioResult {
  const unidades = payload.unidades ?? [];
  const compositionColumns = Array.from(
    new Set(
      unidades.flatMap((u) =>
        u.composicao
          .map((c) => (c.descricao ?? "").trim())
          .filter((desc): desc is string => Boolean(desc))
      )
    )
  );

  const columns = ["unidade", "bloco", "total", ...compositionColumns];

  const rows = unidades.map((u) => {
    const row: Record<string, RateioRowValue> = {
      unidade: u.unidade ?? "—",
      bloco: u.bloco ?? "—",
      total: u.total ?? null,
    };

    for (const column of compositionColumns) {
      const found = u.composicao.find((item) => (item.descricao ?? "").trim() === column);
      row[column] = found?.valor ?? null;
    }

    return row;
  });

  return {
    condominioNome: payload.condominio ?? "Rateio",
    columns,
    rows,
  };
}

export default function DashboardClient({ userRole, userEmail }: DashboardClientProps) {
  const [state, setState] = useState<DashboardState>("loadingCondominios");
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [selectedCondominioId, setSelectedCondominioId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [rateio, setRateio] = useState<RateioResult | null>(null);
  const [pendenciasCount, setPendenciasCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [launchingVouch, setLaunchingVouch] = useState(false);

  const isBusy =
    state === "loadingCondominios" ||
    state === "uploading" ||
    state === "parsing" ||
    state === "loadingRateio";

  const canUpload = Boolean(selectedCondominioId) && Boolean(toCompetencia(selectedMonth)) && !isBusy;

  const stateMessage = useMemo(() => {
    if (state === "loadingCondominios") return "Carregando condomínios...";
    if (state === "uploading") return "Uploading...";
    if (state === "parsing") return "Processando rateio...";
    if (state === "loadingRateio") return "Carregando dados do rateio...";
    return null;
  }, [state]);

  const allowedPages = useMemo(() => {
    const pages: Array<{ href: string; label: string }> = [{ href: "/dashboard", label: "Dashboard" }];
    if (userRole === "ADMIN") {
      pages.push({ href: "/admin/users", label: "Admin - Usuários" });
    }
    return pages;
  }, [userRole]);

  useEffect(() => {
    async function loadCondominios() {
      try {
        const response = await fetch("/api/condominios", { method: "GET" });
        if (!response.ok) {
          throw new Error("Falha ao carregar condomínios.");
        }

        const payload = (await response.json()) as { ok: boolean; condominios?: Condominio[] };
        if (!payload.ok || !Array.isArray(payload.condominios)) {
          throw new Error("Resposta inválida ao listar condomínios.");
        }

        setCondominios(payload.condominios);
        if (payload.condominios.length > 0) {
          setSelectedCondominioId(payload.condominios[0].id);
        }

        setState("idle");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro inesperado.";
        setErrorMessage(message);
        setState("error");
      }
    }

    void loadCondominios();
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!ACCEPTED_MIME_TYPES.includes(selectedFile.type)) {
      setState("error");
      setErrorMessage("Tipo de arquivo não suportado.");
      event.target.value = "";
      return;
    }

    const competencia = toCompetencia(selectedMonth);
    if (!selectedCondominioId || !competencia) {
      setState("error");
      setErrorMessage("Selecione condomínio e competência antes do upload.");
      event.target.value = "";
      return;
    }

    setErrorMessage(null);
    setRateio(null);
    setFileMeta(null);
    setPendenciasCount(null);
    setState("uploading");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("condominioId", selectedCondominioId);
      formData.append("competencia", competencia);
      formData.append("tabela", "0");

      const uploadResponse = await fetch("/api/rateios/upload", {
        method: "POST",
        body: formData,
      });

      const uploaded = (await uploadResponse.json()) as UploadResponse;
      if (!uploadResponse.ok || !uploaded?.ok || !uploaded.rateio?.id) {
        throw new Error(uploaded?.error || "Falha no upload do arquivo.");
      }

      const rateioId = uploaded.rateio.id;
      const contentType = uploaded.rateio.arquivo?.mimeType ?? selectedFile.type;
      const originalName = uploaded.rateio.arquivo?.originalName ?? selectedFile.name;

      setFileMeta({
        rateioId,
        originalName,
        contentType,
        previewUrl: toPreviewUrl(rateioId),
      });
      setState("parsing");

      const parseResponse = await fetch(`/api/rateios/${encodeURIComponent(rateioId)}/parse`, {
        method: "POST",
      });

      const parsedPayload = (await parseResponse.json()) as ParseResponse;
      if (!parseResponse.ok || !parsedPayload?.ok) {
        throw new Error(parsedPayload?.error || "Falha ao processar o rateio.");
      }

      setState("loadingRateio");

      const [rateioResponse, pendenciasResponse] = await Promise.all([
        fetch(`/api/rateios/${encodeURIComponent(rateioId)}`, { method: "GET" }),
        fetch(`/api/rateios/${encodeURIComponent(rateioId)}/pendencias`, { method: "GET" }),
      ]);

      const rateioPayload = (await rateioResponse.json()) as RateioDetailResponse;
      if (!rateioResponse.ok || !rateioPayload?.ok) {
        throw new Error(rateioPayload?.error || "Falha ao carregar rateio processado.");
      }

      const pendenciasPayload = (await pendenciasResponse.json()) as PendenciasResponse;
      if (pendenciasResponse.ok && pendenciasPayload.ok && Array.isArray(pendenciasPayload.pendencias)) {
        setPendenciasCount(pendenciasPayload.pendencias.length);
      } else {
        setPendenciasCount(null);
      }

      setRateio(buildRateioResult(rateioPayload));
      setState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado.";
      setState("error");
      setErrorMessage(message);
    } finally {
      event.target.value = "";
    }
  }

  async function handleLaunchVouch() {
    if (!fileMeta?.rateioId) return;
  
    try {
      setLaunchingVouch(true);
      setErrorMessage(null);
  
      const response = await fetch(
        `/api/rateios/${encodeURIComponent(fileMeta.rateioId)}/submit-vouch`,
        { method: "POST" }
      );
  
      const payload = await response.json();
  
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.result?.message || "Falha ao lançar no Vouch.");
      }
  
      alert(payload?.result?.message || "Lançamento concluído com sucesso.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado.";
      setErrorMessage(message);
    } finally {
      setLaunchingVouch(false);
    }
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.brandTitle}>Rateio Fácil</h1>
        <button
          type="button"
          style={styles.hamburgerButton}
          onClick={() => setDrawerOpen((prev) => !prev)}
          aria-label="Abrir menu"
          aria-expanded={drawerOpen}
          aria-controls="dashboard-drawer"
        >
          <span style={styles.hamburgerBar} />
          <span style={styles.hamburgerBar} />
          <span style={styles.hamburgerBar} />
        </button>
      </header>

      {drawerOpen ? (
        <button
          type="button"
          aria-label="Fechar menu"
          style={styles.drawerBackdrop}
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside
        id="dashboard-drawer"
        style={{
          ...styles.drawer,
          ...(drawerOpen ? styles.drawerOpen : styles.drawerClosed),
        }}
      >
        <div style={styles.drawerHeader}>
          <h2 style={styles.drawerTitle}>Menu</h2>
          <p style={styles.drawerMeta}>
            {userEmail}
            <br />
            Perfil: {userRole}
          </p>
        </div>

        <nav style={styles.drawerNav}>
          {allowedPages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              style={styles.drawerLink}
              onClick={() => setDrawerOpen(false)}
            >
              {page.label}
            </Link>
          ))}
        </nav>

        <form action="/api/auth/logout" method="POST" style={styles.logoutForm}>
          <button type="submit" style={styles.logoutButton}>
            Sair
          </button>
        </form>
      </aside>

      <section style={styles.main}>
        <section style={styles.uploadCard}>
          <h1 style={styles.pageTitle}>Dashboard Operacional</h1>
          <p style={styles.mutedText}>
            Selecione condomínio e competência antes de enviar o arquivo.
          </p>

          <div style={styles.filtersRow}>
            <label style={styles.field}>
              <span style={styles.label}>Condomínio</span>
              <select
                value={selectedCondominioId}
                onChange={(event) => setSelectedCondominioId(event.target.value)}
                disabled={isBusy || condominios.length === 0}
                style={styles.selectInput}
              >
                {condominios.length === 0 ? (
                  <option value="">Nenhum condomínio encontrado</option>
                ) : (
                  condominios.map((condominio) => (
                    <option key={condominio.id} value={condominio.id}>
                      {condominio.nome}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label style={styles.field}>
              <span style={styles.label}>Competência</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                disabled={isBusy}
                style={styles.selectInput}
              />
            </label>
          </div>

          <div style={styles.uploadRow}>
            <input
              type="file"
              accept=".pdf,.eml,.xlsx,.xls,application/pdf,message/rfc822,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={!canUpload}
              onChange={handleFileChange}
              style={styles.fileInput}
            />
            {stateMessage ? <span style={styles.statusText}>{stateMessage}</span> : null}
          </div>

          {errorMessage ? <p style={styles.errorText}>{errorMessage}</p> : null}

          {fileMeta ? (
            <p style={styles.fileMetaText}>
              Arquivo: <strong>{fileMeta.originalName}</strong> | Rateio ID:{" "}
              <strong>{fileMeta.rateioId}</strong>
            </p>
          ) : null}

          {pendenciasCount !== null ? (
            <p style={styles.pendenciasText}>Pendências abertas: {pendenciasCount}</p>
          ) : null}

{fileMeta?.rateioId && rateio ? (
  <button
    type="button"
    onClick={handleLaunchVouch}
    disabled={launchingVouch || isBusy}
    style={{
      border: "1px solid #111827",
      borderRadius: "8px",
      padding: "10px 14px",
      background: "#111827",
      color: "#fff",
      cursor: "pointer",
    }}
  >
    {launchingVouch ? "Lançando no Vouch..." : "Lançar no Vouch"}
  </button>
) : null}
        </section>

        <section style={styles.gridSection}>
          <div style={styles.tableCard}>
            <header style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>{rateio?.condominioNome || "Rateio"}</h2>
            </header>

            <div style={styles.tableScrollWrapper}>
              {rateio ? (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {rateio.columns.map((column) => (
                        <th key={column} style={styles.th}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rateio.rows.length > 0 ? (
                      rateio.rows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`} style={styles.tr}>
                          {rateio.columns.map((column) => {
                            const cellValue = row[column];
                            const normalizedColumn = column.toLowerCase();
                            const isIdentityColumn =
                              normalizedColumn === "unidade" || normalizedColumn === "bloco";

                            return (
                              <td key={`${rowIndex}-${column}`} style={styles.td}>
                                {isIdentityColumn ? formatCellValue(cellValue) : formatBrl(cellValue)}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={Math.max(rateio.columns.length, 1)} style={styles.emptyCell}>
                          Nenhuma linha encontrada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <div style={styles.placeholder}>Envie um arquivo para visualizar o rateio.</div>
              )}
            </div>
          </div>

          <div style={styles.previewCard}>
            <header style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>Arquivo original</h2>
            </header>

            <div style={styles.previewWrapper}>
              {fileMeta?.previewUrl ? (
                <iframe
                  src={fileMeta.previewUrl}
                  title="Preview do arquivo original"
                  style={styles.previewFrame}
                />
              ) : (
                <div style={styles.placeholder}>A prévia do arquivo aparecerá aqui.</div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    padding: "20px",
    background: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    margin: "0 auto 20px auto",
    maxWidth: "1400px",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandTitle: {
    margin: 0,
    fontSize: "1.2rem",
    fontWeight: 700,
    color: "#111827",
  },
  hamburgerButton: {
    width: "40px",
    height: "40px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: "4px",
    cursor: "pointer",
  },
  hamburgerBar: {
    width: "16px",
    height: "2px",
    background: "#111827",
    borderRadius: "2px",
  },
  drawerBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(17, 24, 39, 0.35)",
    border: 0,
    zIndex: 99,
  },
  drawer: {
    position: "fixed",
    right: 0,
    top: 0,
    width: "300px",
    maxWidth: "85vw",
    height: "100vh",
    border: "1px solid #e5e7eb",
    borderRight: 0,
    borderTop: 0,
    borderBottom: 0,
    background: "#ffffff",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    zIndex: 100,
    transition: "transform 0.2s ease",
  },
  drawerOpen: {
    transform: "translateX(0)",
  },
  drawerClosed: {
    transform: "translateX(100%)",
  },
  drawerHeader: {
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: "10px",
  },
  drawerTitle: {
    margin: "0 0 6px 0",
    fontSize: "1rem",
  },
  drawerMeta: {
    margin: 0,
    fontSize: "0.85rem",
    color: "#4b5563",
    overflowWrap: "anywhere",
  },
  drawerNav: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  drawerLink: {
    display: "block",
    padding: "8px 10px",
    borderRadius: "8px",
    textDecoration: "none",
    color: "#111827",
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    fontSize: "0.92rem",
  },
  logoutForm: {
    marginTop: "8px",
  },
  logoutButton: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "8px 10px",
    cursor: "pointer",
  },
  main: {
    margin: "0 auto",
    maxWidth: "1400px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  uploadCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "16px",
    background: "#ffffff",
  },
  pageTitle: {
    margin: "0 0 8px 0",
    fontSize: "1.5rem",
    lineHeight: 1.2,
  },
  mutedText: {
    margin: "0 0 12px 0",
    color: "#4b5563",
    fontSize: "0.95rem",
  },
  filtersRow: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "12px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "0.85rem",
    color: "#374151",
    fontWeight: 500,
  },
  selectInput: {
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#fff",
    fontSize: "0.92rem",
  },
  uploadRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
  },
  fileInput: {
    maxWidth: "100%",
  },
  statusText: {
    color: "#1f2937",
    fontSize: "0.9rem",
  },
  errorText: {
    margin: "12px 0 0 0",
    color: "#b91c1c",
    fontSize: "0.9rem",
  },
  fileMetaText: {
    margin: "12px 0 0 0",
    color: "#111827",
    fontSize: "0.9rem",
  },
  pendenciasText: {
    margin: "8px 0 0 0",
    color: "#92400e",
    fontSize: "0.9rem",
  },
  gridSection: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  },
  tableCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    minHeight: "520px",
  },
  previewCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    minHeight: "520px",
  },
  cardHeader: {
    padding: "14px 16px",
    borderBottom: "1px solid #e5e7eb",
  },
  cardTitle: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 600,
  },
  tableScrollWrapper: {
    overflow: "auto",
    maxHeight: "calc(100vh - 290px)",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: "680px",
  },
  th: {
    position: "sticky",
    top: 0,
    background: "#f9fafb",
    zIndex: 1,
    textAlign: "left",
    fontWeight: 600,
    fontSize: "0.85rem",
    color: "#374151",
    padding: "10px 12px",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
  },
  tr: {
    background: "#ffffff",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f3f4f6",
    fontSize: "0.9rem",
    color: "#111827",
    whiteSpace: "nowrap",
  },
  emptyCell: {
    padding: "18px 12px",
    color: "#6b7280",
    fontSize: "0.92rem",
  },
  previewWrapper: {
    flex: 1,
    overflow: "auto",
    minHeight: "420px",
  },
  previewFrame: {
    border: 0,
    width: "100%",
    minHeight: "100%",
    height: "100%",
  },
  placeholder: {
    color: "#6b7280",
    fontSize: "0.92rem",
    padding: "16px",
  },
};
