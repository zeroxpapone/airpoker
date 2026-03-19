import { Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import LoginPage from "./routes/LoginPage";
import HomePage from "./routes/HomePage";
import CreateTablePage from "./routes/CreateTablePage";
import JoinTablePage from "./routes/JoinTablePage";
import TablePage from "./routes/TablePage";
import { useAuth } from "./hooks/useAuth";

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

  return (
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
  );
}

export default App;
