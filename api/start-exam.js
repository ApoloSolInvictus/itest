import { randomBytes, randomInt } from "node:crypto";
import { getAdminServices } from "../server/admin.js";
import { consumePublicQuota, requireVerifiedUser } from "../server/auth.js";

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function readShareId(request, body) {
  if (typeof body.shareId === "string") return body.shareId;
  const host = request.headers?.host || "itest.wstudio3d.com";
  try { return new URL(request.url, `https://${host}`).searchParams.get("shareId") || ""; }
  catch { return ""; }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function publicQuestion(question, previousOptions = []) {
  let options = Array.isArray(question.options) ? shuffled(question.options) : [];
  if (options.length > 1 && JSON.stringify(options) === JSON.stringify(previousOptions)) {
    options = [...options.slice(1), options[0]];
  }
  return {
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    options,
    points: question.points
  };
}

function pickQuestions(questionBank, count, previousIds) {
  const previousSet = new Set(previousIds || []);
  let picked = shuffled(questionBank).slice(0, count);
  const hasDifferentSelection = (items) => items.some((question) => !previousSet.has(question.id));
  if (previousSet.size && questionBank.length > count && !hasDifferentSelection(picked)) {
    const replacement = shuffled(questionBank.filter((question) => !previousSet.has(question.id)))[0];
    if (replacement && picked.length) picked[randomInt(picked.length)] = replacement;
  }
  picked = shuffled(picked);
  const previousOrder = previousIds || [];
  if (picked.length > 1 && picked.map((question) => question.id).join("|") === previousOrder.join("|")) {
    picked = [...picked.slice(1), picked[0]];
  }
  return picked;
}

function sendError(response, error) {
  const status = Number.isInteger(error.status) ? error.status : 503;
  return response.status(status).json({
    error: status >= 500 && status !== 503
      ? "iTest could not start this exam. Please try again."
      : error.message
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Use POST for this endpoint." });
  }

  try {
    const user = await requireVerifiedUser(request);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const shareId = readShareId(request, body);
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(shareId)) {
      return response.status(404).json({ error: "This exam link is not valid." });
    }

    consumePublicQuota(request, shareId);
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
    const sessionRef = assignmentRef.collection("sessions").doc(user.uid);
    let activeSession;
    let studentName = "";
    let assignment;

    await db.runTransaction(async (transaction) => {
      const [currentPublic, assignmentSnapshot, enrollmentSnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(assignmentRef),
        transaction.get(enrollmentRef),
        transaction.get(sessionRef)
      ]);
      if (!currentPublic.exists || currentPublic.data().active !== true
        || !assignmentSnapshot.exists || assignmentSnapshot.data().active !== true) {
        const error = new Error("This exam link is no longer available.");
        error.status = 404;
        throw error;
      }
      assignment = assignmentSnapshot.data();
      const invitee = Array.isArray(assignment.recipients)
        ? assignment.recipients.find((student) => normalizeEmail(student?.email) === normalizeEmail(user.email))
        : null;
      if (!invitee || !enrollmentSnapshot.exists
        || normalizeEmail(enrollmentSnapshot.data().email) !== normalizeEmail(user.email)) {
        const error = new Error("Open the invitation with the verified iTest account that received it.");
        error.status = 403;
        throw error;
      }
      studentName = String(invitee.name || enrollmentSnapshot.data().name || user.name || "Student").trim().slice(0, 100);
      const progress = enrollmentSnapshot.data();
      if (progress.passed === true) {
        const error = new Error("You have already reached the passing score for this exam.");
        error.status = 409;
        throw error;
      }

      const now = Date.now();
      const savedSession = sessionSnapshot.exists ? sessionSnapshot.data() : null;
      if (savedSession && !savedSession.completedAt && now <= Number(savedSession.deadlineAt || 0)) {
        activeSession = savedSession;
        return;
      }

      const privateQuestions = Array.isArray(assignment.questions) ? assignment.questions : [];
      if (!privateQuestions.length) {
        const error = new Error("This exam does not contain any questions.");
        error.status = 409;
        throw error;
      }
      const desiredCount = Math.max(1, Math.min(
        privateQuestions.length,
        Number(assignment.questionCount) || privateQuestions.length
      ));
      const previousQuestionById = new Map((savedSession?.questions || []).map((question) => [question.id, question.options || []]));
      const selectedQuestions = pickQuestions(privateQuestions, desiredCount, savedSession?.questionIds);
      const attemptQuestions = selectedQuestions.map((question) => publicQuestion(question, previousQuestionById.get(question.id)));
      const durationMinutes = Math.max(1, Math.min(180, Number(assignment.durationMinutes) || 20));
      activeSession = {
        studentUid: user.uid,
        email: normalizeEmail(user.email),
        name: studentName,
        sessionToken: randomBytes(32).toString("base64url"),
        attemptNumber: Math.max(0, Number(progress.attemptCount) || 0) + 1,
        questionIds: attemptQuestions.map((question) => question.id),
        questions: attemptQuestions,
        startedAt: now,
        deadlineAt: now + durationMinutes * 60_000,
        completedAt: null
      };
      transaction.set(sessionRef, activeSession);
    });

    return response.status(200).json({
      sessionToken: activeSession.sessionToken,
      name: activeSession.name || studentName,
      attemptNumber: activeSession.attemptNumber,
      questions: activeSession.questions,
      startedAt: activeSession.startedAt,
      deadlineAt: activeSession.deadlineAt,
      remainingSeconds: Math.max(0, Math.ceil((activeSession.deadlineAt - Date.now()) / 1000)),
      exam: {
        title: assignment?.title || publicData.title,
        subject: assignment?.subject || publicData.subject,
        summary: assignment?.summary || publicData.summary || "",
        questionCount: activeSession.questions.length,
        questionBankCount: Number(assignment?.questionBankCount) || activeSession.questions.length,
        durationMinutes: Number(assignment?.durationMinutes) || Number(publicData.durationMinutes) || 20,
        passingScore: Number.isFinite(Number(assignment?.passingScore))
          ? Math.max(0, Math.min(100, Number(assignment.passingScore)))
          : 70
      }
    });
  } catch (error) {
    return sendError(response, error);
  }
}
