import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { createTable } from "../lib/firestoreApi";

export default function CreateTablePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [initialStack, setInitialStack] = useState(200);
  const [smallBlind, setSmallBlind] = useState(5);
  const [bigBlind, setBigBlind] = useState(10);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!user) {
    return <p>Devi effettuare il login per creare un tavolo.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    try {
      setLoading(true);
      const id = await createTable(
        {
          name: name.trim() || "Tavolo senza nome",
          initialStack,
          smallBlind,
          bigBlind,
          password: password.trim() || undefined
        },
        user
      );
      navigate(`/table/${id}`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Errore durante la creazione del tavolo.");
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
          Crea un tavolo di AirPoker
        </h1>

        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: "0.85rem" }}
        >
          <Field
            label="Nome tavolo"
            description="Es: Vigili @ Desio, Night Session, Fast Food, ecc."
          >
            <input
              style={inputStyle}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es: Vigili @ Desio"
            />
          </Field>

          <Field
            label="Stack iniziale"
            description="Quante fiches virtuali ha ogni giocatore all'ingresso."
          >
            <input
              style={inputStyle}
              type="text"
              min={100}
              step={10}
              value={initialStack}
              onChange={(e) => setInitialStack(Number(e.target.value))}
            />
          </Field>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem"
            }}
          >
            <Field label="Small Blind">
              <input
                style={inputStyle}
                type="text"
                min={5}
                step={5}
                value={smallBlind}
                onChange={(e) => setSmallBlind(Number(e.target.value))}
              />
            </Field>
            <Field label="Big Blind">
              <input
                style={inputStyle}
                type="text"
                min={10}
                step={5}
                value={bigBlind}
                onChange={(e) => setBigBlind(Number(e.target.value))}
              />
            </Field>
          </div>

          <Field
            label="Password tavolo (opzionale)"
            description="Se vuoi limitare l'ingresso solo a chi conosce la password."
          >
            <input
              style={inputStyle}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nessuna password"
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
              backgroundColor: "#22c55e",
              opacity: loading ? 0.7 : 1,
              color: "#020617",
              fontWeight: 700,
              fontSize: "0.95rem"
            }}
          >
            {loading ? "Creazione in corso..." : "Crea tavolo"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: "0.2rem" }}>
      <label
        style={{ fontSize: "0.9rem", fontWeight: 500, color: "#e5e7eb" }}
      >
        {props.label}
      </label>
      {props.description && (
        <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          {props.description}
        </p>
      )}
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
