import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

export default function Layout({ children }: Props) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const currentLang = i18n.resolvedLanguage;
  const toggleLanguage = () => {
    i18n.changeLanguage(currentLang === "it" ? "en" : "it");
  };

  const showHomeBtn = location.pathname !== "/home" && location.pathname !== "/";

  return (
    <div className="app-layout" id="app-layout-root">
      <header className="app-header" id="app-header-navigation">
        {showHomeBtn && (
          <button
            id="btn-header-home"
            onClick={() => navigate("/home")}
            className="header-btn"
            title="Home"
          >
            <Home size={18} />
          </button>
        )}

        <button
          id="btn-header-lang-toggle"
          onClick={toggleLanguage}
          className="header-btn header-btn-lang"
        >
          {currentLang === "it" ? "🇮🇹 IT" : "🇬🇧 EN"}
        </button>
      </header>
      
      <main className="app-main-content" id="app-main-view">
        {children}
      </main>
    </div>
  );
}
