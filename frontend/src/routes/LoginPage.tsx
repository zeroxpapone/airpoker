import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const { login, loading } = useAuth();
  const [nickname, setNickname] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();


  async function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErrorMsg(null);

    const name = nickname.trim();
    if (!name) {
      setErrorMsg("Devi scegliere un nickname per entrare.");
      return;
    }

    try {
      setSubmitting(true);
      await login(name);
      navigate("/home");
      // Non facciamo redirect qui: il resto dell'app gestisce le route
      // in base alla presenza di user.
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Errore durante il login.");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = loading || submitting;

  return (
    <div
      style={{
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(circle at top, #1e293b, #020617 55%, #000000)",
    padding: "1rem"
  }}
    >
      <div
    style={{
      width: "100%",
      maxWidth: "380px",
      padding: "1.5rem 1.25rem",
      borderRadius: "1rem",
      border: "1px solid #1f2937",
      backgroundColor: "rgba(15,23,42,0.96)",
      boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
      display: "grid",
      gap: "1rem",
      maxHeight: "90vh",
      overflowY: "auto"
    }}
  >
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.7rem",
              fontWeight: 700,
              letterSpacing: "0.02em"
            }}
          >
            AirPoker - Poker Online
          </h1>
          <h2
            style={{
              marginTop: "0.4rem",
              fontSize: "0.9rem",
              fontWeight: 400,
              color: "#9ca3af"
            }}
          >
            Texas Hold&apos;em tra amici, senza fiches.<br/> Solo carte e
            telefoni. Gioca a poker gratis ora!
          </h2>
        </div>

        <div
          style={{
            padding: "0.75rem 0.9rem",
            borderRadius: "0.75rem",
            backgroundColor: "rgba(15,23,42,0.9)",
            border: "1px solid #111827",
            fontSize: "0.85rem",
            color: "#e5e7eb"
          }}
        >
          <p>
            Scegli un{" "}
            <span style={{ color: "#22c55e", fontWeight: 500 }}>
              nickname
            </span>{" "}
            con cui gli altri ti vedranno al tavolo. Non servono email,
            password o registrazioni!
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          style={{ display: "grid", gap: "0.8rem" }}
        >
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <label
              style={{
                fontSize: "0.9rem",
                fontWeight: 500,
                color: "#e5e7eb"
              }}
            >
              Nickname
            </label>
            <input
              style={{
                width: "100%",
                padding: "0.55rem 0.75rem",
                backgroundColor: "#020617",
                border: "1px solid #1e293b",
                borderRadius: "0.6rem",
                color: "#e2e8f0",
                fontSize: "0.9rem"
              }}
              type="text"
              placeholder="Es. Ciccions, Tira, Mishi..."
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="off"
            />
          </div>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "#f97373" }}>{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={disabled || !nickname.trim()}
            style={{
              marginTop: "0.3rem",
              width: "100%",
              padding: "0.7rem 1rem",
              borderRadius: "999px",
              border: "none",
              cursor:
                disabled || !nickname.trim() ? "not-allowed" : "pointer",
              background:
                disabled || !nickname.trim()
                  ? "#4b5563"
                  : "linear-gradient(135deg, #22c55e, #4ade80, #22c55e)",
              color: "#020617",
              fontWeight: 700,
              fontSize: "0.95rem",
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              opacity: loading ? 0.7 : 1
            }}
          >
            {submitting || loading ? "Connessione..." : "Entra in AirPoker"}
          </button>
        </form>

        <p
          style={{
            marginTop: "0.3rem",
            fontSize: "0.8rem",
            color: "#6b7280",
            textAlign: "center"
          }}
        >
          Dopo l&apos;accesso potrai creare un tavolo o unirti a quello di un
          amico.
        </p>
      </div>
    </div>
  );
}
