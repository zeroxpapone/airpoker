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
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem 1rem 3rem 1rem"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "1.6rem 1.4rem",
          borderRadius: "1rem",
          border: "1px solid #1f2937",
          backgroundColor: "rgba(15,23,42,0.98)",
          boxShadow: "0 18px 35px rgba(0,0,0,0.55)",
          display: "grid",
          gap: "1rem"
        }}
      >
        <h1 style={{ fontSize: "1.4rem", fontWeight: 600 }}>
          {t("joinTable.title")}
        </h1>

        {/* Avviso partita in corso */}
        {searchParams.get("tableId") && (
          <div style={{
            padding: "0.6rem 0.8rem",
            borderRadius: "0.6rem",
            backgroundColor: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.3)",
            fontSize: "0.8rem",
            color: "#fbbf24",
            lineHeight: 1.4
          }}>
            {t("joinTable.gameInProgressWarning")}
          </div>
        )}

        {isScanning ? (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ borderRadius: "1rem", overflow: "hidden", border: "1px solid #3b82f6", backgroundColor: "#000" }}>
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
              onClick={() => setIsScanning(false)}
              style={{
                width: "100%", padding: "0.7rem", borderRadius: "999px",
                border: "1px solid #f97373", backgroundColor: "transparent",
                color: "#f97373", fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: "0.4rem"
              }}
            >
              <X size={18} /> {t("joinTable.cancelScanBtn")}
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "grid", gap: "0.85rem" }}
          >
            <button
              type="button"
              onClick={() => setIsScanning(true)}
              style={{
                width: "100%", padding: "0.7rem", borderRadius: "999px",
                border: "1px solid #4ade80", backgroundColor: "rgba(74, 222, 128, 0.1)",
                color: "#4ade80", fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem",
                marginBottom: "0.5rem"
              }}
            >
              <Camera size={18} /> {t("joinTable.scanQrBtn")}
            </button>

            <Field label={t("joinTable.tableIdLabel")}>
              <input
                style={inputStyle}
                type="text"
                value={tableId}
                onChange={(e) => setTableId(e.target.value.toLowerCase())}
                placeholder={t("joinTable.tableIdPlaceholder")}
                required
              />
          </Field>

          <Field label={t("joinTable.passwordLabel")}>
            <input
              style={inputStyle}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("joinTable.passwordPlaceholder")}
            />
          </Field>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "#f97373" }}>{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "0.5rem",
              width: "100%",
              padding: "0.7rem 1rem",
              borderRadius: "999px",
              border: "none",
              cursor: loading ? "default" : "pointer",
              backgroundColor: "#3b82f6",
              opacity: loading ? 0.7 : 1,
              color: "#020617",
              fontWeight: 700,
              fontSize: "0.95rem"
            }}
          >
            {loading ? t("joinTable.joiningBtn") : t("joinTable.submitBtn")}
          </button>
        </form>
        )}

        <p
          style={{
            fontSize: "0.8rem",
            color: "#9ca3af"
          }}
        >
          {t("joinTable.hint")}
        </p>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: "0.2rem" }}>
      <label
        style={{ fontSize: "0.9rem", fontWeight: 500, color: "#e5e7eb" }}
      >
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  backgroundColor: "#020617",
  border: "1px solid #1e293b",
  borderRadius: "0.6rem",
  color: "#e2e8f0",
  fontSize: "0.9rem"
};
