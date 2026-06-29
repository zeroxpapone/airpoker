import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { joinTable } from "../lib/firestoreApi";
import { Camera, X } from "lucide-react";
import { Scanner } from '@yudiel/react-qr-scanner';

export default function JoinTablePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const [tableId, setTableId] = useState(() => searchParams.get("tableId") || "");
  const [password, setPassword] = useState(() => searchParams.get("pwd") || "");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [attemptedTableId, setAttemptedTableId] = useState<string | null>(null);

  const performJoin = async (targetTableId: string, targetPassword?: string) => {
    if (!targetTableId || !user) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      await joinTable(targetTableId.trim(), user, targetPassword?.trim() || undefined);
      navigate(`/table/${targetTableId.trim()}`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || t("joinTable.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const tid = searchParams.get("tableId");
    const pwd = searchParams.get("pwd") || "";
    if (tid) {
      setTableId(tid);
      if (pwd) setPassword(pwd);
      
      if (user && tid !== attemptedTableId) {
        setAttemptedTableId(tid);
        performJoin(tid, pwd);
      }
    }
  }, [searchParams, user, attemptedTableId]);

  if (!user) {
    return <p>{t("joinTable.errorNotLoggedIn")}</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await performJoin(tableId, password);
  }

  return (
    <div className="create-table-container" id="join-table-page-container">
      <div className="glass-panel create-table-panel" id="join-table-panel-box">
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "var(--font-display)" }} id="join-table-title">
          {t("joinTable.title")}
        </h1>

        {/* Avviso partita in corso */}
        {searchParams.get("tableId") && (
          <div className="warning-banner" id="game-in-progress-warning">
            {t("joinTable.gameInProgressWarning")}
          </div>
        )}

        {isScanning ? (
          <div className="form-field-group" id="qr-scanner-container">
            <div className="qr-scanner-wrapper" id="qr-scanner-box">
              <Scanner
                sound={false}
                components={{ torch: false }}
                onScan={(detectedCodes) => {
                  if (detectedCodes && detectedCodes.length > 0) {
                    const val = detectedCodes[0].rawValue;
                    if (val) {
                      let tId = "";
                      let pwd = "";
                      try {
                        const url = new URL(val);
                        tId = url.searchParams.get("tableId") || "";
                        pwd = url.searchParams.get("pwd") || "";
                        if (!tId && val.includes("/table/")) {
                          tId = url.pathname.split("/table/")[1].replace(/\//g, "");
                        }
                      } catch (e) {
                         tId = val;
                      }
                      
                      if (tId) {
                        setTableId(tId);
                        setPassword(pwd);
                        setIsScanning(false);
                        setAttemptedTableId(tId);
                        performJoin(tId, pwd);
                      }
                    }
                  }
                }}
                onError={(error: unknown) => {
                  console.error("Camera error:", error);
                  const msg = error instanceof Error ? error.message : String(error);
                  setErrorMsg(msg || "Impossibile accedere alla fotocamera: assicurati di usare HTTPS o di aver concesso i permessi al browser.");
                }}
              />
            </div>
            <button
              id="btn-cancel-scan"
              onClick={() => setIsScanning(false)}
              style={{
                width: "100%", padding: "0.75rem", borderRadius: "999px",
                border: "1px solid var(--color-danger)", backgroundColor: "transparent",
                color: "var(--color-danger)", fontWeight: 700, display: "flex", justifyContent: "center", alignItems: "center", gap: "0.4rem",
                cursor: "pointer"
              }}
            >
              <X size={18} /> {t("joinTable.cancelScanBtn")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="form-field-group" id="form-join-table">
            <button
              id="btn-start-scan"
              type="button"
              onClick={() => setIsScanning(true)}
              style={{
                width: "100%", padding: "0.75rem", borderRadius: "999px",
                border: "1px solid var(--color-success)", backgroundColor: "rgba(16, 185, 129, 0.08)",
                color: "var(--color-success)", fontWeight: 700, display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem",
                marginBottom: "0.3rem", cursor: "pointer", boxShadow: "0 4px 12px rgba(16, 185, 129, 0.15)"
              }}
            >
              <Camera size={18} /> {t("joinTable.scanQrBtn")}
            </button>

            <Field label={t("joinTable.tableIdLabel")} id="field-table-id">
              <input
                id="input-table-id"
                type="text"
                value={tableId}
                onChange={(e) => setTableId(e.target.value.toLowerCase())}
                placeholder={t("joinTable.tableIdPlaceholder")}
                autoComplete="off"
                required
              />
            </Field>

            <Field label={t("joinTable.passwordLabel")} id="field-table-password">
              <input
                id="input-table-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("joinTable.passwordPlaceholder")}
                autoComplete="off"
              />
            </Field>

            {errorMsg && (
              <p style={{ fontSize: "0.8rem", color: "var(--color-danger)", margin: "0.2rem 0" }} id="join-table-error">{errorMsg}</p>
            )}

            <button
              id="btn-submit-join-table"
              type="submit"
              disabled={loading}
              className="poker-btn-primary"
              style={{
                marginTop: "0.5rem",
                width: "100%",
                padding: "0.8rem 1.2rem",
                borderRadius: "999px",
                border: "none",
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.7 : 1,
                color: "var(--text-inverse)",
                fontWeight: 800,
                fontSize: "1rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em"
              }}
            >
              {loading ? t("joinTable.joiningBtn") : t("joinTable.submitBtn")}
            </button>
          </form>
        )}

        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            margin: 0,
            lineHeight: 1.4
          }}
          id="join-table-hint"
        >
          {t("joinTable.hint")}
        </p>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-field-group" id={props.id}>
      <label className="form-label-title">
        {props.label}
      </label>
      {props.children}
    </div>
  );
}
