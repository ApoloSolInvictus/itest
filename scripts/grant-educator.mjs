import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/grant-educator.mjs educator@example.com");
  process.exit(1);
}

const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const auth = getAuth(app);
const account = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(account.uid, { ...account.customClaims, educator: true });
console.log(`Educator access enabled for ${email}. Ask them to sign out and back in.`);
