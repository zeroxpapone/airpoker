import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { createTable } from "../lib/firestoreApi";

const RANDOM_TABLE_NAMES = [
  "no doccia",
  "del cacco",
  "PALAU",
  "del Burger",
  "del McDonald's",
  "dai dai",
  "del Jack al River",
  "degli ebrei",
  "sognateli boy"
];

export default function CreateTablePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [initialStack, setInitialStack] = useState(200);
  const [smallBlind, setSmallBlind] = useState(5);
  const [bigBlind, setBigBlind] = useState(10);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!user) {
    return <p>{t("createTable.errorNotLoggedIn")}</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    try {
      setLoading(true);
      const randomName =
        RANDOM_TABLE_NAMES[Math.floor(Math.random() * RANDOM_TABLE_NAMES.length)];
        
      const id = await createTable(
        {
          name: name.trim() || `${t("createTable.randomPrefix")} ${randomName}`,
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
      setErrorMsg(err.message || t("createTable.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

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
          {t("createTable.title")}
        </h1>

        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: "0.85rem" }}
        >
          <Field
            label={t("createTable.nameLabel")}
            description={t("createTable.nameDesc")}
          >
            <input
              style={inputStyle}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("createTable.namePlaceholder")}
            />
          </Field>

          <Field
            label={t("createTable.stackLabel")}
            description={t("createTable.stackDesc")}
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
            <Field label={t("createTable.smallBlindLabel")}>
              <input
                style={inputStyle}
                type="text"
                min={5}
                step={5}
                value={smallBlind}
                onChange={(e) => setSmallBlind(Number(e.target.value))}
              />
            </Field>
            <Field label={t("createTable.bigBlindLabel")}>
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
            label={t("createTable.passwordLabel")}
            description={t("createTable.passwordDesc")}
          >
            <input
              style={inputStyle}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("createTable.passwordPlaceholder")}
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
            {loading ? t("createTable.creatingBtn") : t("createTable.submitBtn")}
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
