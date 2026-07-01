import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { Mail, Lock, User, LogIn, UserPlus, ShieldAlert } from "lucide-react";

type TabType = "guest" | "login" | "register";

export default function LoginPage() {
  const { login, registerWithEmail, loginWithEmail, signInWithGoogle, loading } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Tab State
  const [activeTab, setActiveTab] = useState<TabType>("guest");

  // Form Fields
  const [nickname, setNickname] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // UI States
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirect = searchParams.get("redirect");

  const handleNavigation = () => {
    if (redirect) {
      navigate(redirect);
    } else {
      navigate("/home");
    }
  };

  async function handleGuestLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const name = nickname.trim();
    if (!name) {
      setErrorMsg(t("login.errorEmptyNickname") || "Scegli un nickname.");
      return;
    }

    try {
      setSubmitting(true);
      await login(name);
      handleNavigation();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("login.errorGeneric") || "Errore durante l'accesso.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!loginIdentifier.trim() || !password) {
      setErrorMsg(t("login.errorEmailPassRequired"));
      return;
    }

    try {
      setSubmitting(true);
      await loginWithEmail(loginIdentifier, password);
      handleNavigation();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("login.errorInvalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailRegister(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password || !username.trim()) {
      setErrorMsg(t("login.errorAllFieldsRequired"));
      return;
    }

    try {
      setSubmitting(true);
      await registerWithEmail(email, password, username);
      handleNavigation();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("login.errorRegisterGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setErrorMsg(null);
    try {
      setSubmitting(true);
      await signInWithGoogle();
      handleNavigation();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("login.errorGoogleAuth"));
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = loading || submitting;

  return (
    <div className="login-container" id="login-page-container">
      <div className="glass-panel login-panel" id="login-panel-box">
        <div style={{ textAlign: "center" }}>
          <h1 className="login-title-gradient" id="login-title-header">
            AirPoker
          </h1>
          <h2
            className="login-subtitle-text"
            id="login-subtitle-label"
            dangerouslySetInnerHTML={{ __html: t("login.subtitle") }}
          />
        </div>

        {/* Tab Selector */}
        <div className="tab-selector-bar" id="login-tab-bar">
          <button
            id="tab-btn-guest"
            onClick={() => { setActiveTab("guest"); setErrorMsg(null); }}
            className={`tab-selector-btn ${activeTab === "guest" ? "active" : ""}`}
          >
            {t("login.tabGuest")}
          </button>
          <button
            id="tab-btn-login"
            onClick={() => { setActiveTab("login"); setErrorMsg(null); }}
            className={`tab-selector-btn ${activeTab === "login" ? "active" : ""}`}
          >
            {t("login.tabLogin")}
          </button>
          <button
            id="tab-btn-register"
            onClick={() => { setActiveTab("register"); setErrorMsg(null); }}
            className={`tab-selector-btn ${activeTab === "register" ? "active" : ""}`}
          >
            {t("login.tabRegister")}
          </button>
        </div>

        {/* Tab Contents */}
        {activeTab === "guest" && (
          <form onSubmit={handleGuestLogin} className="form-group" id="form-guest-login">
            <div
              className="login-instructions"
              id="guest-instructions-box"
              dangerouslySetInnerHTML={{ __html: t("login.instructions") }}
            />

            <div className="form-group">
              <label className="form-label-title" htmlFor="input-nickname">
                {t("login.nicknameLabel")}
              </label>
              <div className="input-with-icon">
                <User size={16} className="input-icon-left" />
                <input
                  id="input-nickname"
                  type="text"
                  placeholder={t("login.nicknamePlaceholder") || "Nickname..."}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            {errorMsg && (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
                <ShieldAlert size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              id="btn-submit-guest"
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
                fontSize: "0.95rem"
              }}
            >
              {disabled ? t("login.connecting") || "Connessione..." : t("login.btnPlayGuest")}
            </button>
          </form>
        )}

        {activeTab === "login" && (
          <form onSubmit={handleEmailLogin} className="form-group" id="form-email-login">
            <div className="form-group">
              <label className="form-label-title" htmlFor="input-login-identifier">
                {t("login.labelLoginIdentifier")}
              </label>
              <div className="input-with-icon">
                <Mail size={16} className="input-icon-left" />
                <input
                  id="input-login-identifier"
                  type="text"
                  placeholder={t("login.labelLoginIdentifier")}
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label-title" htmlFor="input-login-password">
                {t("login.labelPassword")}
              </label>
              <div className="input-with-icon">
                <Lock size={16} className="input-icon-left" />
                <input
                  id="input-login-password"
                  type="password"
                  placeholder={t("login.labelPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {errorMsg && (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
                <ShieldAlert size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              id="btn-submit-login"
              type="submit"
              disabled={disabled || !loginIdentifier.trim() || !password}
              className={disabled || !loginIdentifier.trim() || !password ? "" : "poker-btn-primary"}
              style={{
                marginTop: "0.4rem",
                width: "100%",
                padding: "0.75rem 1rem",
                borderRadius: "999px",
                border: "none",
                cursor: disabled || !loginIdentifier.trim() || !password ? "not-allowed" : "pointer",
                backgroundColor: disabled || !loginIdentifier.trim() || !password ? "rgba(75, 85, 99, 0.4)" : undefined,
                color: disabled || !loginIdentifier.trim() || !password ? "var(--text-muted)" : "var(--text-inverse)",
                fontWeight: 800,
                fontSize: "0.95rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem"
              }}
            >
              <LogIn size={16} />
              {disabled ? t("login.btnLoggingIn") : t("login.btnLogIn")}
            </button>

            <div style={{ display: "flex", alignItems: "center", margin: "0.2rem 0" }}>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0 0.5rem" }}>{t("login.textOr")}</span>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", width: "100%" }} id="social-login-group">
              <button
                id="btn-google-login"
                type="button"
                onClick={handleGoogleLogin}
                disabled={disabled}
                className="poker-btn-secondary"
                style={{
                  flex: 1,
                  padding: "0.7rem 1rem",
                  borderRadius: "999px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
                Google
              </button>
            </div>
          </form>
        )}

        {activeTab === "register" && (
          <form onSubmit={handleEmailRegister} className="form-group" id="form-email-register">
            <div className="form-group">
              <label className="form-label-title" htmlFor="input-register-username">
                {t("login.labelUniqueUsername")}
              </label>
              <div className="input-with-username-at">
                <span className="input-username-at">@</span>
                <input
                  id="input-register-username"
                  type="text"
                  placeholder="es. ale_poker"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                  autoComplete="off"
                  required
                />
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {t("login.usernameHint")}
              </span>
            </div>

            <div className="form-group">
              <label className="form-label-title" htmlFor="input-register-email">
                {t("login.labelEmail")}
              </label>
              <div className="input-with-icon">
                <Mail size={16} className="input-icon-left" />
                <input
                  id="input-register-email"
                  type="email"
                  placeholder={t("login.labelEmail")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label-title" htmlFor="input-register-password">
                {t("login.labelPassword")}
              </label>
              <div className="input-with-icon">
                <Lock size={16} className="input-icon-left" />
                <input
                  id="input-register-password"
                  type="password"
                  placeholder={t("login.labelPasswordMin")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
            </div>

            {errorMsg && (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
                <ShieldAlert size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              id="btn-submit-register"
              type="submit"
              disabled={disabled || !email.trim() || !password || !username.trim()}
              className={disabled || !email.trim() || !password || !username.trim() ? "" : "poker-btn-primary"}
              style={{
                marginTop: "0.4rem",
                width: "100%",
                padding: "0.75rem 1rem",
                borderRadius: "999px",
                border: "none",
                cursor: disabled || !email.trim() || !password || !username.trim() ? "not-allowed" : "pointer",
                backgroundColor: disabled || !email.trim() || !password || !username.trim() ? "rgba(75, 85, 99, 0.4)" : undefined,
                color: disabled || !email.trim() || !password || !username.trim() ? "var(--text-muted)" : "var(--text-inverse)",
                fontWeight: 800,
                fontSize: "0.95rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem"
              }}
            >
              <UserPlus size={16} />
              {disabled ? t("login.btnRegistering") : t("login.btnRegister")}
            </button>

            <div style={{ display: "flex", alignItems: "center", margin: "0.2rem 0" }}>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0 0.5rem" }}>{t("login.textOr")}</span>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", width: "100%" }} id="social-register-group">
              <button
                id="btn-google-register"
                type="button"
                onClick={handleGoogleLogin}
                disabled={disabled}
                className="poker-btn-secondary"
                style={{
                  flex: 1,
                  padding: "0.7rem 1rem",
                  borderRadius: "999px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
                Google
              </button>
            </div>
          </form>
        )}

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
