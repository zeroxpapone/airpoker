import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export default function AboutPage() {
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
          ← {t("about.backBtn")}
        </button>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "1.8rem", fontFamily: "var(--font-display)" }}>
          {t("about.title")}
        </h1>

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 600, color: "#38bdf8", marginBottom: "0.8rem" }}>
            {t("about.missionTitle")}
          </h2>
          <p style={{ lineHeight: "1.7", color: "#cbd5e1", fontSize: "1.05rem" }}>
            {t("about.missionText")}
          </p>
        </section>

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 600, color: "#38bdf8", marginBottom: "0.8rem" }}>
            {t("about.howItWorksTitle")}
          </h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.8rem", color: "#cbd5e1", fontSize: "1.05rem" }}>
            <li>{t("about.step1")}</li>
            <li>{t("about.step2")}</li>
            <li>{t("about.step3")}</li>
            <li>{t("about.step4")}</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 600, color: "#38bdf8", marginBottom: "0.8rem" }}>
            {t("about.featuresTitle")}
          </h2>
          <ul style={{ listStyle: "disc", paddingLeft: "1.5rem", display: "grid", gap: "0.8rem", color: "#cbd5e1", fontSize: "1.05rem" }}>
            <li>{t("about.feature1")}</li>
            <li>{t("about.feature2")}</li>
            <li>{t("about.feature3")}</li>
            <li>{t("about.feature4")}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
