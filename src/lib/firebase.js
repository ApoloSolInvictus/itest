import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const firebaseConfigured = Object.values(config).every(Boolean);

let firebaseApp = null;
let auth = null;
let db = null;
let storage = null;

if (firebaseConfigured) {
  try {
    firebaseApp = initializeApp(config);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    storage = getStorage(firebaseApp);
  } catch (error) {
    console.error(
      "Firebase could not initialize. iTest will open in demo mode.",
      error?.code || "initialization-failed"
    );
    firebaseApp = null;
    auth = null;
    db = null;
    storage = null;
  }
}

export { firebaseApp, auth, db, storage };
export const firebaseReady = Boolean(firebaseApp && auth && db && storage);
