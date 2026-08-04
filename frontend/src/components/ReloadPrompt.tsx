import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X } from "lucide-react";

/**
 * How often to actively ask the browser whether a newer service worker (i.e. a
 * new deploy) exists.
 *
 * Without an explicit check like this, the browser only looks for a new service
 * worker when the page is loaded from scratch. That's a bad fit here: this is an
 * installed PWA whose sessions run for hours (useWakeLock even holds the screen
 * on during a game), and once the service worker is active it answers every
 * navigation from its own precache — so in-app routing never hits the network
 * for fresh HTML either. The net effect was that a client could sit on a stale
 * bundle for an entire evening and never be offered the update.
 */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Floor between checks, so visibility/online bursts can't spam the network. */
const MIN_CHECK_GAP_MS = 60 * 1000;

/**
 * "Later" snoozes rather than dismissing permanently. Previously it hid the
 * banner until the next full page load which, for a long-lived PWA session,
 * effectively meant "never".
 */
const SNOOZE_MS = 30 * 60 * 1000;

export default function ReloadPrompt() {
  const { i18n } = useTranslation();

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const swUrlRef = useRef<string | null>(null);
  const lastCheckRef = useRef(0);

  const [snoozedUntil, setSnoozedUntil] = useState(0);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      swUrlRef.current = swUrl;
      registrationRef.current = registration ?? null;
    },
    onRegisterError(error) {
      console.error("Service worker registration failed:", error);
    },
  });

  const checkForUpdate = useCallback(async () => {
    const registration = registrationRef.current;
    const swUrl = swUrlRef.current;
    if (!registration || !swUrl) return;
    if (registration.installing) return;
    if ("onLine" in navigator && !navigator.onLine) return;

    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_GAP_MS) return;
    lastCheckRef.current = now;

    try {
      // Probe the service worker script with the HTTP cache fully bypassed
      // before asking for an update: if a stale copy were served from cache,
      // registration.update() would diff against that and conclude nothing
      // changed, silently swallowing the new deploy.
      const resp = await fetch(swUrl, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      if (resp?.status === 200) {
        await registration.update();
      }
    } catch {
      // Offline or a transient network failure — the next tick retries.
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    // Coming back to a backgrounded tab / phone, or regaining connectivity, are
    // the moments a user is most likely to have missed a deploy.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", checkForUpdate);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", checkForUpdate);
    };
  }, [checkForUpdate]);

  // Clear the snooze once it expires so the banner can reappear on its own.
  useEffect(() => {
    if (!snoozedUntil) return;
    const remaining = snoozedUntil - Date.now();
    if (remaining <= 0) {
      setSnoozedUntil(0);
      return;
    }
    const timer = setTimeout(() => setSnoozedUntil(0), remaining);
    return () => clearTimeout(timer);
  }, [snoozedUntil]);

  if (!needRefresh || Date.now() < snoozedUntil) return null;

  const snooze = () => setSnoozedUntil(Date.now() + SNOOZE_MS);

  const isIt = i18n.resolvedLanguage === "it";
  const message = isIt
    ? "È disponibile un aggiornamento! Ricarica la pagina per applicare le ultime modifiche."
    : "An update is available! Refresh the page to apply the latest changes.";
  const refreshText = isIt ? "Aggiorna ora" : "Update now";

  return (
    <div style={{
      position: "fixed",
      // Anchored to the top: the game table is a full-viewport fixed layout with
      // its Fold / Check-Call / Bet-Raise controls pinned to the bottom, and this
      // banner sits above everything at z-index 100000 — bottom-anchoring it
      // covered the exact buttons a player needs while it's their turn.
      top: "max(env(safe-area-inset-top), 16px)",
      right: "16px",
      left: "16px",
      margin: "0 auto",
      maxWidth: "450px",
      zIndex: 100000,
    }}>
      <div className="glass-panel" style={{
        padding: "1.25rem",
        borderRadius: "1.25rem",
        border: "1px solid rgba(59, 130, 246, 0.25)",
        boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 15px rgba(59, 130, 246, 0.1)",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        backdropFilter: "blur(16px)"
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
          <div style={{
            background: "rgba(59, 130, 246, 0.15)",
            padding: "0.5rem",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#3b82f6",
            flexShrink: 0
          }}>
            <RefreshCw size={18} />
          </div>
          <div style={{ flexGrow: 1 }}>
            <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>
              {isIt ? "Aggiornamento Disponibile" : "Update Available"}
            </h4>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#9ca3af", lineHeight: 1.4 }}>
              {message}
            </p>
          </div>
          <button
            onClick={snooze}
            style={{
              background: "transparent",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center"
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            onClick={snooze}
            className="poker-btn-secondary"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.1)",
              backgroundColor: "transparent",
              color: "#fff"
            }}
          >
            {isIt ? "Più tardi" : "Later"}
          </button>
          <button
            onClick={() => updateServiceWorker(true)}
            className="poker-btn-primary"
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              backgroundColor: "#2563eb",
              border: "none",
              color: "#fff"
            }}
          >
            <RefreshCw size={14} />
            {refreshText}
          </button>
        </div>
      </div>
    </div>
  );
}
