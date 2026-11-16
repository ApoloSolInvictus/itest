import { importX509, jwtVerify } from "jose";

const FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const usage = new Map();
let certificateCache = { values: null, expiresAt: 0 };

async function loadFirebaseCertificates(force = false) {
  if (!force && certificateCache.values && certificateCache.expiresAt > Date.now()) return certificateCache.values;
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw new Error("Could not load Firebase signing keys.");
  const values = await response.json();
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1] || 3600);
  certificateCache = { values, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return values;
}

async function getFirebaseSigningKey(header) {
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid Firebase token header.");
  let certificates = await loadFirebaseCertificates();
  if (!certificates[header.kid]) certificates = await loadFirebaseCertificates(true);
  const certificate = certificates[header.kid];
  if (!certificate) throw new Error("Unknown Firebase signing key.");
  return importX509(certificate, "RS256");
}

export async function requireUser(request) {
  const header = request.headers?.authorization || request.headers?.Authorization || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.length > 12000) {
    const error = new Error("Sign in to continue.");
    error.status = 401;
    throw error;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) {
    const error = new Error("Firebase server authentication is not configured.");
    error.status = 503;
    throw error;
  }

  try {
    const { payload } = await jwtVerify(token, getFirebaseSigningKey, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`
    });
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.sub !== "string" || !payload.sub
      || typeof payload.iat !== "number" || payload.iat > now + 60
      || typeof payload.auth_time !== "number" || payload.auth_time > now + 60) {
      throw new Error("Invalid Firebase token claims.");
    }
    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      emailVerified: payload.email_verified === true,
      educator: payload.educator === true,
      employer: payload.employer === true,
      workspaceType: payload.employer === true ? "employer" : "educator"
    };
  } catch {
    const error = new Error("Your session has expired. Sign in again.");
    error.status = 401;
    throw error;
  }
}

export async function requireVerifiedUser(request) {
  const user = await requireUser(request);
  if (!user.email || !user.emailVerified) {
    const error = new Error("Verify the email address invited to this exam, then sign in again.");
    error.status = 403;
    throw error;
  }
  return user;
}

export async function requireEducator(request) {
  const user = await requireUser(request);
  let profileType = user.employer ? "employer" : user.educator ? "educator" : "";
  if (!profileType) {
    const { getAdminServices } = await import("./admin.js");
    const { db } = getAdminServices();
    const profile = await db.collection("users").doc(user.uid).get();
    profileType = profile.get("profileType") || "";
  }
  if (!["educator", "employer"].includes(profileType)) {
    const error = new Error("This workspace is available to educator and hiring profiles only.");
    error.status = 403;
    throw error;
  }
  return {
    ...user,
    educator: profileType === "educator",
    employer: profileType === "employer",
    workspaceType: profileType
  };
}

export function consumeUserQuota(uid, action) {
  const limits = {
    "generate-exam": 10,
    study: 35,
    grade: 20,
    "extract-doc": 20,
    "educator-write": 100,
    "educator-email": 100
  };
  const limit = limits[action];
  if (!limit) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${uid}:${action}`;
  const used = usage.get(key) || 0;
  if (used >= limit) {
    const error = new Error("You’ve reached today’s request limit. Please try again tomorrow.");
    error.status = 429;
    throw error;
  }
  usage.set(key, used + 1);
  if (usage.size > 25000) {
    for (const savedKey of usage.keys()) {
      usage.delete(savedKey);
      if (usage.size <= 20000) break;
    }
  }
}

const publicUsage = new Map();

export function consumePublicQuota(request, shareId) {
  const forwardedFor = request.headers?.["x-forwarded-for"] || request.headers?.["X-Forwarded-For"] || "";
  const ip = String(forwardedFor).split(",")[0].trim().slice(0, 80) || "unknown";
  const window = Math.floor(Date.now() / (15 * 60 * 1000));
  const key = `${window}:${ip}:${shareId}`;
  const used = publicUsage.get(key) || 0;
  if (used >= 100) {
    const error = new Error("Too many attempts. Please wait and try again.");
    error.status = 429;
    throw error;
  }
  publicUsage.set(key, used + 1);
  if (publicUsage.size > 25000) {
    for (const savedKey of publicUsage.keys()) {
      publicUsage.delete(savedKey);
      if (publicUsage.size <= 20000) break;
    }
  }
}
