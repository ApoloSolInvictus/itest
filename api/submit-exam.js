import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "../server/admin.js";
import { consumePublicQuota } from "../server/auth.js";

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeAnswer(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function grade(questions, submittedAnswers) {
  const totalPoints = questions.reduce((sum, question) => sum + (Number(question.points) || 1), 0);
  const earned = questions.reduce((sum, question) => {
    const submitted = normalizeAnswer(submittedAnswers[question.id]);
    const expected = normalizeAnswer(question.answer);
    return sum + (submitted && expected && submitted === expected ? Number(question.points) || 1 : 0);
  }, 0);
  return {
    earned,
    totalPoints,
    score: Math.max(0, Math.min(100, Math.round((earned / Math.max(totalPoints, 1)) * 100)))
  };
}

function getShareId(request, body) {
  if (typeof body.shareId === "string") return body.shareId;
  const host = request.headers?.host || "itest.wstudio3d.com";
  try { return new URL(request.url, `https://${host}`).searchParams.get("shareId") || ""; }
  catch { return ""; }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Use POST for this endpoint." });
  }

  const body = request.body && typeof request.body === "object" ? request.body : {};
  const shareId = getShareId(request, body);
  const sessionToken = cleanText(body.sessionToken, 100);
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(shareId)) {
    return response.status(404).json({ error: "This exam link is not valid." });
  }
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(sessionToken)) {
    return response.status(403).json({ error: "Begin this exam before submitting your answers." });
  }
  try {
    consumePublicQuota(request, shareId);
    const enteredName = cleanText(body.name, 100);
    const email = cleanText(body.email, 254).toLowerCase();
    if (!enteredName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: "Enter your name and a valid email address." });
    }

    const submitted = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
    const cleanAnswers = Object.fromEntries(Object.entries(submitted).slice(0, 30).map(([key, value]) => [
      String(key).slice(0, 100), cleanText(value, 2000)
    ]));
    const { db } = getAdminServices();
    const publicRef = db.collection("publicExams").doc(shareId);
    const publicSnapshot = await publicRef.get();
    if (!publicSnapshot.exists || publicSnapshot.data().active !== true) {
      return response.status(404).json({ error: "This exam link is no longer available." });
    }

    const publicData = publicSnapshot.data();
    const assignmentRef = db.collection("users").doc(publicData.ownerUid)
      .collection("assignments").doc(publicData.assignmentId);
    const questions = Array.isArray(publicData.questions) ? publicData.questions.slice(0, 30) : [];
    const privateSnapshot = await assignmentRef.get();
    if (!privateSnapshot.exists || privateSnapshot.data().active !== true) {
      return response.status(404).json({ error: "This exam link is no longer available." });
    }
    const privateAssignment = privateSnapshot.data();
    const invitees = Array.isArray(privateAssignment.recipients) ? privateAssignment.recipients : [];
    const invitee = invitees.find((student) => String(student?.email || "").trim().toLowerCase() === email);
    if (!invitee) {
      return response.status(403).json({ error: "This exam link was sent to a different email address." });
    }
    if (normalizeName(enteredName) !== normalizeName(invitee.name)) {
      return response.status(403).json({ error: "Use the name saved on your educator’s student list for this email address." });
    }
    const name = cleanText(invitee.name, 100);
    const privateQuestions = Array.isArray(privateAssignment.questions) ? privateAssignment.questions : [];
    if (!questions.length || questions.length !== privateQuestions.length) {
      return response.status(409).json({ error: "This exam is not ready to accept submissions." });
    }
    const questionIds = new Set(questions.map((question) => question.id));
    for (const key of Object.keys(cleanAnswers)) {
      if (!questionIds.has(key)) delete cleanAnswers[key];
    }
    const result = grade(privateQuestions, cleanAnswers);
    const emailHash = createHash("sha256").update(email).digest("hex");
    const resultRef = assignmentRef.collection("results").doc(emailHash);
    const sessionRef = assignmentRef.collection("sessions").doc(emailHash);
    const studentResultRef = db.collection("users").doc(publicData.ownerUid).collection("studentResults")
      .doc(createHash("sha256").update(`${publicData.assignmentId}:${email}`).digest("hex"));
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists || sessionSnapshot.data().sessionToken !== sessionToken
      || sessionSnapshot.data().email !== email || sessionSnapshot.data().name !== name) {
      return response.status(403).json({ error: "This exam session could not be verified." });
    }
    if (Date.now() > Number(sessionSnapshot.data().deadlineAt || 0) + 30_000) {
      return response.status(410).json({ error: "The time for this exam has expired." });
    }
    const submittedAt = Date.now();
    const savedResult = {
      name,
      email,
      score: result.score,
      earned: result.earned,
      totalPoints: result.totalPoints,
      subject: cleanText(privateAssignment.subject, 120),
      examTitle: cleanText(privateAssignment.title, 160),
      assignmentId: publicData.assignmentId,
      answers: cleanAnswers,
      submittedAt
    };
    const workspaceResult = { ...savedResult };
    delete workspaceResult.answers;

    await db.runTransaction(async (transaction) => {
      const [existingResult, existingWorkspaceResult, currentAssignment, currentPublic, currentSession] = await Promise.all([
        transaction.get(resultRef),
        transaction.get(studentResultRef),
        transaction.get(assignmentRef),
        transaction.get(publicRef),
        transaction.get(sessionRef)
      ]);
      if (existingResult.exists || existingWorkspaceResult.exists) {
        const error = new Error("A result has already been submitted for this email address.");
        error.status = 409;
        throw error;
      }
      if (!currentAssignment.exists || currentAssignment.data().active !== true
        || !currentPublic.exists || currentPublic.data().active !== true) {
        const error = new Error("This exam link is no longer available.");
        error.status = 404;
        throw error;
      }
      const session = currentSession.exists ? currentSession.data() : null;
      if (!session || session.sessionToken !== sessionToken || session.email !== email || session.name !== name) {
        const error = new Error("This exam session could not be verified.");
        error.status = 403;
        throw error;
      }
      if (Date.now() > Number(session.deadlineAt || 0) + 30_000) {
        const error = new Error("The time for this exam has expired.");
        error.status = 410;
        throw error;
      }
      const allowedRecipients = Array.isArray(currentAssignment.data().recipients) ? currentAssignment.data().recipients : [];
      const currentInvitee = allowedRecipients.find((student) => String(student?.email || "").trim().toLowerCase() === email);
      if (!currentInvitee || normalizeName(currentInvitee.name) !== normalizeName(name)) {
        const error = new Error("This exam link was sent to a different email address.");
        error.status = 403;
        throw error;
      }
      transaction.create(resultRef, savedResult);
      transaction.create(studentResultRef, workspaceResult);
      transaction.update(sessionRef, { completedAt: submittedAt });
      transaction.update(assignmentRef, {
        totalSubmissions: FieldValue.increment(1),
        lastSubmissionAt: submittedAt,
        updatedAt: submittedAt
      });
    });

    return response.status(201).json({
      result: {
        score: result.score,
        earned: result.earned,
        totalPoints: result.totalPoints,
        feedback: "Your result has been sent to your educator."
      }
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    return response.status(status).json({
      error: status >= 500 && status !== 503
        ? "iTest could not save this result. Please try again."
        : error.message
    });
  }
}
