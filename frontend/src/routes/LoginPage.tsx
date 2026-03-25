import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";

export default function LoginPage() {
  const { login, loading } = useAuth();
  const { t } = useTranslation();
  const [nickname, setNickname] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();


  async function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErrorMsg(null);

    const name = nickname.trim();
    if (!name) {
      setErrorMsg(t("login.errorEmptyNickname"));
      return;
    }

    try {
      setSubmitting(true);
      await login(name);
      
      const redirect = searchParams.get("redirect");
      if (redirect) {
        navigate(redirect);
      } else {
        navigate("/home");
      }
      // Non facciamo redirect qui: il resto dell'app gestisce le route
      // in base alla presenza di user.
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("login.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = loading || submitting;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem 1rem 3rem 1rem"
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
            {t("login.title")}
          </h1>
          <h2
            style={{
              marginTop: "0.4rem",
              fontSize: "0.9rem",
              fontWeight: 400,
              color: "#9ca3af"
            }}
            dangerouslySetInnerHTML={{ __html: t("login.subtitle") }}
          />
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
          <p dangerouslySetInnerHTML={{ __html: t("login.instructions") }} />
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
              {t("login.nicknameLabel")}
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
              placeholder={t("login.nicknamePlaceholder")}
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
            {submitting || loading ? t("login.connecting") : t("login.submitBtn")}
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
          <Trans
            i18nKey="login.footer"
            components={{ termsLink: <Link to="/terms" style={{ color: "#38bdf8", textDecoration: "underline" }} /> }}
          />
        </p>
      </div>
    </div>
  );
}
