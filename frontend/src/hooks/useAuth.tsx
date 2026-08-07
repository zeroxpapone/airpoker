import { createContext, useContext, useEffect, useRef, useState } from "react";
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
import { collection, doc, getDoc, runTransaction, serverTimestamp, updateDoc, query, where, limit, getDocs, setDoc } from "firebase/firestore";

import { auth, db, googleProvider } from "../lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isRegisteredUser: boolean;
  // False until the signed-in user's Firestore profile has actually been read.
  // `isRegisteredUser: false` on its own is ambiguous — it means both "no profile"
  // and "haven't looked yet" — so anything that reacts to a *missing* profile must
  // check this first. See the comment on the state declaration.
  profileChecked: boolean;
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
  linkedProviderIds: string[];
  linkEmailPasswordToAccount: (email: string, password: string) => Promise<void>;
  linkGoogleToAccount: () => Promise<void>;
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
        bestHandRank: -1,
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
  // `loading` only ever goes true->false once, on the first auth resolution. A sign-in
  // that happens *later in the same session* (Google popup from the login page) therefore
  // renders with loading already false, unlike a page reload where <App> holds a spinner
  // until the profile read has finished. Without a separate "have we looked yet?" flag,
  // that difference is visible: onAuthStateChanged sets `user` synchronously but only
  // learns whether a profile exists one await later, so for that gap an already-registered
  // user looks exactly like a brand-new one.
  const [profileChecked, setProfileChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  // onAuthStateChanged below subscribes exactly once (empty dep array — resubscribing
  // a Firebase auth listener on every state change risks missing events during the
  // brief unsub/resub window). That means its callback closure would otherwise only
  // ever see isRegistering's value from the initial render (always false), making an
  // `if (!isRegistering)` check inside it permanently useless. Mirroring the state into
  // a ref that's always current sidesteps that without touching the subscription.
  const isRegisteringRef = useRef(isRegistering);
  useEffect(() => {
    isRegisteringRef.current = isRegistering;
  }, [isRegistering]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        if (!firebaseUser.isAnonymous) {
          // Batched with setUser above, so the first render that sees this user already
          // knows the profile is unverified. Re-armed on every sign-in because the flag
          // is per-user, not per-session: a previous user's "checked" verdict says
          // nothing about this one.
          setProfileChecked(false);
          // Fetch username & photoURL from Firestore
          try {
            const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
            if (userDoc.exists()) {
              const uData = userDoc.data();
              if (uData.username) {
                setUsername(uData.username);
                setIsRegisteredUser(true);
                // Sync Auth displayName with Firestore username if they differ
                if (firebaseUser.displayName !== uData.username) {
                  updateProfile(firebaseUser, { displayName: uData.username }).catch((err) => {
                    console.warn("Could not sync Auth displayName with Firestore username:", err);
                  });
                }
              } else if (!isRegisteringRef.current) {
                setUsername(null);
                setIsRegisteredUser(false);
              }
              setPhotoURL(uData.photoURL || firebaseUser.photoURL || null);
            } else {
              // If the user registration flow is currently active (profile doc not
              // written yet), don't reset state to "unregistered" out from under it.
              if (!isRegisteringRef.current) {
                setUsername(null);
                setPhotoURL(firebaseUser.photoURL || null);
                setIsRegisteredUser(false);
              }
            }
            // Reached only when the read actually resolved, so isRegisteredUser now
            // reflects the stored profile either way.
            setProfileChecked(true);
          } catch (e) {
            // A transient read failure (network blip, brief offline window) is not
            // reliable evidence the user isn't registered — leave existing state
            // alone rather than bouncing an already-registered user back to the
            // "choose a username" prompt. profileChecked deliberately stays false
            // for the same reason: an unanswered question must not read as "no".
            console.error("Errore nel recupero dello username:", e);
          }
        } else {
          setIsRegisteredUser(false);
          setUsername(firebaseUser.displayName);
          setPhotoURL(null);
          // Guests have no profile to check; nothing is pending.
          setProfileChecked(true);
        }
      } else {
        setUser(null);
        setIsRegisteredUser(false);
        setUsername(null);
        setPhotoURL(null);
        setProfileChecked(false);
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
      // Also keep guest doc's displayName in sync
      if (auth.currentUser.isAnonymous) {
        try {
          await setDoc(doc(db, "users", auth.currentUser.uid), { displayName: trimmed }, { merge: true });
        } catch (e) {
          console.warn("Could not update guest displayName in Firestore:", e);
        }
      }
      return;
    }

    const cred = await signInAnonymously(auth);
    if (cred.user) {
      await updateProfile(cred.user, { displayName: trimmed });
      setUser({ ...cred.user, displayName: trimmed } as User);
      setUsername(trimmed);
      // Create a minimal Firestore doc for the guest so userProfiles
      // resolution works for all players in TablePage
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          displayName: trimmed,
          isRegistered: false,
          createdAt: serverTimestamp(),
          photoURL: null,
          stats: {
            handsPlayed: 0,
            handsWon: 0,
            totalChipsWon: 0,
            totalChipsLost: 0,
            netProfit: 0,
            sessionsPlayed: 0,
            timePlayedSeconds: 0,
            bestHandName: "",
            bestHandRank: -1
          }
        }, { merge: true });
      } catch (e) {
        console.warn("Could not create guest Firestore doc:", e);
      }
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
      setProfileChecked(true);
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
    setProfileChecked(true);
  }

  async function signInWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider);
    const u = cred.user;

    // Check if user document already exists in Firestore
    const userDocRef = doc(db, "users", u.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists() || !userDoc.data()?.username) {
      // Don't auto-create username from Google details, force user to select a username
      setUsername(null);
      setPhotoURL(u.photoURL || null);
      setIsRegisteredUser(false);
    } else {
      const uData = userDoc.data();
      const dbUsername = uData.username || null;
      if (dbUsername && u.displayName !== dbUsername) {
        await updateProfile(u, { displayName: dbUsername });
      }
      setUsername(dbUsername);
      setPhotoURL(uData.photoURL || u.photoURL || null);
      setIsRegisteredUser(!!dbUsername);
    }

    // Both branches above read the profile doc, so the verdict is settled either way.
    // This also re-closes the window that onAuthStateChanged opened when the popup
    // resolved: it fires the moment sign-in completes and races this function.
    setProfileChecked(true);
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
        // Don't auto-create username from Google details, force user to select a username
        setUsername(null);
        setPhotoURL(currentUser.photoURL || null);
        setIsRegisteredUser(false);
      } else {
        const uData = userDoc.data();
        const dbUsername = uData.username || null;
        if (dbUsername && currentUser.displayName !== dbUsername) {
          await updateProfile(currentUser, { displayName: dbUsername });
        }
        setUsername(dbUsername);
        setPhotoURL(uData.photoURL || currentUser.photoURL || null);
        setIsRegisteredUser(!!dbUsername);
      }
    }
    
    setIsRegisteredUser(true);
    setProfileChecked(true);
  }

  // Firebase's User object is mutable — linkWithCredential/linkWithPopup update
  // auth.currentUser in place rather than returning a new object, so calling
  // setUser(auth.currentUser) with the same reference wouldn't reliably trigger a
  // re-render. Tracking linked provider IDs as their own plain-array state avoids
  // relying on object-identity change detection for this.
  const [linkedProviderIds, setLinkedProviderIds] = useState<string[]>([]);
  useEffect(() => {
    setLinkedProviderIds(user ? user.providerData.map((p) => p.providerId) : []);
  }, [user]);

  // Adds an email/password login method to the CURRENT, already-registered account
  // (as opposed to linkGuestToRegistered, which converts a fresh anonymous guest
  // into a registered account and picks a username in the same step). This never
  // touches the existing username/profile — it only adds a second way to sign in.
  async function linkEmailPasswordToAccount(email: string, password: string) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Utente non autenticato.");
    if (currentUser.isAnonymous) {
      throw new Error("Devi prima registrarti per collegare un metodo di accesso.");
    }
    if (!email.trim() || !password) {
      throw new Error("Email e password sono obbligatorie.");
    }

    const credential = EmailAuthProvider.credential(email.trim(), password);
    await linkWithCredential(currentUser, credential);
    setLinkedProviderIds(currentUser.providerData.map((p) => p.providerId));
  }

  // Adds Google as a login method to the CURRENT, already-registered account.
  async function linkGoogleToAccount() {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Utente non autenticato.");
    if (currentUser.isAnonymous) {
      throw new Error("Devi prima registrarti per collegare un metodo di accesso.");
    }

    await linkWithPopup(currentUser, googleProvider);
    setLinkedProviderIds(currentUser.providerData.map((p) => p.providerId));
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
    setProfileChecked(false);
  }

  async function claimUsername(desiredUsername: string) {
    if (!auth.currentUser) throw new Error("Utente non autenticato.");
    const pUrl = auth.currentUser.photoURL || undefined;
    const finalUsername = await createProfileForUser(auth.currentUser.uid, auth.currentUser.email, desiredUsername, true, pUrl);
    await updateProfile(auth.currentUser, { displayName: finalUsername, photoURL: pUrl });
    setUsername(finalUsername);
    setPhotoURL(pUrl || null);
    setIsRegisteredUser(true);
    setProfileChecked(true);
  }

  const value: AuthContextValue = {
    user,
    loading,
    isRegisteredUser,
    profileChecked,
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
    isRegistering,
    linkedProviderIds,
    linkEmailPasswordToAccount,
    linkGoogleToAccount
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
