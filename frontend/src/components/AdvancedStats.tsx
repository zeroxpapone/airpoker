import { useTranslation } from "react-i18next";
import { 
  Flame, 
  Clock, 
  Layers, 
  Compass,
  TrendingUp
} from "lucide-react";

export interface AdvancedStatsData {
  handsPlayed: number;
  handsWon: number;
  totalChipsWon?: number;
  totalChipsLost?: number;
  netProfit: number;
  sessionsPlayed: number;
  timePlayedSeconds?: number;
  bestHandName?: string;
  vpipCount?: number;
  vpipEligibleHands?: number;
  totalActions?: number;
  aggressiveActions?: number;
  stagePreflopCount?: number;
  stageFlopCount?: number;
  stageTurnCount?: number;
  stageRiverCount?: number;
}

interface AdvancedStatsProps {
  stats: AdvancedStatsData;
}

export default function AdvancedStats({ stats }: AdvancedStatsProps) {
  const { t } = useTranslation();

  const totalHands = stats.handsPlayed || 0;
  const winRate = totalHands > 0 ? Math.round((stats.handsWon / totalHands) * 100) : 0;

  // Every metric below is shown only when its own counter has actually recorded
  // something. These used to fall back to a "simulated" value derived from winRate,
  // which for an account that had never played evaluated to a constant — VPIP 22%,
  // aggression 35% — and those two constants then classified the player as "LAG" on
  // the radar. A profile that has never played a hand must read as empty, not as an
  // average player: invented numbers here are indistinguishable from measured ones.
  const NO_DATA = "—";

  // vpipEligibleHands (not handsPlayed/stagePreflopCount) is the right denominator
  // and "do we have real data" signal. handsPlayed/stagePreflopCount have been
  // accumulating since long before vpipCount tracking was fixed, so dividing
  // vpipCount by either of them would produce an artificially low ratio for
  // months until enough new hands dilute out the pre-fix history.
  // vpipEligibleHands started at the same zero baseline as vpipCount, so their
  // ratio is meaningful immediately, and a genuine 0% VPIP player is a real 0%.
  const hasVpipData = (stats.vpipEligibleHands || 0) > 0;
  const vpip = hasVpipData
    ? Math.round(((stats.vpipCount || 0) / stats.vpipEligibleHands!) * 100)
    : null;

  // Aggression Frequency (Aggressive vs Passive)
  const totalActions = stats.totalActions || 0;
  const aggActions = stats.aggressiveActions || 0;
  const hasAggData = totalActions > 0;
  const aggFreq = hasAggData ? Math.round((aggActions / totalActions) * 100) : null;

  // The style verdict needs BOTH axes — one alone places the marker on a guess.
  const hasStyleData = vpip !== null && aggFreq !== null;

  const isLoose = (vpip ?? 0) >= 22;
  const isAggressive = (aggFreq ?? 0) >= 35;

  const playerType = hasStyleData
    ? (isLoose ? (isAggressive ? "LAG" : "FISH") : (isAggressive ? "TAG" : "ROCK"))
    : null;

  const playerTypeDesc = hasStyleData
    ? (isLoose
        ? (isAggressive ? t("stats.styleLAGDesc") : t("stats.styleFISHDesc"))
        : (isAggressive ? t("stats.styleTAGDesc") : t("stats.styleROCKDesc")))
    : t("stats.noStyleDataDesc");

  // Calculate Marker Coordinate in 200x200 SVG Viewport
  // Center is (100, 100)
  // X axis: Tight (left, X=30) to Loose (right, X=170) -> map VPIP 10% to 50%
  const xOffset = (((vpip ?? 22) - 22) / 20) * 55;
  const markerX = Math.max(30, Math.min(170, 100 + xOffset));

  // Y axis: Aggressive (top, Y=30) to Passive (bottom, Y=170) -> map aggFreq 15% to 55%
  const yOffset = (((aggFreq ?? 35) - 35) / 20) * 55;
  const markerY = Math.max(30, Math.min(170, 100 - yOffset));

  // Real seconds or nothing. The old fallback multiplied sessionsPlayed by an
  // invented 0.8h-per-session and rendered the product as measured playtime.
  const timePlayedHours = stats.timePlayedSeconds !== undefined
    ? (stats.timePlayedSeconds / 3600).toFixed(1)
    : null;

  return (
    <div className="stats-detailed-container" style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem", width: "100%" }} id="advanced-stats-root">
      
      {/* Radar Chart Card */}
      <div className="glass-panel radar-chart-card" id="radar-chart-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: "1.5px" }}>
          {t("stats.playerStyle") || "Stile di Gioco"}
        </span>
        <h2 className="radar-chart-title" style={{ marginTop: "0.2rem", fontSize: "1.8rem", fontWeight: 800 }}>
          {playerType ?? NO_DATA}
        </h2>
        <p className="radar-chart-subtitle" style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.3rem", lineHeight: 1.4 }}>
          {playerTypeDesc}
        </p>

        {/* SVG Radar Map */}
        <div className="radar-chart-svg-container" style={{ position: "relative", marginTop: "1.5rem", width: "220px", height: "220px" }}>
          {/* Corner Badges */}
          <div className={`radar-badge tag ${playerType === "TAG" ? "active" : ""}`} style={{ position: "absolute", top: 0, left: 0, fontSize: "0.7rem", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", opacity: playerType === "TAG" ? 1 : 0.25, backgroundColor: playerType === "TAG" ? "rgba(168, 85, 247, 0.2)" : "transparent", color: "#a855f7" }}>TAG</div>
          <div className={`radar-badge lag ${playerType === "LAG" ? "active" : ""}`} style={{ position: "absolute", top: 0, right: 0, fontSize: "0.7rem", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", opacity: playerType === "LAG" ? 1 : 0.25, backgroundColor: playerType === "LAG" ? "rgba(249, 115, 22, 0.2)" : "transparent", color: "#f97316" }}>LAG</div>
          <div className={`radar-badge rock ${playerType === "ROCK" ? "active" : ""}`} style={{ position: "absolute", bottom: 0, left: 0, fontSize: "0.7rem", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", opacity: playerType === "ROCK" ? 1 : 0.25, backgroundColor: playerType === "ROCK" ? "rgba(59, 130, 246, 0.2)" : "transparent", color: "#3b82f6" }}>ROCK</div>
          <div className={`radar-badge fish ${playerType === "FISH" ? "active" : ""}`} style={{ position: "absolute", bottom: 0, right: 0, fontSize: "0.7rem", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", opacity: playerType === "FISH" ? 1 : 0.25, backgroundColor: playerType === "FISH" ? "rgba(239, 68, 68, 0.2)" : "transparent", color: "#ef4444" }}>FISH</div>

          <svg width="220" height="220" viewBox="0 0 200 200">
            {/* Grid level diamonds */}
            <polygon points="100,20 180,100 100,180 20,100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <polygon points="100,40 160,100 100,160 40,100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <polygon points="100,60 140,100 100,140 60,100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <polygon points="100,80 120,100 100,120 80,100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

            {/* Grid Cross axes */}
            <line x1="100" y1="20" x2="100" y2="180" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3,3" />
            <line x1="20" y1="100" x2="180" y2="100" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3,3" />

            {/* Axis Titles */}
            <text x="100" y="15" fill="#ef4444" fontSize="9" fontWeight="800" textAnchor="middle">
              {t("stats.axisAggressive") || "AGGRESSIVE"}
            </text>
            <text x="195" y="103" fill="#f97316" fontSize="9" fontWeight="800" textAnchor="end">
              {t("stats.axisLoose") || "LOOSE"}
            </text>
            <text x="100" y="196" fill="#3b82f6" fontSize="9" fontWeight="800" textAnchor="middle">
              {t("stats.axisPassive") || "PASSIVE"}
            </text>
            <text x="5" y="103" fill="#a855f7" fontSize="9" fontWeight="800" textAnchor="start">
              {t("stats.axisTight") || "TIGHT"}
            </text>

            {/* Dynamic Player Shape — only once both axes are measured. Plotting a
                marker without data would put a confident dot on a guessed position. */}
            {hasStyleData && (
              <>
                <polygon
                  points={`100,${Math.min(100, markerY)} ${Math.max(100, markerX)},100 100,${Math.max(100, markerY)} ${Math.min(100, markerX)},100`}
                  fill="rgba(59, 130, 246, 0.15)"
                  stroke="var(--color-primary)"
                  strokeWidth="1.5"
                />

                {/* Active Position Indicator */}
                <defs>
                  <radialGradient id="markerGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="1" />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx={markerX} cy={markerY} r="10" fill="url(#markerGlow)" />
                <circle cx={markerX} cy={markerY} r="4" fill="#fff" stroke="var(--color-primary)" strokeWidth="2" />
              </>
            )}
          </svg>
        </div>
      </div>

      {/* Metrics List */}
      <div className="stats-detailed-list" id="stats-detailed-list" style={{ display: "flex", flexDirection: "column", gap: "0.8rem", width: "100%" }}>
        
        {/* Aggression Freq */}
        <div className="glass-panel stats-detailed-row" id="stats-row-aggression" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="stats-detailed-label-group" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div className="icon-wrapper-base green">
              <Flame size={18} />
            </div>
            <span className="stats-detailed-label">{t("stats.aggressionFreq") || "Aggression freq."}</span>
          </div>
          <span className="stats-detailed-value" style={{ fontWeight: 800 }}>
            {aggFreq === null ? NO_DATA : `${aggFreq}%`}
          </span>
        </div>

        {/* Time Played */}
        <div className="glass-panel stats-detailed-row" id="stats-row-time" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="stats-detailed-label-group" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div className="icon-wrapper-base blue">
              <Clock size={18} />
            </div>
            <span className="stats-detailed-label">{t("stats.timePlayed") || "Tempo di gioco"}</span>
          </div>
          <span className="stats-detailed-value" style={{ fontWeight: 800 }}>
            {timePlayedHours === null ? NO_DATA : `${timePlayedHours}h`}
          </span>
        </div>

        {/* Street Frequencies */}
        <div className="glass-panel" style={{ padding: "1rem", width: "100%" }} id="stats-card-streets">
          <div className="stats-detailed-label-group" style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.8rem" }}>
            <div className="icon-wrapper-base pink">
              <Layers size={18} />
            </div>
            <span className="stats-detailed-label" style={{ fontWeight: 700 }}>{t("stats.streetsReached") || "Strade Raggiunte"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", width: "100%" }}>
            <div className="stats-sub-box" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="stats-sub-label" style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600 }}>{t("stats.preflop") || "Pre"}</span>
              <span className="stats-sub-value" style={{ fontSize: "0.9rem", fontWeight: 800, marginTop: "2px" }}>{stats.stagePreflopCount || 0}</span>
            </div>
            <div className="stats-sub-box" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="stats-sub-label" style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600 }}>{t("stats.flop") || "Flop"}</span>
              <span className="stats-sub-value" style={{ fontSize: "0.9rem", fontWeight: 800, marginTop: "2px" }}>{stats.stageFlopCount || 0}</span>
            </div>
            <div className="stats-sub-box" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="stats-sub-label" style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600 }}>{t("stats.turn") || "Turn"}</span>
              <span className="stats-sub-value" style={{ fontSize: "0.9rem", fontWeight: 800, marginTop: "2px" }}>{stats.stageTurnCount || 0}</span>
            </div>
            <div className="stats-sub-box" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="stats-sub-label" style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600 }}>{t("stats.river") || "River"}</span>
              <span className="stats-sub-value" style={{ fontSize: "0.9rem", fontWeight: 800, marginTop: "2px" }}>{stats.stageRiverCount || 0}</span>
            </div>
          </div>
        </div>

        {/* General stats */}
        <div className="glass-panel stats-detailed-row" id="stats-row-general" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="stats-detailed-label-group" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div className="icon-wrapper-base yellow">
              <Compass size={18} />
            </div>
            <div>
              <span className="stats-detailed-label" style={{ display: "block" }}>{t("stats.handsOverview") || "Resoconto Mani"}</span>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                {stats.handsPlayed} {t("stats.handsPlayedShort") || "giocate"} • {stats.handsWon} {t("stats.handsWonShort") || "vinte"}
              </span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span className="stats-detailed-value" style={{ display: "block", fontWeight: 800 }}>{winRate}%</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t("stats.winRate") || "Win rate"}</span>
          </div>
        </div>

        {/* Cash profit */}
        <div className="glass-panel stats-detailed-row" id="stats-row-profit" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="stats-detailed-label-group" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div className="icon-wrapper-base yellow">
              <TrendingUp size={18} />
            </div>
            <span className="stats-detailed-label">{t("stats.sessionsProfit") || "Profitto Cash"}</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <span className="stats-detailed-value" style={{ 
              display: "block", 
              fontWeight: 800,
              color: stats.netProfit > 0 ? "#10b981" : stats.netProfit < 0 ? "#ef4444" : "#fff" 
            }}>
              {stats.netProfit > 0 ? `+${stats.netProfit}` : stats.netProfit}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {stats.sessionsPlayed} {t("stats.sessionsShort") || "sess."}
            </span>
          </div>
        </div>

      </div>

    </div>
  );
}
