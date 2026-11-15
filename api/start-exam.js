import { createHash, randomBytes } from "node:crypto";
import { getAdminServices } from "../server/admin.js";
import { consumePublicQuota } from "../server/auth.js";

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function readShareId(request, body) {
  if (typeof body.shareId === "string") return body.shareId;
  const host = request.headers?.host || "itest.wstudio3d.com";
  try { return new URL(request.url, `https://${host}`).searchParams.get("shareId") || ""; }
  catch { return ""; }
}

function findInvitee(assignment, email) {
  if (!Array.isArray(assignment.recipients)) return null;
  return assignment.recipients.find((student) => String(student?.email || "").trim().toLowerCase() === email) || null;
}

function normalizeName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Use POST for this endpoint." });
  }

  const body = request.body && typeof request.body === "object" ? request.body : {};
  const shareId = readShareId(request, body);
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(shareId)) {
    return response.status(404).json({ error: "This exam link is not valid." });
  }

  try {
    consumePublicQuota(request, shareId);
    const name = cleanText(body.name, 100);
    const email = cleanText(body.email, 254).toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: "Enter your name and a valid email address." });
    }

    const { db } = getAdminServices();
    const publicRef = db.collection("publicExams").doc(shareId);
    const publicSnapshot = await publicRef.get();
    if (!publicSnapshot.exists || publicSnapshot.data().active !== true) {
      return response.status(404).json({ error: "This exam link is no longer available." });
    }
    const publicData = publicSnapshot.data();
    const assignmentRef = db.collection("users").doc(publicData.ownerUid)
      .collection("assignments").doc(publicData.assignmentId);
    const assignmentSnapshot = await assignmentRef.get();
    if (!assignmentSnapshot.exists || assignmentSnapshot.data().active !== true) {
      return response.status(404).json({ error: "This exam link is no longer available." });
    }
    const invitee = findInvitee(assignmentSnapshot.data(), email);
    if (!invitee) {
      return response.status(403).json({ error: "This exam link was sent to a different email address." });
    }
    if (normalizeName(name) !== normalizeName(invitee.name)) {
      return response.status(403).json({ error: "Use the name saved on your educator’s student list for this email address." });
    }
    const rosterName = cleanText(invitee.name, 100);

    const emailHash = createHash("sha256").update(email).digest("hex");
    const sessionRef = assignmentRef.collection("sessions").doc(emailHash);
    const resultRef = assignmentRef.collection("results").doc(emailHash);
    let activeSession;

    await db.runTransaction(async (transaction) => {
      const [currentPublic, currentAssignment, sessionSnapshot, resultSnapshot] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(assignmentRef),
        transaction.get(sessionRef),
        transaction.get(resultRef)
      ]);
      if (!currentPublic.exists || currentPublic.data().active !== true
        || !currentAssignment.exists || currentAssignment.data().active !== true) {
        const error = new Error("This exam link is no longer available.");
        error.status = 404;
        throw error;
      }
      const currentInvitee = findInvitee(currentAssignment.data(), email);
      if (!currentInvitee) {
        const error = new Error("This exam link was sent to a different email address.");
        error.status = 403;
        throw error;
      }
      if (normalizeName(rosterName) !== normalizeName(currentInvitee.name)) {
        const error = new Error("This student list changed. Ask your educator for an updated exam link.");
        error.status = 409;
        throw error;
      }
      if (resultSnapshot.exists) {
        const error = new Error("A result has already been submitted for this email address.");
        error.status = 409;
        throw error;
      }
      if (sessionSnapshot.exists) {
        const saved = sessionSnapshot.data();
        if (saved.name !== rosterName) {
          const error = new Error("Use the same name you entered when you began this exam.");
          error.status = 409;
          throw error;
        }
        if (Date.now() > Number(saved.deadlineAt || 0)) {
          const error = new Error("The time for this exam has expired.");
          error.status = 410;
          throw error;
        }
        activeSession = saved;
        return;
      }

      const startedAt = Date.now();
      const durationMinutes = Math.max(1, Math.min(180, Number(currentAssignment.data().durationMinutes) || 20));
      activeSession = {
        name: rosterName,
        email,
        sessionToken: randomBytes(32).toString("base64url"),
        startedAt,
        deadlineAt: startedAt + durationMinutes * 60_000
      };
      transaction.create(sessionRef, activeSession);
    });

    return response.status(200).json({
      sessionToken: activeSession.sessionToken,
      name: activeSession.name,
      startedAt: activeSession.startedAt,
      deadlineAt: activeSession.deadlineAt,
      remainingSeconds: Math.max(0, Math.ceil((activeSession.deadlineAt - Date.now()) / 1000))
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 503;
    return response.status(status).json({
      error: status >= 500 && status !== 503
        ? "iTest could not start this exam. Please try again."
        : error.message
    });
  }
}
