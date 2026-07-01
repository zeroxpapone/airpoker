import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./hooks/useAuth";

import Layout from "./components/Layout";
import LoginPage from "./routes/LoginPage";
import HomePage from "./routes/HomePage";
import TermsPage from "./routes/TermsPage";
import AboutPage from "./routes/AboutPage";

const CreateTablePage = lazy(() => import("./routes/CreateTablePage"));
const TablePage = lazy(() => import("./routes/TablePage"));
const ProfilePage = lazy(() => import("./routes/ProfilePage"));
const PlayerProfilePage = lazy(() => import("./routes/PlayerProfilePage"));

function ProtectedTableRoute() {
  const { tableId } = useParams();
  const { user } = useAuth();
  
  if (!user) {
    return <Navigate to={`/?redirect=/table/${tableId}`} replace />;
  }
  return <TablePage />;
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function App() {
  const { user, loading } = useAuth();
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage || "en";
    const handleLanguageChange = (lng: string) => {
      document.documentElement.lang = lng;
    };
    i18n.on("languageChanged", handleLanguageChange);
    return () => {
      i18n.off("languageChanged", handleLanguageChange);
    };
  }, [i18n]);

  if (loading) return <p>Caricamento</p>;

  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", color: "#9ca3af" }}>Caricamento applicazione...</div>}>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route
            path="/"
            element={user ? <Navigate to="/home" replace /> : <LoginPage />}
          />
          <Route
            path="/home"
            element={user ? <HomePage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/create"
            element={user ? <CreateTablePage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/table/:tableId"
            element={<ProtectedTableRoute />}
          />
          <Route
            path="/profile"
            element={user ? <ProfilePage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/user/:username"
            element={user ? <PlayerProfilePage /> : <Navigate to="/" replace />}
          />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Suspense>
  );
}

export default App;
