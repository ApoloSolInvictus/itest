import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/grant-employer.mjs hiring@example.com");
  process.exit(1);
}

const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const auth = getAuth(app);
const account = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(account.uid, { ...account.customClaims, employer: true });
console.log(`Hiring workspace access enabled for ${email}. Ask the user to sign out and back in.`);
