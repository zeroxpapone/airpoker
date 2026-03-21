import { useEffect, useRef } from "react";
// @ts-ignore
import NoSleep from "nosleep.js";

export function useWakeLock() {
  const noSleepRef = useRef<any>(null);

  useEffect(() => {
    noSleepRef.current = new NoSleep();

    const enableNoSleep = () => {
      if (noSleepRef.current) {
        // Sui dispositivi mobile (e browser come Safari/Chrome vecchi o molto restrittivi),
        // l'API WakeLock necessita TASSATIVAMENTE di essere legata a un evento di "user gesture" 
        // (un tap sul display o un click del mouse). Non può partire "automaticamente" al boot.
        noSleepRef.current.enable();
        console.log("NoSleep.js attivato (Schermo tenuto acceso in modo cross-browser)");

        // Rimuoviamo gli event listeners una volta che NoSleep è partito con successo.
        document.removeEventListener("click", enableNoSleep, false);
        document.removeEventListener("touchstart", enableNoSleep, false);
      }
    };

    // Rimaniamo in agguato per il PRIMO click o tap in assoluto dell'utente dentro la pagina del tavolo
    // (es. quando clicca "Siediti", "Check" o sfiora la UI da telefono) per bypassare il blocco.
    document.addEventListener("click", enableNoSleep, false);
    document.addEventListener("touchstart", enableNoSleep, false);

    return () => {
      document.removeEventListener("click", enableNoSleep, false);
      document.removeEventListener("touchstart", enableNoSleep, false);
      if (noSleepRef.current) {
        noSleepRef.current.disable();
        noSleepRef.current = null;
      }
    };
  }, []);
}
