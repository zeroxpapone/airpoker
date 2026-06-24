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
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "380px",
          display: "grid",
          gap: "1.2rem",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "2rem 1.5rem"
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 800,
              letterSpacing: "0.02em",
              fontFamily: "var(--font-display)",
              background: "linear-gradient(135deg, #3b82f6 0%, #10b981 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}
          >
            {t("login.title")}
          </h1>
          <h2
            style={{
              marginTop: "0.5rem",
              fontSize: "0.9rem",
              fontWeight: 400,
              color: "var(--text-muted)"
            }}
            dangerouslySetInnerHTML={{ __html: t("login.subtitle") }}
          />
        </div>

        <div
          style={{
            padding: "0.75rem 0.9rem",
            borderRadius: "0.75rem",
            backgroundColor: "rgba(15, 23, 42, 0.4)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            fontSize: "0.85rem",
            color: "var(--text-main)"
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: t("login.instructions") }} />
        </div>

        <form
          onSubmit={handleLogin}
          style={{ display: "grid", gap: "0.9rem" }}
        >
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-main)",
                textTransform: "uppercase",
                letterSpacing: "0.03em"
              }}
            >
              {t("login.nicknameLabel")}
            </label>
            <input
              type="text"
              placeholder={t("login.nicknamePlaceholder")}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="off"
            />
          </div>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "var(--color-danger)", margin: "0.2rem 0" }}>{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={disabled || !nickname.trim()}
            className={disabled || !nickname.trim() ? "" : "poker-btn-primary"}
            style={{
              marginTop: "0.4rem",
              width: "100%",
              padding: "0.75rem 1rem",
              borderRadius: "999px",
              border: "none",
              cursor: disabled || !nickname.trim() ? "not-allowed" : "pointer",
              backgroundColor: disabled || !nickname.trim() ? "rgba(75, 85, 99, 0.4)" : undefined,
              color: disabled || !nickname.trim() ? "var(--text-muted)" : "var(--text-inverse)",
              fontWeight: 800,
              fontSize: "0.95rem",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              boxShadow: disabled || !nickname.trim() ? "none" : "0 4px 15px rgba(16, 185, 129, 0.25)",
              opacity: loading ? 0.7 : 1
            }}
          >
            {submitting || loading ? t("login.connecting") : t("login.submitBtn")}
          </button>
        </form>

        <p
          style={{
            marginTop: "0.4rem",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            textAlign: "center",
            margin: 0
          }}
        >
          <Trans
            i18nKey="login.footer"
            components={{ termsLink: <Link to="/terms" style={{ color: "#38bdf8", textDecoration: "underline", fontWeight: 500 }} /> }}
          />
        </p>
      </div>
    </div>
  );
}
