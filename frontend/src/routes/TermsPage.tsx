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
        style={{
          background: "rgba(30, 41, 59, 0.7)",
          backdropFilter: "blur(12px)",
          borderRadius: "1.5rem",
          padding: "2.5rem 2rem",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          width: "100%",
          maxWidth: "800px",
          color: "#e2e8f0"
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            color: "#ffffff",
            border: "none",
            padding: "0.6rem 1.2rem",
            borderRadius: "999px",
            cursor: "pointer",
            fontWeight: 600,
            marginBottom: "2rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem"
          }}
        >
          ← {t("terms.backBtn")}
        </button>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
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

