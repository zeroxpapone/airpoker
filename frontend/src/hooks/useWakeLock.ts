import { useEffect, useRef } from "react";
// @ts-ignore
import NoSleep from "nosleep.js";

export function useWakeLock() {
  const noSleepRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    noSleepRef.current = new NoSleep();
    let noSleepEnabled = false;

    const handleInteraction = async () => {
      // 1. Eseguiamo NoSleep SUBITO (Sincrono) per raggirare le restrizioni di Safari iOS.
      // Manteniamo una flag per evitare di creare decine di video invisibili
      if (!noSleepEnabled && noSleepRef.current) {
        try {
          noSleepRef.current.enable();
          noSleepEnabled = true;
        } catch (e) {}
      }

      // 2. Richiediamo WakeLock nativo (Asincrono).
      // Se il wakeLockRef è null, significa che o non lo abbiamo mai chiesto, o il sistema lo ha ucciso.
      if ("wakeLock" in navigator && wakeLockRef.current === null) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          
          wakeLockRef.current.addEventListener("release", () => {
            // Se il telefono disattiva il modulo (es. risparmio energetico o app in background), resettiamo.
            // Al prossimo tocco, si riattiverà!
            wakeLockRef.current = null;
          });
        } catch (err) {
          // Permesso negato o batteria scarica
        }
      }
    };

    // Usiamo l'evento su TUTTO IL DOCUMENTO e NON LO RIMUOVIAMO MAI.
    // Ogni singolo tap dell'utente sul tavolo ( Fold, Call, Raise ) farà da "defibrillatore"
    // per il blocco schermo, resuscitandolo istantaneamente se il sistema operativo l'aveva spento.
    document.addEventListener("click", handleInteraction, { passive: true });
    document.addEventListener("touchstart", handleInteraction, { passive: true });

    // Rianima automaticamente anche se l'utente torna sull'app visivamente senza cliccare
    const handleVisibility = async () => {
      if (document.visibilityState === "visible" && "wakeLock" in navigator && wakeLockRef.current === null) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          wakeLockRef.current.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        } catch (e) {}
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
      document.removeEventListener("visibilitychange", handleVisibility);
      
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (noSleepRef.current) {
        noSleepRef.current.disable();
        noSleepRef.current = null;
      }
    };
  }, []);
}
