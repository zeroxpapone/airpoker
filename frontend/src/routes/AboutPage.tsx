import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export default function AboutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="info-page-container" id="about-page-container">
      <div className="glass-panel info-page-panel" id="about-panel-box">
        <button
          id="btn-about-back"
          onClick={() => navigate(-1)}
          className="info-page-back-btn"
        >
          ← {t("about.backBtn")}
        </button>
        <h1 className="info-page-title" id="about-title-header">
          {t("about.title")}
        </h1>

        <section className="info-page-section" id="about-section-mission">
          <h2 className="info-page-section-title">
            {t("about.missionTitle")}
          </h2>
          <p className="info-page-text">
            {t("about.missionText")}
          </p>
        </section>

        <section className="info-page-section" id="about-section-how-it-works">
          <h2 className="info-page-section-title">
            {t("about.howItWorksTitle")}
          </h2>
          <ul className="info-page-list">
            <li>{t("about.step1")}</li>
            <li>{t("about.step2")}</li>
            <li>{t("about.step3")}</li>
            <li>{t("about.step4")}</li>
            <li>{t("about.step5")}</li>
          </ul>
        </section>

        <section className="info-page-section" id="about-section-features">
          <h2 className="info-page-section-title">
            {t("about.featuresTitle")}
          </h2>
          <ul className="info-page-list-disc">
            <li>{t("about.feature1")}</li>
            <li>{t("about.feature2")}</li>
            <li>{t("about.feature3")}</li>
            <li>{t("about.feature4")}</li>
            <li>{t("about.feature5")}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
