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
  const [isVirtualCards, setIsVirtualCards] = useState(false);

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
        const lastBB: number = schedule[schedule.length - 1].bb;
        const nextBB: number = lastBB + (lastBB < 500 ? 100 : lastBB < 2000 ? 500 : 1000);
        let nextSB: number = Math.ceil(nextBB / 2 / 25) * 25;
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
          } : undefined,
          isVirtualCards
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
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "2rem 1.5rem",
          display: "grid",
          gap: "1.2rem"
        }}
      >
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "var(--font-display)" }}>
          {t("createTable.title")}
        </h1>

        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: "1rem" }}
        >
          <Field
            label={t("createTable.nameLabel")}
            description={t("createTable.nameDesc")}
          >
            <input
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
              type="number"
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
              gap: "0.4rem",
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "0.25rem",
              borderRadius: "0.75rem",
              marginBottom: "0.2rem"
            }}
          >
            <button
              type="button"
              onClick={() => setMode('CASH')}
              style={{
                padding: "0.6rem",
                borderRadius: "0.5rem",
                border: "none",
                backgroundColor: mode === 'CASH' ? "var(--color-primary)" : "transparent",
                color: mode === 'CASH' ? "var(--text-main)" : "var(--text-muted)",
                fontWeight: mode === 'CASH' ? 700 : 500,
                fontSize: "0.9rem",
                cursor: "pointer",
                boxShadow: mode === 'CASH' ? "0 4px 10px rgba(59, 130, 246, 0.25)" : "none"
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
                backgroundColor: mode === 'TOURNAMENT' ? "var(--color-tournament)" : "transparent",
                color: mode === 'TOURNAMENT' ? "var(--text-main)" : "var(--text-muted)",
                fontWeight: mode === 'TOURNAMENT' ? 700 : 500,
                fontSize: "0.9rem",
                cursor: "pointer",
                boxShadow: mode === 'TOURNAMENT' ? "0 4px 10px rgba(139, 92, 246, 0.25)" : "none"
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
                gap: "0.85rem"
              }}
            >
              <Field label={t("createTable.smallBlindLabel")}>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={smallBlind}
                  onChange={(e) => setSmallBlind(Number(e.target.value))}
                />
              </Field>
              <Field label={t("createTable.bigBlindLabel")}>
                <input
                  type="number"
                  min={10}
                  step={5}
                  value={bigBlind}
                  onChange={(e) => setBigBlind(Number(e.target.value))}
                />
              </Field>
            </div>
          ) : (
            <div style={{
              display: "grid",
              gap: "0.9rem",
              padding: "0.8rem",
              backgroundColor: "rgba(139, 92, 246, 0.03)",
              borderRadius: "0.75rem",
              border: "1px solid rgba(139, 92, 246, 0.15)"
            }}>
              <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", marginBottom: "0.3rem" }}>
                <label style={{ fontSize: "0.85rem", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input type="radio" checked={tournamentSettingMode === 'SIMPLE'} onChange={() => setTournamentSettingMode('SIMPLE')} style={{ cursor: "pointer" }} />
                  {t("createTable.simpleMode")}
                </label>
                <label style={{ fontSize: "0.85rem", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input type="radio" checked={tournamentSettingMode === 'EXPERT'} onChange={() => setTournamentSettingMode('EXPERT')} style={{ cursor: "pointer" }} />
                  {t("createTable.expertMode")}
                </label>
              </div>

              <Field label={t("createTable.estimatedPlayers")}>
                 <input
                   type="range" min="2" max="20" step="1"
                   value={estimatedPlayers}
                   onChange={(e) => setEstimatedPlayers(Number(e.target.value))}
                 />
                 <div style={{ textAlign: "center", color: "var(--text-main)", fontSize: "0.9rem", fontWeight: 600 }}>{estimatedPlayers}</div>
              </Field>
              <Field label={t("createTable.targetDuration")}>
                 <input
                   type="range" min="1" max="8" step="0.5"
                   value={durationHours}
                   onChange={(e) => setDurationHours(Number(e.target.value))}
                 />
                 <div style={{ textAlign: "center", color: "var(--text-main)", fontSize: "0.9rem", fontWeight: 600 }}>{durationHours}</div>
              </Field>
              
              {tournamentSettingMode === 'EXPERT' && (
                <>
                  <Field label={t("createTable.levelDuration")}>
                     <input
                       type="range" min="5" max="60" step="5"
                       value={levelMins}
                       onChange={(e) => setLevelMins(Number(e.target.value))}
                     />
                     <div style={{ textAlign: "center", color: "var(--text-main)", fontSize: "0.9rem", fontWeight: 600 }}>{levelMins}</div>
                  </Field>

                  <div style={{ marginTop: "0.4rem" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)" }}>{t("createTable.blindSchedulePreview")}</label>
                    <div style={{
                      maxHeight: "120px",
                      overflowY: "auto",
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                      borderRadius: "0.75rem",
                      padding: "0.6rem",
                      marginTop: "0.25rem",
                      fontSize: "0.8rem",
                      backgroundColor: "rgba(15, 23, 42, 0.5)"
                    }}>
                      {blindSchedule.map((lvl, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", borderBottom: idx === blindSchedule.length - 1 ? "none" : "1px solid rgba(255, 255, 255, 0.04)", color: "var(--text-muted)" }}>
                           <span>Lvl {idx + 1}</span>
                           <span style={{ fontWeight: 700, color: "var(--text-main)" }}>{lvl.sb} / {lvl.bb}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <Field
            label={t("createTable.virtualCardsLabel")}
            description={t("createTable.virtualCardsDesc")}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.4rem",
                backgroundColor: "rgba(15, 23, 42, 0.5)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                padding: "0.25rem",
                borderRadius: "0.75rem"
              }}
            >
              <button
                type="button"
                onClick={() => setIsVirtualCards(false)}
                style={{
                  padding: "0.6rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  backgroundColor: !isVirtualCards ? "var(--color-primary)" : "transparent",
                  color: !isVirtualCards ? "var(--text-main)" : "var(--text-muted)",
                  fontWeight: !isVirtualCards ? 700 : 500,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                  boxShadow: !isVirtualCards ? "0 4px 10px rgba(59, 130, 246, 0.25)" : "none"
                }}
              >
                🃏 {t("createTable.physicalCards")}
              </button>
              <button
                type="button"
                onClick={() => setIsVirtualCards(true)}
                style={{
                  padding: "0.6rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  backgroundColor: isVirtualCards ? "var(--color-tournament)" : "transparent",
                  color: isVirtualCards ? "var(--text-main)" : "var(--text-muted)",
                  fontWeight: isVirtualCards ? 700 : 500,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                  boxShadow: isVirtualCards ? "0 4px 10px rgba(139, 92, 246, 0.25)" : "none"
                }}
              >
                💻 {t("createTable.virtualCards")}
              </button>
            </div>
          </Field>

          <Field
            label={t("createTable.passwordLabel")}
            description={t("createTable.passwordDesc")}
          >
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("createTable.passwordPlaceholder")}
            />
          </Field>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "var(--color-danger)", margin: "0.2rem 0" }}>{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="poker-btn-primary"
            style={{
              marginTop: "0.5rem",
              width: "100%",
              padding: "0.8rem 1.2rem",
              borderRadius: "999px",
              border: "none",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
              color: "var(--text-inverse)",
              fontWeight: 800,
              fontSize: "1rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em"
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
    <div style={{ display: "grid", gap: "0.3rem" }}>
      <label
        style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", textTransform: "uppercase", letterSpacing: "0.02em" }}
      >
        {props.label}
      </label>
      {props.description && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.1rem 0", lineHeight: 1.3 }}>
          {props.description}
        </p>
      )}
      {props.children}
    </div>
  );
}
