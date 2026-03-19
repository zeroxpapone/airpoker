import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { joinTable } from "../lib/firestoreApi";

export default function JoinTablePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [tableId, setTableId] = useState(() => searchParams.get("tableId") || "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!user) {
    return <p>Devi effettuare il login per entrare in un tavolo.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    try {
      setLoading(true);
    await joinTable(tableId.trim(), user, password.trim() || undefined);
      navigate(`/table/${tableId.trim()}`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Errore durante l'ingresso al tavolo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "1.6rem 1.4rem",
          borderRadius: "1rem",
          border: "1px solid #1f2937",
          backgroundColor: "rgba(15,23,42,0.98)",
          boxShadow: "0 18px 35px rgba(0,0,0,0.55)",
          display: "grid",
          gap: "1rem"
        }}
      >
        <h1 style={{ fontSize: "1.4rem", fontWeight: 600 }}>
          Entra in un tavolo di Poker Gratis
        </h1>

        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: "0.85rem" }}
        >
          <Field label="ID Tavolo">
            <input
              style={inputStyle}
              type="text"
              value={tableId}
              onChange={(e) => setTableId(e.target.value.toLowerCase())}
              placeholder="Es: za9jt"
              required
            />
          </Field>

          <Field label="Password (se richiesta)">
            <input
              style={inputStyle}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Lascia vuoto se non serve"
            />
          </Field>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "#f97373" }}>{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "0.5rem",
              width: "100%",
              padding: "0.7rem 1rem",
              borderRadius: "999px",
              border: "none",
              cursor: loading ? "default" : "pointer",
              backgroundColor: "#3b82f6",
              opacity: loading ? 0.7 : 1,
              color: "#020617",
              fontWeight: 700,
              fontSize: "0.95rem"
            }}
          >
            {loading ? "Ingresso in corso..." : "Entra nel tavolo"}
          </button>
        </form>

        <p
          style={{
            fontSize: "0.8rem",
            color: "#9ca3af"
          }}
        >
          Suggerimento: copia/incolla l&apos;ID che ti ha mandato l&apos;host
          o scansiona il QR se in futuro lo abilitiamo.
        </p>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: "0.2rem" }}>
      <label
        style={{ fontSize: "0.9rem", fontWeight: 500, color: "#e5e7eb" }}
      >
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  backgroundColor: "#020617",
  border: "1px solid #1e293b",
  borderRadius: "0.6rem",
  color: "#e2e8f0",
  fontSize: "0.9rem"
};
