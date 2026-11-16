import { getAdminServices } from "../server/admin.js";
import { requireUser } from "../server/auth.js";

const PROFILE_TYPES = new Set(["student", "educator", "employer"]);

function cleanText(value, maximum = 100) {
  return String(value || "").trim().slice(0, maximum);
}

function claimedProfile(user) {
  if (user.employer) return "employer";
  if (user.educator) return "educator";
  return "";
}

function sendError(response, error) {
  const status = Number.isInteger(error.status) ? error.status : 503;
  return response.status(status).json({ error: error.message || "The iTest profile could not be saved." });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Use GET or POST for this endpoint." });
  }

  try {
    const user = await requireUser(request);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const requestedProfile = request.method === "POST" ? String(body.profileType || "") : "";
    if (request.method === "POST" && !PROFILE_TYPES.has(requestedProfile)) {
      return response.status(400).json({ error: "Choose a student, educator, or hiring profile." });
    }

    const { db } = getAdminServices();
    const profileRef = db.collection("users").doc(user.uid);
    const legacyRole = claimedProfile(user);
    let profileType = "";
    let displayName = "";
    let roleLocked = false;
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(profileRef);
      const savedProfile = String(existing.get("profileType") || "");
      profileType = PROFILE_TYPES.has(savedProfile) ? savedProfile : legacyRole || requestedProfile || "";
      if (!profileType) return;

      displayName = cleanText(body.displayName, 100)
        || cleanText(existing.get("displayName"), 100)
        || cleanText(user.name, 100)
        || user.email.split("@")[0]
        || "iTest member";
      roleLocked = PROFILE_TYPES.has(savedProfile) || Boolean(legacyRole);
      const now = Date.now();
      transaction.set(profileRef, {
        uid: user.uid,
        email: user.email.toLowerCase(),
        displayName,
        profileType,
        ...(existing.get("createdAt") ? {} : { createdAt: now }),
        updatedAt: now
      }, { merge: true });
    });

    if (!profileType) return response.status(200).json({ profile: null, needsProfileType: true });

    return response.status(200).json({
      profile: { type: profileType, displayName, email: user.email.toLowerCase() },
      roleLocked
    });
  } catch (error) {
    return sendError(response, error);
  }
}
