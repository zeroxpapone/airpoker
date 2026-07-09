import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X } from "lucide-react";

export default function ReloadPrompt() {
  const { i18n } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  const isIt = i18n.resolvedLanguage === "it";
  const message = isIt 
    ? "È disponibile un aggiornamento! Ricarica la pagina per applicare le ultime modifiche."
    : "An update is available! Refresh the page to apply the latest changes.";
  const refreshText = isIt ? "Aggiorna ora" : "Update now";

  return (
    <div style={{
      position: "fixed",
      bottom: "24px",
      right: "24px",
      left: "24px",
      margin: "0 auto",
      maxWidth: "450px",
      zIndex: 100000,
    }}>
      <div className="glass-panel" style={{
        padding: "1.25rem",
        borderRadius: "1.25rem",
        border: "1px solid rgba(59, 130, 246, 0.25)",
        boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 15px rgba(59, 130, 246, 0.1)",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        backdropFilter: "blur(16px)"
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
          <div style={{
            background: "rgba(59, 130, 246, 0.15)",
            padding: "0.5rem",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#3b82f6",
            flexShrink: 0
          }}>
            <RefreshCw size={18} />
          </div>
          <div style={{ flexGrow: 1 }}>
            <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>
              {isIt ? "Aggiornamento Disponibile" : "Update Available"}
            </h4>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#9ca3af", lineHeight: 1.4 }}>
              {message}
            </p>
          </div>
          <button
            onClick={() => setNeedRefresh(false)}
            style={{
              background: "transparent",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center"
            }}
          >
            <X size={16} />
          </button>
        </div>
        
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            onClick={() => setNeedRefresh(false)}
            className="poker-btn-secondary"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.1)",
              backgroundColor: "transparent",
              color: "#fff"
            }}
          >
            {isIt ? "Più tardi" : "Later"}
          </button>
          <button
            onClick={() => updateServiceWorker(true)}
            className="poker-btn-primary"
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              backgroundColor: "#2563eb",
              border: "none",
              color: "#fff"
            }}
          >
            <RefreshCw size={14} />
            {refreshText}
          </button>
        </div>
      </div>
    </div>
  );
}
