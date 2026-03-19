import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";

const LoginPage = lazy(() => import("./routes/LoginPage"));
const HomePage = lazy(() => import("./routes/HomePage"));
const CreateTablePage = lazy(() => import("./routes/CreateTablePage"));
const JoinTablePage = lazy(() => import("./routes/JoinTablePage"));
const TablePage = lazy(() => import("./routes/TablePage"));

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

  if (loading) return <p>Caricamento</p>;

  // Return statement
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", color: "#9ca3af" }}>Caricamento applicazione...</div>}>
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
          path="/join"
          element={user ? <JoinTablePage /> : <Navigate to="/" replace />}
        />
        <Route
          path="/table/:tableId"
          element={<ProtectedTableRoute />}
        />
        {/* eventuale 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
