import { createHash } from "node:crypto";
import { getAdminServices } from "../server/admin.js";
import { requireVerifiedUser } from "../server/auth.js";

function readShareId(request) {
  const fromQuery = request.query?.shareId;
  if (typeof fromQuery === "string") return fromQuery;
  const host = request.headers?.host || "itest.wstudio3d.com";
  try { return new URL(request.url, `https://${host}`).searchParams.get("shareId") || ""; }
  catch { return ""; }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function assignmentWorkspaceId(ownerUid, assignmentId) {
  return createHash("sha256").update(`${ownerUid}:${assignmentId}`).digest("hex");
}

function sendError(response, error) {
  const status = Number.isInteger(error.status) ? error.status : 503;
  return response.status(status).json({
    error: status >= 500 && status !== 503
      ? "This exam could not be loaded right now. Please try again."
      : error.message
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Use GET for this endpoint." });
  }

  try {
    const user = await requireVerifiedUser(request);
    const shareId = readShareId(request);
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(shareId)) {
      return response.status(404).json({ error: "This exam link is not valid." });
    }

    const { db } = getAdminServices();
    const publicRef = db.collection("publicExams").doc(shareId);
    const publicSnapshot = await publicRef.get();
    if (!publicSnapshot.exists || publicSnapshot.data().active !== true) {
      return response.status(404).json({ error: "This exam link is no longer available." });
    }

    const publicData = publicSnapshot.data();
    const ownerUid = String(publicData.ownerUid || "");
    const assignmentId = String(publicData.assignmentId || "");
    if (!ownerUid || !assignmentId) return response.status(404).json({ error: "This exam link is not valid." });

    const assignmentRef = db.collection("users").doc(ownerUid).collection("assignments").doc(assignmentId);
    const enrollmentRef = assignmentRef.collection("students").doc(user.uid);
    const workspaceId = assignmentWorkspaceId(ownerUid, assignmentId);
    const studentAssignmentRef = db.collection("users").doc(user.uid)
      .collection("assignedExams").doc(workspaceId);
    const email = normalizeEmail(user.email);
    let linkedStudent;
    let progress;
    let passingScore = 70;

    await db.runTransaction(async (transaction) => {
      const [currentPublic, assignmentSnapshot, enrollmentSnapshot, studentAssignmentSnapshot] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(assignmentRef),
        transaction.get(enrollmentRef),
        transaction.get(studentAssignmentRef)
      ]);
      if (!currentPublic.exists || currentPublic.data().active !== true
        || !assignmentSnapshot.exists || assignmentSnapshot.data().active !== true) {
        const error = new Error("This exam link is no longer available.");
        error.status = 404;
        throw error;
      }

      const assignment = assignmentSnapshot.data();
      const invitee = Array.isArray(assignment.recipients)
        ? assignment.recipients.find((student) => normalizeEmail(student?.email) === email)
        : null;
      if (!invitee) {
        const error = new Error("Sign in with the verified iTest account invited to this exam.");
        error.status = 403;
        throw error;
      }

      linkedStudent = {
        uid: user.uid,
        name: String(invitee.name || user.name || email.split("@")[0]).trim().slice(0, 100),
        email
      };
      const existingProgress = enrollmentSnapshot.exists ? enrollmentSnapshot.data() : {};
      const existingWorkspace = studentAssignmentSnapshot.exists ? studentAssignmentSnapshot.data() : {};
      const attemptCount = Math.max(0, Number(existingProgress.attemptCount ?? existingWorkspace.attemptCount) || 0);
      const bestScore = Number.isFinite(Number(existingProgress.bestScore ?? existingWorkspace.bestScore))
        ? Number(existingProgress.bestScore ?? existingWorkspace.bestScore)
        : null;
      const passed = existingProgress.passed === true || existingWorkspace.passed === true;
      const rawPassingScore = Number(assignment.passingScore);
      passingScore = Number.isFinite(rawPassingScore) ? Math.max(0, Math.min(100, rawPassingScore)) : 70;
      progress = { attemptCount, bestScore, passed, lastScore: existingProgress.lastScore ?? existingWorkspace.lastScore ?? null };

      transaction.set(enrollmentRef, {
        studentUid: user.uid,
        name: linkedStudent.name,
        email,
        attemptCount,
        bestScore,
        lastScore: progress.lastScore,
        passed,
        updatedAt: Date.now()
      }, { merge: true });
      transaction.set(studentAssignmentRef, {
        ownerUid,
        assignmentId,
        shareId,
        title: assignment.title,
        subject: assignment.subject,
        summary: assignment.summary || "",
        teacherName: assignment.ownerName || "Your educator",
        workspaceKind: assignment.workspaceKind === "employer" ? "employer" : "educator",
        durationMinutes: Number(assignment.durationMinutes) || 20,
        questionCount: Number(assignment.questionCount) || (assignment.questions || []).length,
        questionBankCount: Number(assignment.questionBankCount) || (assignment.questions || []).length,
        passingScore,
        studentName: linkedStudent.name,
        studentEmail: email,
        active: true,
        assignedAt: Number(existingWorkspace.assignedAt) || Number(assignment.createdAt) || Date.now(),
        attemptCount,
        bestScore,
        lastScore: progress.lastScore,
        passed,
        lastAttemptAt: Number(existingProgress.lastAttemptAt ?? existingWorkspace.lastAttemptAt) || null,
        updatedAt: Date.now()
      }, { merge: true });
    });

    return response.status(200).json({
      exam: {
        title: publicData.title,
        subject: publicData.subject,
        summary: publicData.summary,
        ownerName: publicData.ownerName || "Your educator",
        workspaceKind: publicData.workspaceKind === "employer" ? "employer" : "educator",
        durationMinutes: publicData.durationMinutes,
        questionCount: publicData.questionCount,
        questionBankCount: publicData.questionBankCount || publicData.questionCount,
        passingScore,
        studentName: linkedStudent.name,
        attemptCount: progress.attemptCount,
        bestScore: progress.bestScore,
        passed: progress.passed
      }
    });
  } catch (error) {
    return sendError(response, error);
  }
}
