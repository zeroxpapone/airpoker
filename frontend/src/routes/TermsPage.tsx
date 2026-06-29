import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export default function TermsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="info-page-container" id="terms-page-container">
      <div className="glass-panel info-page-panel" id="terms-panel-box">
        <button
          id="btn-terms-back"
          onClick={() => navigate(-1)}
          className="info-page-back-btn"
        >
          ← {t("terms.backBtn")}
        </button>
        <h1 className="info-page-title" id="terms-title-header">
          {t("terms.title")}
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "2rem" }} id="terms-last-updated-label">
          {t("terms.lastUpdated")}
        </p>

        {Array.isArray(t("terms.sections", { returnObjects: true })) && 
          (t("terms.sections", { returnObjects: true }) as Array<{title: string, text: string}>).map((sec, idx) => (
          <section key={idx} className="info-page-section" id={`terms-section-${idx}`}>
            <h2 className="info-page-section-title">
              {sec.title}
            </h2>
            <p className="info-page-text">
              {sec.text}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
