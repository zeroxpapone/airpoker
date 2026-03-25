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
          ← {t("about.backBtn")}
        </button>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "2rem" }}>
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
