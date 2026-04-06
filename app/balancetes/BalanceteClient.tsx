"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { BalanceteUploadCard } from "@/components/balancete/BalanceteUploadCard";
import { SeensEditableTable } from "@/components/balancete/SeensEditableTable";
import type { CanonicalBalanceteExportPayload } from "@/lib/balancete/canonical-export-payload";

type AppRole = "ADMIN" | "OPERATOR";

type Props = {
  userRole: AppRole;
  userEmail: string;
};

type UploadApiResponse = {
  ok: boolean;
  id?: string;
  exportPayload?: CanonicalBalanceteExportPayload | null;
  error?: string;
};

type PageState = "idle" | "uploading" | "error" | "done";

export default function BalanceteClient({ userRole, userEmail }: Props) {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [data, setData] = useState<CanonicalBalanceteExportPayload | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seensDownloading, setSeensDownloading] = useState(false);

  const busy = pageState === "uploading";
  const statusMessage = busy ? "Enviando e processando PDF…" : null;

  const allowedPages = useMemo(() => {
    const pages: Array<{ href: string; label: string }> = [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/balancetes", label: "Balancetes" },
    ];
    if (userRole === "ADMIN") {
      pages.push({ href: "/admin/users", label: "Admin - Usuários" });
    }
    return pages;
  }, [userRole]);

  const pdfSrc = jobId
    ? `/api/balancetes/${encodeURIComponent(jobId)}/pdf`
    : null;

  const onDataChange = useCallback((next: CanonicalBalanceteExportPayload) => {
    setData(next);
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    setPageState("uploading");
    setErrorMessage(null);
    setData(null);
    setJobId(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/balancetes/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as UploadApiResponse;

      if (!response.ok || !payload.ok) {
        setJobId(payload.id ?? null);
        throw new Error(payload.error || "Falha no upload ou processamento.");
      }

      if (!payload.exportPayload) {
        setJobId(payload.id ?? null);
        throw new Error("Resposta sem dados estruturados para o modelo Seens.");
      }

      setData(payload.exportPayload);
      setJobId(payload.id ?? null);
      setPageState("done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro inesperado.";
      setErrorMessage(message);
      setPageState("error");
    } finally {
      input.value = "";
    }
  }

  const handleDownloadSeens = useCallback(async () => {
    if (!jobId || !data) return;
    setSeensDownloading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/balancetes/${encodeURIComponent(jobId)}/build-seens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          credentials: "include",
        }
      );
      if (!res.ok) {
        let msg = "Falha ao gerar XLSX.";
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      let fileName = "modelo_seens.xlsx";
      const m = cd?.match(/filename="([^"]+)"/);
      if (m) fileName = decodeURIComponent(m[1]);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Erro ao baixar.");
    } finally {
      setSeensDownloading(false);
    }
  }, [jobId, data]);

  function handleReset() {
    setPageState("idle");
    setErrorMessage(null);
    setData(null);
    setJobId(null);
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.brandTitle}>Rateio Fácil</h1>
        <button
          type="button"
          style={styles.hamburgerButton}
          onClick={() => setDrawerOpen((p) => !p)}
          aria-label="Abrir menu"
          aria-expanded={drawerOpen}
          aria-controls="balancete-drawer"
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
        id="balancete-drawer"
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
        <BalanceteUploadCard
          disabled={busy}
          busy={busy}
          statusMessage={statusMessage}
          onFileSelected={handleFileChange}
        />

        {errorMessage ? <p style={styles.errorText}>{errorMessage}</p> : null}

        {pageState === "done" && jobId && data ? (
          <div style={styles.gridSection}>
            <div style={styles.previewCard}>
              <header style={styles.cardHeader}>
                <h2 style={styles.cardTitle}>PDF original</h2>
              </header>
              <div style={styles.previewWrapper}>
                {pdfSrc ? (
                  <iframe
                    src={pdfSrc}
                    title="PDF do balancete"
                    style={styles.previewFrame}
                  />
                ) : null}
              </div>
            </div>

            <SeensEditableTable
              data={data}
              onDataChange={onDataChange}
              downloading={seensDownloading}
              onDownload={handleDownloadSeens}
            />
          </div>
        ) : null}

        {(pageState === "done" || pageState === "error") && (
          <div style={styles.footerActions}>
            <button type="button" onClick={handleReset} style={styles.secondaryBtn}>
              Novo upload
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
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
  drawerOpen: { transform: "translateX(0)" },
  drawerClosed: { transform: "translateX(100%)" },
  drawerHeader: {
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: "10px",
  },
  drawerTitle: { margin: "0 0 6px 0", fontSize: "1rem" },
  drawerMeta: { margin: 0, fontSize: "0.85rem", color: "#4b5563", overflowWrap: "anywhere" },
  drawerNav: { display: "flex", flexDirection: "column", gap: "8px" },
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
  logoutForm: { marginTop: "8px" },
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
    gap: "16px",
  },
  errorText: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "0.9rem",
  },
  gridSection: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  },
  previewCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    minHeight: "520px",
    overflow: "hidden",
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
  previewWrapper: {
    flex: 1,
    minHeight: 0,
    padding: 0,
  },
  previewFrame: {
    width: "100%",
    height: "calc(100vh - 290px)",
    minHeight: "480px",
    border: "none",
    display: "block",
  },
  footerActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
  },
  secondaryBtn: {
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    padding: "10px 14px",
    background: "#fff",
    cursor: "pointer",
    fontSize: "0.92rem",
  },
};
