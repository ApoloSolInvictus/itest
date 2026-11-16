import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let adminApp = null;

function getAdminApp() {
  if (adminApp) return adminApp;
  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    const error = new Error("Firebase Admin is not configured on this deployment.");
    error.status = 503;
    throw error;
  }

  let credentials;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch {
    const error = new Error("Firebase Admin credentials are not valid JSON.");
    error.status = 503;
    throw error;
  }

  const existing = getApps().find((app) => app.name === "itest-admin");
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || credentials.project_id;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
  const options = { credential: cert(credentials), projectId };
  if (storageBucket) options.storageBucket = storageBucket;
  adminApp = existing || initializeApp(options, "itest-admin");
  return adminApp;
}

export function getAdminServices() {
  const app = getAdminApp();
  return { db: getFirestore(app), bucket: getStorage(app).bucket() };
}
