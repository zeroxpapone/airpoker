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
import { collection, doc, getDoc, runTransaction, serverTimestamp, updateDoc, query, where, limit, getDocs } from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isRegisteredUser: boolean;
  username: string | null;
  photoURL: string | null;
  login: (displayName: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, username: string) => Promise<void>;
  loginWithEmail: (emailOrUsername: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  linkGuestToRegistered: (email: string, password: string, username: string, type: "email" | "google") => Promise<void>;
  logout: () => Promise<void>;
  updatePhotoURL: (url: string) => Promise<void>;
  claimUsername: (username: string) => Promise<void>;
  isRegistering: boolean;
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

  // Check if username unique outside transaction since queries aren't allowed inside transactions
  const usersCol = collection(db, "users");
  const qUnique = query(usersCol, where("usernameLowercase", "==", usernameToClaim.toLowerCase()), limit(1));
  const snapUnique = await getDocs(qUnique);

  if (!snapUnique.empty) {
    if (forceUnique) {
      throw new Error("Questo nome utente è già stato registrato da un altro utente.");
    }
    // auto-fallback for Google login if already taken
    let attempts = 0;
    let foundUnique = false;
    while (!foundUnique && attempts < 10) {
      const candidate = cleanUsername + Math.floor(Math.random() * 1000);
      const qCand = query(usersCol, where("usernameLowercase", "==", candidate.toLowerCase()), limit(1));
      const snapCand = await getDocs(qCand);
      if (snapCand.empty) {
        usernameToClaim = candidate;
        foundUnique = true;
      }
      attempts++;
    }
    if (!foundUnique) {
      throw new Error("Impossibile generare un nome utente univoco. Riprova.");
    }
  }

  await runTransaction(db, async (transaction) => {
    // Create user profile doc
    const userDocRef = doc(db, "users", uid);
    transaction.set(userDocRef, {
      uid,
      username: usernameToClaim,
      usernameLowercase: usernameToClaim.toLowerCase(),
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
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        if (!firebaseUser.isAnonymous) {
          // Fetch username & photoURL from Firestore
          try {
            const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
            if (userDoc.exists()) {
              const uData = userDoc.data();
              if (uData.username) {
                setUsername(uData.username);
                setIsRegisteredUser(true);
              } else {
                setUsername(null);
                setIsRegisteredUser(false);
              }
              setPhotoURL(uData.photoURL || firebaseUser.photoURL || null);
            } else {
              // If the user registration flow is currently active,
              // don't reset states to false since we are writing Firestore now
              if (!isRegistering) {
                setUsername(null);
                setPhotoURL(firebaseUser.photoURL || null);
                setIsRegisteredUser(false);
              }
            }
          } catch (e) {
            console.error("Errore nel recupero dello username:", e);
            if (!isRegistering) {
              setUsername(null);
              setPhotoURL(firebaseUser.photoURL || null);
              setIsRegisteredUser(false);
            }
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

    try {
      setIsRegistering(true);
      // 1. Create firebase auth user
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const u = cred.user;

      // 2. Create firestore profile and reserve username
      const finalUsername = await createProfileForUser(u.uid, email, desiredUsername, true);
      // 3. Update auth profile displayName
      await updateProfile(u, { displayName: finalUsername });
      
      setUsername(finalUsername);
      setIsRegisteredUser(true);
      setPhotoURL(null);
      setUser(u);
    } catch (err) {
      setIsRegistering(false);
      throw err;
    } finally {
      // Small timeout to allow auth states to fully settle in components
      setTimeout(() => {
        setIsRegistering(false);
      }, 800);
    }
  }

  async function resolveLoginEmail(identifier: string) {
    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new Error("Email o username sono obbligatori.");
    }

    if (trimmed.includes("@")) {
      return trimmed;
    }

    const usernameKey = trimmed.toLowerCase();
    const usersQuery = query(collection(db, "users"), where("usernameLowercase", "==", usernameKey), limit(1));
    const usersSnap = await getDocs(usersQuery);
    if (!usersSnap.empty) {
      const userEmail = usersSnap.docs[0].data().email as string | undefined;
      if (userEmail) {
        return userEmail;
      }
    }

    throw new Error("Username non trovato.");
  }

  async function loginWithEmail(emailOrUsername: string, password: string) {
    if (!emailOrUsername.trim() || !password) {
      throw new Error("Email, username e password sono obbligatori.");
    }

    const loginEmail = await resolveLoginEmail(emailOrUsername);
    const cred = await signInWithEmailAndPassword(auth, loginEmail, password);
    setUser(cred.user);
    setIsRegisteredUser(true);
  }

  async function signInWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider);
    const u = cred.user;

    // Check if user document already exists in Firestore
    const userDocRef = doc(db, "users", u.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists() || !userDoc.data()?.username) {
      const baseName = (u.displayName || u.email?.split("@")[0] || "player").replace(/\s+/g, "");
      let canAutoCreate = false;
      if (baseName.length >= 3 && /^[a-zA-Z0-9_]+$/.test(baseName)) {
        const qUnique = query(collection(db, "users"), where("usernameLowercase", "==", baseName.toLowerCase()), limit(1));
        const snapUnique = await getDocs(qUnique);
        if (snapUnique.empty) {
          canAutoCreate = true;
        }
      }

      if (canAutoCreate) {
        const finalUsername = await createProfileForUser(u.uid, u.email, baseName, true, u.photoURL || undefined);
        await updateProfile(u, { displayName: finalUsername, photoURL: u.photoURL || undefined });
        setUsername(finalUsername);
        setPhotoURL(u.photoURL || null);
        setIsRegisteredUser(true);
      } else {
        setUsername(null);
        setPhotoURL(u.photoURL || null);
        setIsRegisteredUser(false);
      }
    } else {
      const uData = userDoc.data();
      setUsername(uData.username || null);
      setPhotoURL(uData.photoURL || u.photoURL || null);
      setIsRegisteredUser(!!uData.username);
    }

    setUser(u);
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

      // Check username uniqueness
      const usernameToClaim = desiredUsername.trim();
      const qUnique = query(collection(db, "users"), where("usernameLowercase", "==", usernameToClaim.toLowerCase()), limit(1));
      const snapUnique = await getDocs(qUnique);
      if (!snapUnique.empty) {
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
      if (!userDoc.exists() || !userDoc.data()?.username) {
        const baseName = (currentUser.displayName || currentUser.email?.split("@")[0] || "player").replace(/\s+/g, "");
        let canAutoCreate = false;
        if (baseName.length >= 3 && /^[a-zA-Z0-9_]+$/.test(baseName)) {
          const qUnique = query(collection(db, "users"), where("usernameLowercase", "==", baseName.toLowerCase()), limit(1));
          const snapUnique = await getDocs(qUnique);
          if (snapUnique.empty) {
            canAutoCreate = true;
          }
        }

        if (canAutoCreate) {
          const finalUsername = await createProfileForUser(currentUser.uid, currentUser.email, baseName, true, currentUser.photoURL || undefined);
          await updateProfile(currentUser, { displayName: finalUsername, photoURL: currentUser.photoURL || undefined });
          setUsername(finalUsername);
          setPhotoURL(currentUser.photoURL || null);
          setIsRegisteredUser(true);
        } else {
          setUsername(null);
          setPhotoURL(currentUser.photoURL || null);
          setIsRegisteredUser(false);
        }
      } else {
        const uData = userDoc.data();
        setUsername(uData.username || null);
        setPhotoURL(uData.photoURL || currentUser.photoURL || null);
        setIsRegisteredUser(!!uData.username);
      }
    }
    
    setIsRegisteredUser(true);
  }

  async function updatePhotoURL(url: string) {
    if (!auth.currentUser) throw new Error("Utente non loggato");
    const userDocRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userDocRef, { photoURL: url });
    if (!url.startsWith("data:")) {
      await updateProfile(auth.currentUser, { photoURL: url });
    }
    setPhotoURL(url);
  }

  async function logout() {
    await signOut(auth);
    setUser(null);
    setUsername(null);
    setPhotoURL(null);
    setIsRegisteredUser(false);
  }

  async function claimUsername(desiredUsername: string) {
    if (!auth.currentUser) throw new Error("Utente non autenticato.");
    const pUrl = auth.currentUser.photoURL || undefined;
    const finalUsername = await createProfileForUser(auth.currentUser.uid, auth.currentUser.email, desiredUsername, true, pUrl);
    await updateProfile(auth.currentUser, { displayName: finalUsername, photoURL: pUrl });
    setUsername(finalUsername);
    setPhotoURL(pUrl || null);
    setIsRegisteredUser(true);
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
    updatePhotoURL,
    claimUsername,
    isRegistering
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
