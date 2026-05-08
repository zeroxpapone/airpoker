import { useState, useMemo, useEffect } from "react";
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

  // Tournament states
  const [mode, setMode] = useState<'CASH' | 'TOURNAMENT'>('CASH');
  const [estimatedPlayers, setEstimatedPlayers] = useState(6);
  const [durationHours, setDurationHours] = useState(3);
  const [levelMins, setLevelMins] = useState(15);
  const [tournamentSettingMode, setTournamentSettingMode] = useState<'SIMPLE' | 'EXPERT'>('SIMPLE');
  const [isStackAuto, setIsStackAuto] = useState(true);

  // Auto-adjust stack based on mode and duration if the user hasn't manually overridden it
  useEffect(() => {
    if (!isStackAuto) return;
    
    if (mode === 'CASH') {
      setInitialStack(200);
    } else {
      const recommendedStack = durationHours <= 2 ? 5000 : durationHours <= 4 ? 10000 : 20000;
      setInitialStack(recommendedStack);
    }
  }, [mode, durationHours, isStackAuto]);

  const blindSchedule = useMemo(() => {
    const actualLevelMins = mode === 'TOURNAMENT' && tournamentSettingMode === 'SIMPLE' ? 15 : levelMins;

    const totalChips = initialStack * estimatedPlayers;
    const targetEndBB = Math.max(100, Math.floor((totalChips * 0.05) / 100) * 100);
    const startBB = Math.max(10, Math.floor((initialStack * 0.01) / 5) * 5);
    const totalLevels = Math.max(3, Math.ceil((durationHours * 60) / actualLevelMins));
    
    const schedule = [];
    const multiplier = Math.pow(targetEndBB / startBB, 1 / (totalLevels - 1));
    
    let currentBB = startBB;
    for (let i = 0; i < totalLevels; i++) {
      let cleanBB = currentBB;
      if (currentBB < 100) cleanBB = Math.round(currentBB / 5) * 5;
      else if (currentBB < 500) cleanBB = Math.round(currentBB / 25) * 25;
      else if (currentBB < 2000) cleanBB = Math.round(currentBB / 100) * 100;
      else if (currentBB < 10000) cleanBB = Math.round(currentBB / 500) * 500;
      else cleanBB = Math.round(currentBB / 1000) * 1000;
      
      if (i > 0 && cleanBB <= schedule[i-1].bb) {
        cleanBB = schedule[i-1].bb + (cleanBB < 100 ? 5 : cleanBB < 500 ? 25 : cleanBB < 2000 ? 100 : 500);
      }
      
      let cleanSB = Math.max(5, Math.ceil(cleanBB / 2 / 5) * 5);
      // specific standard overrides
      if (cleanBB === 10) cleanSB = 5;
      if (cleanBB === 50) cleanSB = 25;
      if (cleanBB === 100) cleanSB = 50;

      schedule.push({ sb: cleanSB, bb: cleanBB, durationMins: levelMins });
      currentBB *= multiplier;
    }
    // Add 3 more final levels to prevent abrupt endings if players play tight
    for (let i = 0; i < 3; i++) {
        let lastBB = schedule[schedule.length - 1].bb;
        let nextBB = lastBB + (lastBB < 500 ? 100 : lastBB < 2000 ? 500 : 1000);
        let nextSB = Math.ceil(nextBB / 2 / 25) * 25;
        if (nextBB === 100) nextSB = 50;
        schedule.push({ sb: nextSB, bb: nextBB, durationMins: levelMins });
    }

    return schedule;
  }, [initialStack, estimatedPlayers, durationHours, levelMins, mode, tournamentSettingMode]);

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
        
      const actualLevelMins = mode === 'TOURNAMENT' && tournamentSettingMode === 'SIMPLE' ? 15 : levelMins;

      const id = await createTable(
        {
          name: name.trim() || `${t("createTable.randomPrefix")} ${randomName}`,
          initialStack,
          smallBlind: mode === 'TOURNAMENT' ? blindSchedule[0].sb : smallBlind,
          bigBlind: mode === 'TOURNAMENT' ? blindSchedule[0].bb : bigBlind,
          password: password.trim() || undefined,
          mode,
          tournamentConfig: mode === 'TOURNAMENT' ? {
            startingStack: initialStack,
            estimatedPlayers,
            targetDurationHours: durationHours,
            levelDurationMins: actualLevelMins,
            blindSchedule
          } : undefined
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
              onChange={(e) => {
                setInitialStack(Number(e.target.value));
                setIsStackAuto(false);
              }}
            />
          </Field>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem",
                backgroundColor: "#0f172a",
                padding: "0.3rem",
                borderRadius: "0.75rem",
                marginBottom: "0.5rem"
              }}
            >
              <button
                type="button"
                onClick={() => setMode('CASH')}
                style={{
                  padding: "0.6rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  backgroundColor: mode === 'CASH' ? "#3b82f6" : "transparent",
                  color: mode === 'CASH' ? "#ffffff" : "#9ca3af",
                  fontWeight: mode === 'CASH' ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                {t("createTable.cashGame")}
              </button>
              <button
                type="button"
                onClick={() => setMode('TOURNAMENT')}
                style={{
                  padding: "0.6rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  backgroundColor: mode === 'TOURNAMENT' ? "#8b5cf6" : "transparent",
                  color: mode === 'TOURNAMENT' ? "#ffffff" : "#9ca3af",
                  fontWeight: mode === 'TOURNAMENT' ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                {t("createTable.tournament")}
              </button>
            </div>

            {mode === 'CASH' ? (
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
            ) : (
              <div style={{ display: "grid", gap: "0.85rem", padding: "0.5rem", backgroundColor: "rgba(139, 92, 246, 0.05)", borderRadius: "0.75rem", border: "1px solid rgba(139, 92, 246, 0.2)" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "#e2e8f0", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                    <input type="radio" checked={tournamentSettingMode === 'SIMPLE'} onChange={() => setTournamentSettingMode('SIMPLE')} />
                    {t("createTable.simpleMode")}
                  </label>
                  <label style={{ fontSize: "0.85rem", color: "#e2e8f0", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                    <input type="radio" checked={tournamentSettingMode === 'EXPERT'} onChange={() => setTournamentSettingMode('EXPERT')} />
                    {t("createTable.expertMode")}
                  </label>
                </div>

                <Field label={t("createTable.estimatedPlayers")}>
                   <input
                     type="range" min="2" max="20" step="1"
                     value={estimatedPlayers}
                     onChange={(e) => setEstimatedPlayers(Number(e.target.value))}
                   />
                   <div style={{ textAlign: "center", color: "#e2e8f0", fontSize: "0.9rem" }}>{estimatedPlayers}</div>
                </Field>
                <Field label={t("createTable.targetDuration")}>
                   <input
                     type="range" min="1" max="8" step="0.5"
                     value={durationHours}
                     onChange={(e) => setDurationHours(Number(e.target.value))}
                   />
                   <div style={{ textAlign: "center", color: "#e2e8f0", fontSize: "0.9rem" }}>{durationHours}</div>
                </Field>
                
                {tournamentSettingMode === 'EXPERT' && (
                  <>
                    <Field label={t("createTable.levelDuration")}>
                       <input
                         type="range" min="5" max="60" step="5"
                         value={levelMins}
                         onChange={(e) => setLevelMins(Number(e.target.value))}
                       />
                       <div style={{ textAlign: "center", color: "#e2e8f0", fontSize: "0.9rem" }}>{levelMins}</div>
                    </Field>

                    <div style={{ marginTop: "0.5rem" }}>
                      <label style={{ fontSize: "0.85rem", fontWeight: 500, color: "#cbd5e1" }}>{t("createTable.blindSchedulePreview")}</label>
                      <div style={{ maxHeight: "120px", overflowY: "auto", border: "1px solid #334155", borderRadius: "0.5rem", padding: "0.5rem", marginTop: "0.25rem", fontSize: "0.8rem", backgroundColor: "#0f172a" }}>
                        {blindSchedule.map((lvl, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0", borderBottom: idx === blindSchedule.length - 1 ? "none" : "1px solid #1e293b", color: "#94a3b8" }}>
                             <span>Lvl {idx + 1}</span>
                             <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{lvl.sb} / {lvl.bb}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

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
