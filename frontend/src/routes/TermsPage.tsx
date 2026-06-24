import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export default function TermsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "2rem 1.5rem 4rem 1.5rem"
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "800px",
          padding: "2rem 1.5rem",
          color: "var(--text-main)"
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            color: "var(--text-main)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "0.5rem 1.1rem",
            borderRadius: "999px",
            cursor: "pointer",
            fontWeight: 600,
            marginBottom: "1.8rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.85rem"
          }}
        >
          ← {t("terms.backBtn")}
        </button>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "0.5rem", fontFamily: "var(--font-display)" }}>
          {t("terms.title")}
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "2rem" }}>
          {t("terms.lastUpdated")}
        </p>

        {Array.isArray(t("terms.sections", { returnObjects: true })) && 
          (t("terms.sections", { returnObjects: true }) as Array<{title: string, text: string}>).map((sec, idx) => (
          <section key={idx} style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 600, color: "#38bdf8", marginBottom: "0.5rem" }}>
              {sec.title}
            </h2>
            <p style={{ lineHeight: "1.6", color: "#cbd5e1" }}>
              {sec.text}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}

