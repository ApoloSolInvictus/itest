import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "../server/admin.js";
import { consumePublicQuota, requireVerifiedUser } from "../server/auth.js";

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

function readShareId(request, body) {
  if (typeof body.shareId === "string") return body.shareId;
  const host = request.headers?.host || "itest.wstudio3d.com";
  try { return new URL(request.url, `https://${host}`).searchParams.get("shareId") || ""; }
  catch { return ""; }
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
      ? "iTest could not save this result. Please try again."
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
    const sessionToken = cleanText(body.sessionToken, 100);
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(shareId)) {
      return response.status(404).json({ error: "This exam link is not valid." });
    }
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(sessionToken)) {
      return response.status(403).json({ error: "Begin this exam before submitting your answers." });
    }

    consumePublicQuota(request, shareId);
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
    const ownerUid = String(publicData.ownerUid || "");
    const assignmentId = String(publicData.assignmentId || "");
    if (!ownerUid || !assignmentId) return response.status(404).json({ error: "This exam link is not valid." });
    const assignmentRef = db.collection("users").doc(ownerUid).collection("assignments").doc(assignmentId);
    const enrollmentRef = assignmentRef.collection("students").doc(user.uid);
    const sessionRef = assignmentRef.collection("sessions").doc(user.uid);
    const studentWorkspaceId = assignmentWorkspaceId(ownerUid, assignmentId);
    const studentAssignmentRef = db.collection("users").doc(user.uid)
      .collection("assignedExams").doc(studentWorkspaceId);

    const initialSession = await sessionRef.get();
    if (!initialSession.exists) return response.status(403).json({ error: "Begin this exam before submitting your answers." });
    const attemptNumber = Math.max(1, Number(initialSession.data().attemptNumber) || 1);
    const attemptId = String(attemptNumber).padStart(6, "0");
    const resultRef = assignmentRef.collection("results").doc(`${user.uid}_${attemptId}`);
    const studentResultRef = db.collection("users").doc(ownerUid).collection("studentResults")
      .doc(createHash("sha256").update(`${assignmentId}:${user.uid}:${attemptNumber}`).digest("hex"));
    const studentAttemptRef = studentAssignmentRef.collection("attempts").doc(attemptId);

    let result;
    let passed = false;
    let passingScore = 70;
    let studentName = "Student";
    let assignmentTitle = "Exam";
    let subject = "General study";
    let teacherName = "Your educator";

    await db.runTransaction(async (transaction) => {
      const [currentPublic, assignmentSnapshot, enrollmentSnapshot, sessionSnapshot,
        previousResult, previousStudentResult, studentAssignmentSnapshot, previousAttempt] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(assignmentRef),
        transaction.get(enrollmentRef),
        transaction.get(sessionRef),
        transaction.get(resultRef),
        transaction.get(studentResultRef),
        transaction.get(studentAssignmentRef),
        transaction.get(studentAttemptRef)
      ]);
      if (previousResult.exists || previousStudentResult.exists || previousAttempt.exists) {
        const error = new Error("This attempt has already been submitted.");
        error.status = 409;
        throw error;
      }
      if (!currentPublic.exists || currentPublic.data().active !== true
        || !assignmentSnapshot.exists || assignmentSnapshot.data().active !== true) {
        const error = new Error("This exam link is no longer available.");
        error.status = 404;
        throw error;
      }
      if (!enrollmentSnapshot.exists || !studentAssignmentSnapshot.exists
        || studentAssignmentSnapshot.data().active !== true) {
        const error = new Error("Open your invitation before submitting this exam.");
        error.status = 403;
        throw error;
      }
      const assignment = assignmentSnapshot.data();
      const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
      const email = normalizeEmail(user.email);
      const invitee = Array.isArray(assignment.recipients)
        ? assignment.recipients.find((student) => normalizeEmail(student?.email) === email)
        : null;
      if (!invitee || normalizeEmail(enrollmentSnapshot.data().email) !== email) {
        const error = new Error("Sign in with the verified iTest account invited to this exam.");
        error.status = 403;
        throw error;
      }
      if (!session || session.sessionToken !== sessionToken || session.studentUid !== user.uid
        || normalizeEmail(session.email) !== email || session.completedAt) {
        const error = new Error("This exam session could not be verified.");
        error.status = 403;
        throw error;
      }
      if (Date.now() > Number(session.deadlineAt || 0) + 30_000) {
        const error = new Error("The time for this exam has expired.");
        error.status = 410;
        throw error;
      }
      const questionIds = new Set(Array.isArray(session.questionIds) ? session.questionIds : []);
      const questions = (Array.isArray(assignment.questions) ? assignment.questions : [])
        .filter((question) => questionIds.has(question.id));
      if (!questions.length || questions.length !== questionIds.size) {
        const error = new Error("This exam attempt could not be verified.");
        error.status = 409;
        throw error;
      }
      for (const key of Object.keys(cleanAnswers)) {
        if (!questionIds.has(key)) delete cleanAnswers[key];
      }
      result = grade(questions, cleanAnswers);
      const rawPassingScore = Number(assignment.passingScore);
      passingScore = Number.isFinite(rawPassingScore)
        ? Math.max(0, Math.min(100, rawPassingScore))
        : 70;
      studentName = String(invitee.name || enrollmentSnapshot.data().name || "Student").trim().slice(0, 100);
      assignmentTitle = cleanText(assignment.title, 160) || "Exam";
      subject = cleanText(assignment.subject, 120) || "General study";
      teacherName = cleanText(assignment.ownerName, 100) || "Your educator";
      const enrollment = enrollmentSnapshot.data();
      const attemptCount = Math.max(0, Number(enrollment.attemptCount) || 0) + 1;
      if (attemptNumber !== attemptCount) {
        const error = new Error("Your attempt history changed. Start the exam again.");
        error.status = 409;
        throw error;
      }
      const alreadyPassed = enrollment.passed === true;
      passed = alreadyPassed || result.score >= passingScore;
      const bestScore = Math.max(Number(enrollment.bestScore) || 0, result.score);
      const submittedAt = Date.now();
      const teacherResult = {
        studentUid: user.uid,
        studentWorkspaceId,
        name: studentName,
        email,
        score: result.score,
        earned: result.earned,
        totalPoints: result.totalPoints,
        passingScore,
        passed,
        attemptNumber,
        subject,
        examTitle: assignmentTitle,
        assignmentId,
        workspaceKind: assignment.workspaceKind === "employer" ? "employer" : "educator",
        answers: cleanAnswers,
        submittedAt
      };
      const studentResult = { ...teacherResult };
      delete studentResult.answers;
      delete studentResult.studentUid;

      transaction.create(resultRef, teacherResult);
      transaction.create(studentResultRef, studentResult);
      transaction.create(studentAttemptRef, {
        attemptNumber,
        score: result.score,
        earned: result.earned,
        totalPoints: result.totalPoints,
        passingScore,
        passed,
        examTitle: assignmentTitle,
        subject,
        teacherName,
        submittedAt
      });
      transaction.update(sessionRef, { completedAt: submittedAt, score: result.score, passed });
      transaction.update(enrollmentRef, {
        attemptCount,
        bestScore,
        lastScore: result.score,
        passed,
        lastAttemptAt: submittedAt,
        updatedAt: submittedAt
      });
      transaction.update(studentAssignmentRef, {
        attemptCount,
        bestScore,
        lastScore: result.score,
        passed,
        lastAttemptAt: submittedAt,
        updatedAt: submittedAt
      });
      transaction.update(assignmentRef, {
        totalSubmissions: FieldValue.increment(1),
        lastSubmissionAt: submittedAt,
        updatedAt: submittedAt
      });
    });

    return response.status(201).json({
      result: {
        ...result,
        attemptNumber,
        passingScore,
        passed,
        canRetry: !passed,
        feedback: passed
          ? "You reached the passing score. Your educator can review your result."
          : "Keep practicing and try again when you are ready."
      }
    });
  } catch (error) {
    return sendError(response, error);
  }
}
