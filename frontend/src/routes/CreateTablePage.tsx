import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { createTable } from "../lib/firestoreApi";
import { collection, query, where, doc, writeBatch, serverTimestamp, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Check, Users, ShieldAlert } from "lucide-react";

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
  const { user, username } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [onlineFriends, setOnlineFriends] = useState<{ uid: string; username: string }[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);

  // Listen to friends status in real-time
  useEffect(() => {
    if (!user) return;

    const qFriends = query(
      collection(db, "users", user.uid, "friends"),
      where("status", "==", "ACCEPTED")
    );

    let unsubFriendDocs: (() => void)[] = [];

    const unsubFriends = onSnapshot(qFriends, (snap) => {
      unsubFriendDocs.forEach(unsub => unsub());
      unsubFriendDocs = [];

      const friendsList: { friendUid: string; username: string }[] = [];
      snap.forEach((d) => {
        const fData = d.data();
        friendsList.push({
          friendUid: d.id,
          username: fData.username || "Friend"
        });
      });

      if (friendsList.length === 0) {
        setOnlineFriends([]);
        return;
      }

      const activeFriendStates: Record<string, any> = {};

      friendsList.forEach((friend) => {
        const friendDocRef = doc(db, "users", friend.friendUid);
        const unsubDoc = onSnapshot(friendDocRef, (friendSnap) => {
          if (friendSnap.exists()) {
            const fDocData = friendSnap.data();
            const presence = fDocData.presence;
            
            const isOnlineAndHome = presence?.status === "ONLINE" &&
                                    presence?.location === "HOME" &&
                                    presence?.lastActive &&
                                    (Date.now() - presence.lastActive.toMillis() < 5 * 60 * 1000);

            if (isOnlineAndHome) {
              activeFriendStates[friend.friendUid] = {
                uid: friend.friendUid,
                username: fDocData.username || friend.username
              };
            } else {
              delete activeFriendStates[friend.friendUid];
            }
          } else {
            delete activeFriendStates[friend.friendUid];
          }

          setOnlineFriends(Object.values(activeFriendStates));
        });

        unsubFriendDocs.push(unsubDoc);
      });
    });

    return () => {
      unsubFriends();
      unsubFriendDocs.forEach(unsub => unsub());
    };
  }, [user]);

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

      // Send invitations to all selected friends
      if (selectedFriends.length > 0) {
        const batch = writeBatch(db);
        selectedFriends.forEach((friendUid) => {
          const inviteRef = doc(db, "users", friendUid, "invitations", id);
          batch.set(inviteRef, {
            senderUid: user!.uid,
            senderUsername: username || user!.displayName || "Player",
            tableId: id,
            tableName: name.trim() || `${t("createTable.randomPrefix")} ${randomName}`,
            createdAt: serverTimestamp()
          });
        });
        await batch.commit();
      }

      navigate(`/table/${id}`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || t("createTable.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="create-table-container" id="create-table-page-container">
      <div className="glass-panel create-table-panel" id="create-table-panel-box">
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "var(--font-display)" }} id="create-table-title">
          {t("createTable.title")}
        </h1>

        <form onSubmit={handleSubmit} className="form-group" id="form-create-table">
          <Field
            label={t("createTable.nameLabel")}
            description={t("createTable.nameDesc")}
            id="field-table-name"
          >
            <input
              id="input-table-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("createTable.namePlaceholder")}
              autoComplete="off"
            />
          </Field>

          <Field
            label={t("createTable.stackLabel")}
            description={t("createTable.stackDesc")}
            id="field-initial-stack"
          >
            <input
              id="input-initial-stack"
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

          {/* Mode Switcher */}
          <div className="grid-selector-bar" id="game-mode-selector">
            <button
              id="btn-select-cash"
              type="button"
              onClick={() => setMode('CASH')}
              className={`grid-selector-btn ${mode === 'CASH' ? 'active-cash' : ''}`}
            >
              {t("createTable.cashGame")}
            </button>
            <button
              id="btn-select-tournament"
              type="button"
              onClick={() => setMode('TOURNAMENT')}
              className={`grid-selector-btn ${mode === 'TOURNAMENT' ? 'active-tournament' : ''}`}
            >
              {t("createTable.tournament")}
            </button>
          </div>

          {mode === 'CASH' ? (
            <div className="grid-selector-bar" id="cash-blinds-container" style={{ border: "none", backgroundColor: "transparent", padding: 0 }}>
              <Field label={t("createTable.smallBlindLabel")} id="field-small-blind">
                <input
                  id="input-small-blind"
                  type="number"
                  min={5}
                  step={5}
                  value={smallBlind}
                  onChange={(e) => setSmallBlind(Number(e.target.value))}
                />
              </Field>
              <Field label={t("createTable.bigBlindLabel")} id="field-big-blind">
                <input
                  id="input-big-blind"
                  type="number"
                  min={10}
                  step={5}
                  value={bigBlind}
                  onChange={(e) => setBigBlind(Number(e.target.value))}
                />
              </Field>
            </div>
          ) : (
            <div className="tournament-settings-panel" id="tournament-settings-box">
              <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", marginBottom: "0.3rem" }}>
                <label style={{ fontSize: "0.85rem", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input id="radio-tournament-simple" type="radio" checked={tournamentSettingMode === 'SIMPLE'} onChange={() => setTournamentSettingMode('SIMPLE')} style={{ cursor: "pointer" }} />
                  {t("createTable.simpleMode")}
                </label>
                <label style={{ fontSize: "0.85rem", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input id="radio-tournament-expert" type="radio" checked={tournamentSettingMode === 'EXPERT'} onChange={() => setTournamentSettingMode('EXPERT')} style={{ cursor: "pointer" }} />
                  {t("createTable.expertMode")}
                </label>
              </div>

              <Field label={t("createTable.estimatedPlayers")} id="field-estimated-players">
                 <input
                   id="input-estimated-players"
                   type="range" min="2" max="20" step="1"
                   value={estimatedPlayers}
                   onChange={(e) => setEstimatedPlayers(Number(e.target.value))}
                 />
                 <div style={{ textAlign: "center", color: "var(--text-main)", fontSize: "0.9rem", fontWeight: 600 }}>{estimatedPlayers}</div>
              </Field>
              <Field label={t("createTable.targetDuration")} id="field-target-duration">
                 <input
                   id="input-target-duration"
                   type="range" min="1" max="8" step="0.5"
                   value={durationHours}
                   onChange={(e) => setDurationHours(Number(e.target.value))}
                 />
                 <div style={{ textAlign: "center", color: "var(--text-main)", fontSize: "0.9rem", fontWeight: 600 }}>{durationHours}</div>
              </Field>
              
              {tournamentSettingMode === 'EXPERT' && (
                <>
                  <Field label={t("createTable.levelDuration")} id="field-level-duration">
                     <input
                       id="input-level-duration"
                       type="range" min="5" max="60" step="5"
                       value={levelMins}
                       onChange={(e) => setLevelMins(Number(e.target.value))}
                     />
                     <div style={{ textAlign: "center", color: "var(--text-main)", fontSize: "0.9rem", fontWeight: 600 }}>{levelMins}</div>
                  </Field>

                  <div style={{ marginTop: "0.4rem" }}>
                    <label className="form-label-title">{t("createTable.blindSchedulePreview")}</label>
                    <div className="blind-preview-box" id="blind-schedule-preview">
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
            id="field-virtual-cards"
          >
            <div className="grid-selector-bar" id="cards-type-selector">
              <button
                id="btn-cards-physical"
                type="button"
                onClick={() => setIsVirtualCards(false)}
                className={`grid-selector-btn ${!isVirtualCards ? 'active-cash' : ''}`}
              >
                🃏 {t("createTable.physicalCards")}
              </button>
              <button
                id="btn-cards-virtual"
                type="button"
                onClick={() => setIsVirtualCards(true)}
                className={`grid-selector-btn ${isVirtualCards ? 'active-tournament' : ''}`}
              >
                💻 {t("createTable.virtualCards")}
              </button>
            </div>
          </Field>

          <Field
            label={t("createTable.passwordLabel")}
            description={t("createTable.passwordDesc")}
            id="field-table-password"
          >
            <input
              id="input-table-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("createTable.passwordPlaceholder")}
              autoComplete="off"
            />
          </Field>

          {/* Invite Friends Checklist */}
          <div className="form-field-group" id="field-invite-friends" style={{ marginTop: "1rem" }}>
            <label className="form-label-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Users size={16} />
              {t("dashboard.inviteFriendsTitle") || "Invita Amici"}
            </label>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem 0", lineHeight: 1.3 }}>
              {t("createTable.inviteFriendsDesc") || "Seleziona gli amici online nella HomePage da invitare al tuo tavolo."}
            </p>
            
            {onlineFriends.length === 0 ? (
              <div style={{ padding: "0.85rem", borderRadius: "0.6rem", border: "1px solid rgba(255,255,255,0.04)", backgroundColor: "rgba(255,255,255,0.01)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <ShieldAlert size={16} style={{ color: "var(--text-muted)" }} />
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {t("dashboard.noFriendsOnline") || "Nessun amico online nella Home al momento."}
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "150px", overflowY: "auto", padding: "0.4rem 0" }}>
                {onlineFriends.map((friend) => {
                  const isChecked = selectedFriends.includes(friend.uid);
                  return (
                    <div 
                      key={friend.uid} 
                      onClick={() => {
                        if (isChecked) {
                          setSelectedFriends(selectedFriends.filter(id => id !== friend.uid));
                        } else {
                          setSelectedFriends([...selectedFriends, friend.uid]);
                        }
                      }}
                      style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between", 
                        padding: "0.55rem 0.75rem", 
                        borderRadius: "0.5rem", 
                        backgroundColor: isChecked ? "rgba(16, 185, 129, 0.08)" : "rgba(255,255,255,0.01)",
                        border: isChecked ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255,255,255,0.04)",
                        cursor: "pointer",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>@{friend.username}</span>
                      <div style={{ 
                        width: "18px", 
                        height: "18px", 
                        borderRadius: "4px", 
                        border: isChecked ? "none" : "1px solid rgba(255,255,255,0.2)", 
                        backgroundColor: isChecked ? "var(--color-success)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>
                        {isChecked && <Check size={12} color="#fff" strokeWidth={3} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "var(--color-danger)", margin: "0.2rem 0" }} id="create-table-error">{errorMsg}</p>
          )}

          <button
            id="btn-submit-create-table"
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
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-field-group" id={props.id}>
      <label className="form-label-title">
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
