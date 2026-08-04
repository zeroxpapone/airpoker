import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
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

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at top, #020617, #020617 45%, #000000)",
        color: "#f8fafc",
        fontFamily: "var(--font-sans)"
      }}>
        <div className="glass-panel" style={{
          padding: "2.5rem",
          borderRadius: "1.5rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.2rem",
          maxWidth: "340px",
          width: "90%",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
          border: "1px solid rgba(255, 255, 255, 0.08)"
        }}>
          {/* Animated Spinner with Cards/Suits hint */}
          <div style={{ position: "relative", width: "50px", height: "50px" }}>
            <div style={{
              width: "100%", height: "100%",
              borderRadius: "50%",
              border: "3px solid rgba(59, 130, 246, 0.1)",
              borderTopColor: "var(--color-primary)",
              animation: "spin 1s linear infinite"
            }} />
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: "1.2rem"
            }}>♣️</div>
          </div>
          <div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>AirPoker</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.4rem", marginBottom: 0 }}>
              Caricamento dell'applicazione in corso...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at top, #020617, #020617 45%, #000000)",
        color: "#f8fafc",
        fontFamily: "var(--font-sans)"
      }}>
        <div className="glass-panel" style={{
          padding: "2.5rem",
          borderRadius: "1.5rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.2rem",
          maxWidth: "340px",
          width: "90%"
        }}>
          <div style={{
            width: "40px", height: "40px",
            borderRadius: "50%",
            border: "3px solid rgba(59, 130, 246, 0.1)",
            borderTopColor: "var(--color-primary)",
            animation: "spin 1s linear infinite"
          }} />
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
            Caricamento componenti...
          </p>
        </div>
      </div>
    }>
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
