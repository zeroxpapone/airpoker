import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const nickname = user?.displayName || "Giocatore";

async function handleLogout() {
  try {
    await logout();
  } finally {
    navigate("/"); // torna alla pagina di login
  }
}

<button
  onClick={handleLogout}
  style={{
    marginTop: "0.5rem",
    width: "100%",
    padding: "0.55rem 1rem",
    borderRadius: "999px",
    border: "1px solid #4b5563",
    cursor: "pointer",
    backgroundColor: "transparent",
    color: "#9ca3af",
    fontSize: "0.8rem"
  }}
>
  Esci dall&apos;account
</button>


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
        <header style={{ display: "grid", gap: "0.25rem" }}>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, lineHeight: 1.2 }}>
            Benvenuto su AirPoker - La tua piattaforma di poker online
          </h1>
          <h2 style={{ fontSize: "1rem", fontWeight: 400, color: "#9ca3af", marginTop: "0.25rem" }}>
            Gioca a poker gratis con i tuoi amici e gestisci il tavolo dal telefono.
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#9ca3af", marginTop: "0.5rem" }}>
            Ciao{" "}
            <span style={{ color: "#22c55e", fontWeight: 600 }}>
              {nickname}
            </span>
            , pronto per la prossima partita?
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            marginTop: "0.5rem"
          }}
        >
          <button
            onClick={() => navigate("/create")}
            style={{
              width: "100%",
              padding: "0.8rem 1rem",
              borderRadius: "0.9rem",
              border: "none",
              cursor: "pointer",
              background:
                "linear-gradient(135deg, #22c55e, #4ade80, #22c55e)",
              color: "#020617",
              fontWeight: 700,
              fontSize: "0.95rem"
            }}
          >
            Crea un nuovo tavolo
          </button>

          <button
            onClick={() => navigate("/join")}
            style={{
              width: "100%",
              padding: "0.8rem 1rem",
              borderRadius: "0.9rem",
              border: "1px solid #3b82f6",
              cursor: "pointer",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              fontWeight: 600,
              fontSize: "0.95rem"
            }}
          >
            Entra in un tavolo esistente
          </button>
        </div>

        <button
            onClick={handleLogout}
            style={{
                marginTop: "0.5rem",
                width: "100%",
                padding: "0.55rem 1rem",
                borderRadius: "999px",
                border: "1px solid #4b5563",
                cursor: "pointer",
                backgroundColor: "transparent",
                color: "#9ca3af",
                fontSize: "0.8rem"
            }}
            >
            Esci dall&apos;account
        </button>
      </div>
    </div>
  );
}
