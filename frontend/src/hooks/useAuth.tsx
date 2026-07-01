import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  updateProfile,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  linkWithCredential,
  linkWithPopup,
  EmailAuthProvider,
  type User
} from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isRegisteredUser: boolean;
  username: string | null;
  photoURL: string | null;
  login: (displayName: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, username: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  linkGuestToRegistered: (email: string, password: string, username: string, type: "email" | "google") => Promise<void>;
  logout: () => Promise<void>;
  updatePhotoURL: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Helper to create user profile and enforce unique username in Firestore
async function createProfileForUser(uid: string, email: string | null, preferredUsername: string, forceUnique = false, photoURL?: string) {
  const cleanUsername = preferredUsername.trim();
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error("Il nome utente deve essere di almeno 3 caratteri.");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    throw new Error("Il nome utente può contenere solo lettere, numeri e underscore.");
  }

  let usernameToClaim = cleanUsername;

  await runTransaction(db, async (transaction) => {
    // Check if username unique
    let usernameDocRef = doc(db, "usernames", usernameToClaim.toLowerCase());
    let usernameDoc = await transaction.get(usernameDocRef);

    if (usernameDoc.exists()) {
      if (forceUnique) {
        throw new Error("Questo nome utente è già stato registrato da un altro utente.");
      }
      // auto-fallback for Google login if already taken
      let attempts = 0;
      while (usernameDoc.exists() && attempts < 10) {
        usernameToClaim = cleanUsername + Math.floor(Math.random() * 1000);
        usernameDocRef = doc(db, "usernames", usernameToClaim.toLowerCase());
        usernameDoc = await transaction.get(usernameDocRef);
        attempts++;
      }
      if (usernameDoc.exists()) {
        throw new Error("Impossibile generare un nome utente univoco. Riprova.");
      }
    }

    // Reserve username
    transaction.set(usernameDocRef, { uid });

    // Create user profile doc
    const userDocRef = doc(db, "users", uid);
    transaction.set(userDocRef, {
      uid,
      username: usernameToClaim,
      email: email,
      isRegistered: true,
      createdAt: serverTimestamp(),
      photoURL: photoURL || null,
      stats: {
        handsPlayed: 0,
        handsWon: 0,
        totalChipsWon: 0,
        totalChipsLost: 0,
        netProfit: 0,
        sessionsPlayed: 0,
        bestHandName: "",
        aggressiveActions: 0,
        totalActions: 0,
        stagePreflopCount: 0,
        stageFlopCount: 0,
        stageTurnCount: 0,
        stageRiverCount: 0
      }
    });
  });

  return usernameToClaim;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [isRegisteredUser, setIsRegisteredUser] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        if (!firebaseUser.isAnonymous) {
          setIsRegisteredUser(true);
          // Fetch username & photoURL from Firestore
          try {
            const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
            if (userDoc.exists()) {
              const uData = userDoc.data();
              setUsername(uData.username || firebaseUser.displayName || "Giocatore");
              setPhotoURL(uData.photoURL || firebaseUser.photoURL || null);
            } else {
              // Fallback if doc doesn't exist yet (e.g., interrupted OAuth flow)
              setUsername(firebaseUser.displayName || "Giocatore");
              setPhotoURL(firebaseUser.photoURL || null);
            }
          } catch (e) {
            console.error("Errore nel recupero dello username:", e);
            setUsername(firebaseUser.displayName || "Giocatore");
            setPhotoURL(firebaseUser.photoURL || null);
          }
        } else {
          setIsRegisteredUser(false);
          setUsername(firebaseUser.displayName);
          setPhotoURL(null);
        }
      } else {
        setUser(null);
        setIsRegisteredUser(false);
        setUsername(null);
        setPhotoURL(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function login(displayName: string) {
    const trimmed = displayName.trim();
    if (!trimmed) {
      throw new Error("Devi scegliere un nickname per continuare.");
    }

    if (auth.currentUser) {
      if (auth.currentUser.displayName !== trimmed) {
        await updateProfile(auth.currentUser, { displayName: trimmed });
      }
      setUser(auth.currentUser);
      setUsername(trimmed);
      return;
    }

    const cred = await signInAnonymously(auth);
    if (cred.user) {
      await updateProfile(cred.user, { displayName: trimmed });
      setUser({ ...cred.user, displayName: trimmed } as User);
      setUsername(trimmed);
    }
  }

  async function registerWithEmail(email: string, password: string, desiredUsername: string) {
    if (!email.trim() || !password || !desiredUsername.trim()) {
      throw new Error("Tutti i campi sono obbligatori.");
    }

    // 1. Create firebase auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const u = cred.user;

    try {
      // 2. Create firestore profile and reserve username
      const finalUsername = await createProfileForUser(u.uid, email, desiredUsername, true);
      // 3. Update auth profile displayName
      await updateProfile(u, { displayName: finalUsername });
      setUser(u);
      setUsername(finalUsername);
      setPhotoURL(null);
      setIsRegisteredUser(true);
    } catch (err) {
      // Rollback auth user if firestore registration fails
      await u.delete();
      throw err;
    }
  }

  async function loginWithEmail(email: string, password: string) {
    if (!email.trim() || !password) {
      throw new Error("Email e password sono obbligatorie.");
    }
    const cred = await signInWithEmailAndPassword(auth, email, password);
    setUser(cred.user);
    setIsRegisteredUser(true);
  }

  async function signInWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider);
    const u = cred.user;

    // Check if user document already exists in Firestore
    const userDocRef = doc(db, "users", u.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      // Create profile with auto-unique username derived from displayName or email
      const baseName = u.displayName || u.email?.split("@")[0] || "player";
      const finalUsername = await createProfileForUser(u.uid, u.email, baseName, false, u.photoURL || undefined);
      await updateProfile(u, { displayName: finalUsername, photoURL: u.photoURL || undefined });
      setUsername(finalUsername);
      setPhotoURL(u.photoURL || null);
    } else {
      const uData = userDoc.data();
      setUsername(uData.username || u.displayName || "Giocatore");
      setPhotoURL(uData.photoURL || u.photoURL || null);
    }

    setUser(u);
    setIsRegisteredUser(true);
  }



  async function linkGuestToRegistered(email: string, password: string, desiredUsername: string, type: "email" | "google") {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.isAnonymous) {
      throw new Error("Nessun account ospite attivo da convertire.");
    }

    if (type === "email") {
      if (!email.trim() || !password || !desiredUsername.trim()) {
        throw new Error("Tutti i campi sono obbligatori per la registrazione.");
      }

      // Reserve username first to avoid linking if username is taken
      const usernameToClaim = desiredUsername.trim();
      const usernameDocRef = doc(db, "usernames", usernameToClaim.toLowerCase());
      const usernameDoc = await getDoc(usernameDocRef);
      if (usernameDoc.exists()) {
        throw new Error("Questo nome utente è già stato registrato da un altro utente.");
      }

      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(currentUser, credential);

      // Now create the profile document
      const finalUsername = await createProfileForUser(currentUser.uid, email, desiredUsername, true);
      await updateProfile(currentUser, { displayName: finalUsername });
      setUsername(finalUsername);
    } else if (type === "google") {
      const provider = googleProvider;
      await linkWithPopup(currentUser, provider);
      
      // Check if user document exists
      const userDocRef = doc(db, "users", currentUser.uid);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        const baseName = currentUser.displayName || currentUser.email?.split("@")[0] || "player";
        const finalUsername = await createProfileForUser(currentUser.uid, currentUser.email, baseName, false, currentUser.photoURL || undefined);
        await updateProfile(currentUser, { displayName: finalUsername, photoURL: currentUser.photoURL || undefined });
        setUsername(finalUsername);
        setPhotoURL(currentUser.photoURL || null);
      } else {
        const uData = userDoc.data();
        setUsername(uData.username || currentUser.displayName || "Giocatore");
        setPhotoURL(uData.photoURL || currentUser.photoURL || null);
      }
    }
    
    setIsRegisteredUser(true);
  }

  async function updatePhotoURL(url: string) {
    if (!auth.currentUser) throw new Error("Utente non loggato");
    const userDocRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userDocRef, { photoURL: url });
    await updateProfile(auth.currentUser, { photoURL: url });
    setPhotoURL(url);
  }

  async function logout() {
    await signOut(auth);
    setUser(null);
    setUsername(null);
    setPhotoURL(null);
    setIsRegisteredUser(false);
  }

  const value: AuthContextValue = {
    user,
    loading,
    isRegisteredUser,
    username,
    photoURL,
    login,
    registerWithEmail,
    loginWithEmail,
    signInWithGoogle,
    linkGuestToRegistered,
    logout,
    updatePhotoURL
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve essere usato dentro un AuthProvider");
  }
  return ctx;
}
