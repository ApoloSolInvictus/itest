import { createHash, randomBytes } from "node:crypto";
import { getAdminServices } from "../server/admin.js";
import { consumeUserQuota, requireEducator } from "../server/auth.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACTS = 1000;
const MAX_ASSIGNMENTS = 40;
const MAX_RESULTS = 100;

function sendError(response, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  return response.status(status).json({
    error: status >= 500 && status !== 503
      ? "iTest could not complete that request. Please try again."
      : error.message
  });
}

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function htmlEscape(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalizeStudents(input) {
  if (!Array.isArray(input) || input.length > MAX_CONTACTS) {
    const error = new Error(`A list can contain up to ${MAX_CONTACTS.toLocaleString()} students.`);
    error.status = 400;
    throw error;
  }
  const students = [];
  const seen = new Set();
  for (const entry of input) {
    const name = cleanText(entry?.name, 100);
    const email = cleanText(entry?.email, 254).toLowerCase();
    if (!name && !email) continue;
    if (!name || !EMAIL_PATTERN.test(email)) {
      const error = new Error("Each student needs a name and a valid email address.");
      error.status = 400;
      throw error;
    }
    if (!seen.has(email)) {
      students.push({ id: cleanText(entry?.id, 80) || randomBytes(9).toString("hex"), name, email });
      seen.add(email);
    }
  }
  if (!students.length) {
    const error = new Error("Add at least one student to this list.");
    error.status = 400;
    throw error;
  }
  return students;
}

function safeQuestions(exam) {
  if (!Array.isArray(exam.questions) || !exam.questions.length || exam.questions.length > 30) {
    const error = new Error("The selected exam must contain 1 to 30 questions.");
    error.status = 400;
    throw error;
  }
  const seenIds = new Set();
  return exam.questions.map((question, index) => {
    const baseId = cleanText(question.id, 100) || `q${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (seenIds.has(id)) id = `${baseId}-${suffix++}`;
    seenIds.add(id);

    const prompt = cleanText(question.prompt, 1800);
    const answer = cleanText(question.answer, 1000);
    const type = ["multiple_choice", "true_false", "short_answer"].includes(question.type) ? question.type : "short_answer";
    const options = Array.isArray(question.options) ? question.options.slice(0, 6).map((option) => cleanText(option, 300)).filter(Boolean) : [];
    if (!prompt || !answer || (type !== "short_answer" && options.length < 2)) {
      const error = new Error("Every assigned question needs a prompt, correct answer, and answer choices when applicable.");
      error.status = 400;
      throw error;
    }
    return {
      id,
      prompt,
      type,
      options,
      points: Math.max(1, Math.min(10, Number(question.points) || 1))
    };
  });
}

function getBaseUrl() {
  return String(process.env.APP_BASE_URL || "https://itest.wstudio3d.com").replace(/\/+$/, "");
}

async function sendInvitations({ assignment, students, teacherName, apiKey, fromEmail }) {
  if (!apiKey || !fromEmail) return { emailStatus: "not-configured", sentCount: 0 };
  const shareUrl = `${getBaseUrl()}/exam/${assignment.shareId}`;
  let sentCount = 0;
  for (let start = 0; start < students.length; start += 100) {
    const batch = students.slice(start, start + 100).map((student) => {
      const name = htmlEscape(student.name);
      const title = htmlEscape(assignment.title);
      const teacher = htmlEscape(teacherName || "Your educator");
      const hiring = assignment.workspaceKind === "employer";
      const reviewer = hiring ? "hiring team" : "educator";
      const subject = `${teacherName || "Your educator"} invited you to ${assignment.title}`.replace(/[\r\n]/g, " ").slice(0, 180);
      const text = `Hello ${student.name},\n\n${teacherName || (hiring ? "Your hiring team" : "Your educator")} has invited you to complete ${assignment.title}.\nSubject: ${assignment.subject}\nPassing score: ${assignment.passingScore}%\nTime allowed: ${assignment.durationMinutes} minutes\n\nOpen your assessment: ${shareUrl}\n\nSign in or create an iTest account with this exact email address. Verify the email before starting. You can retry until you reach the passing score. Your attempts will be saved in your iTest workspace and shared with the ${reviewer}.`;
      return {
        from: fromEmail,
        to: [student.email],
        subject,
        text,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171814;max-width:560px;margin:auto"><p>Hello ${name},</p><p>${teacher} has invited you to complete <strong>${title}</strong>.</p><p><strong>Subject:</strong> ${htmlEscape(assignment.subject)}<br><strong>Passing score:</strong> ${assignment.passingScore}%<br><strong>Time allowed:</strong> ${assignment.durationMinutes} minutes</p><p><a href="${shareUrl}" style="display:inline-block;background:#171814;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px">Open your assessment</a></p><p>Sign in or create an iTest account with this exact email address and verify it before starting. You can retry until you reach the passing score.</p><p style="color:#666;font-size:13px">Your attempts and results will appear in your iTest workspace and be shared with the ${reviewer}.</p></div>`
      };
    });
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("The email provider did not accept the invitation batch.");
      error.status = 502;
      error.sentCount = sentCount;
      throw error;
    }
    sentCount += Array.isArray(result.data) ? result.data.length : batch.length;
  }
  return { emailStatus: "sent", sentCount };
}

function readCursor(value) {
  if (!value) return null;
  const raw = String(value);
  const legacyParts = raw.split(":", 2);
  const isLegacyCursor = legacyParts.length === 2;
  const id = isLegacyCursor ? legacyParts[1] : raw;
  const timestamp = isLegacyCursor ? Number(legacyParts[0]) : null;
  if (!id || id.length > 150 || (isLegacyCursor && !Number.isFinite(timestamp))) {
    const error = new Error("That page cursor is not valid. Refresh and try again.");
    error.status = 400;
    throw error;
  }
  return { id, timestamp };
}

function nextCursor(snapshot) {
  return snapshot?.id || "";
}

async function loadWorkspace(db, uid, request) {
  const userRef = db.collection("users").doc(uid);
  const listId = cleanText(request.query?.listId, 100);
  if (listId) {
    const snapshot = await userRef.collection("mailingLists").doc(listId).get();
    return { list: snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null };
  }
  const cursor = readCursor(request.query?.cursor);
  const assignmentCollection = userRef.collection("assignments");
  let assignmentQuery = assignmentCollection.orderBy("createdAt", "desc");
  if (cursor) {
    const boundary = await assignmentCollection.doc(cursor.id).get();
    if (boundary.exists) assignmentQuery = assignmentQuery.startAfter(boundary);
    else if (cursor.timestamp !== null) assignmentQuery = assignmentQuery.startAfter(cursor.timestamp);
    else {
      const error = new Error("That page has changed. Refresh and try again.");
      error.status = 400;
      throw error;
    }
  }
  const [listSnapshot, assignmentSnapshot] = await Promise.all([
    userRef.collection("mailingLists").orderBy("updatedAt", "desc").get(),
    assignmentQuery.limit(MAX_ASSIGNMENTS + 1).get()
  ]);
  const page = assignmentSnapshot.docs.slice(0, MAX_ASSIGNMENTS);
  const assignments = page.map((entry) => {
    const assignment = entry.data();
    delete assignment.recipients;
    delete assignment.questions;
    return {
      id: entry.id,
      ...assignment
    };
  });
  return {
    lists: listSnapshot.docs.map((entry) => {
      const list = entry.data();
      return {
        id: entry.id,
        ...list,
        studentCount: Number(list.studentCount) || (Array.isArray(list.students) ? list.students.length : 0),
        students: Array.isArray(list.students) ? list.students.slice(0, 3) : []
      };
    }),
    assignments,
    hasMoreAssignments: assignmentSnapshot.docs.length > MAX_ASSIGNMENTS,
    nextAssignmentCursor: page.length ? nextCursor(page[page.length - 1]) : ""
  };
}

async function loadResults(db, uid, request) {
  const userResults = db.collection("users").doc(uid).collection("studentResults");
  const cursor = readCursor(request.query?.cursor);
  let query = userResults.orderBy("submittedAt", "desc");
  if (cursor) {
    const boundary = await userResults.doc(cursor.id).get();
    if (boundary.exists) query = query.startAfter(boundary);
    else if (cursor.timestamp !== null) query = query.startAfter(cursor.timestamp);
    else {
      const error = new Error("That page has changed. Refresh and try again.");
      error.status = 400;
      throw error;
    }
  }
  const snapshot = await query.limit(MAX_RESULTS + 1).get();
  const page = snapshot.docs.slice(0, MAX_RESULTS);
  return {
    results: page.map((entry) => ({ id: entry.id, ...entry.data() })),
    hasMore: snapshot.docs.length > MAX_RESULTS,
    nextCursor: page.length ? nextCursor(page[page.length - 1]) : ""
  };
}

async function saveList(db, uid, body) {
  const name = cleanText(body.name, 100);
  if (!name) {
    const error = new Error("Give this student list a name.");
    error.status = 400;
    throw error;
  }
  const students = normalizeStudents(body.students);
  const lists = db.collection("users").doc(uid).collection("mailingLists");
  const id = cleanText(body.id, 100) || lists.doc().id;
  const reference = lists.doc(id);
  const previous = await reference.get();
  const list = {
    name,
    students,
    studentCount: students.length,
    createdAt: previous.exists ? previous.data().createdAt : Date.now(),
    updatedAt: Date.now()
  };
  await reference.set(list);
  return { id, ...list };
}

async function createAssignment(db, uid, user, body) {
  const examId = cleanText(body.examId, 100);
  const listId = cleanText(body.listId, 100);
  if (!examId || !listId) {
    const error = new Error("Choose an exam and a student list.");
    error.status = 400;
    throw error;
  }
  const userRef = db.collection("users").doc(uid);
  const [examSnapshot, listSnapshot] = await Promise.all([
    userRef.collection("exams").doc(examId).get(),
    userRef.collection("mailingLists").doc(listId).get()
  ]);
  if (!examSnapshot.exists) {
    const error = new Error("That exam could not be found in your workspace.");
    error.status = 404;
    throw error;
  }
  if (!listSnapshot.exists) {
    const error = new Error("That student list could not be found.");
    error.status = 404;
    throw error;
  }
  const exam = examSnapshot.data();
  const list = listSnapshot.data();
  const students = normalizeStudents(list.students);
  const questions = safeQuestions(exam);
  const privateQuestions = exam.questions.map((question, index) => ({
    ...questions[index],
    answer: cleanText(question.answer, 1000),
    explanation: cleanText(question.explanation, 1200)
  }));
  const fallbackQuestionCount = questions.length;
  const requestedQuestionCount = Number(body.questionsPerAttempt);
  const questionCount = Number.isFinite(requestedQuestionCount)
    ? Math.max(1, Math.min(fallbackQuestionCount, Math.floor(requestedQuestionCount)))
    : fallbackQuestionCount;
  const requestedPassingScore = Number(body.passingScore);
  const passingScore = Number.isFinite(requestedPassingScore)
    ? Math.max(0, Math.min(100, Math.round(requestedPassingScore)))
    : 70;
  const ownerName = cleanText(user.name, 100) || user.email.split("@")[0] || (user.employer ? "Hiring team" : "Your educator");
  const workspaceKind = user.employer ? "employer" : "educator";
  const assignmentRef = userRef.collection("assignments").doc();
  const shareId = randomBytes(32).toString("base64url");
  const shareUrl = `${getBaseUrl()}/exam/${shareId}`;
  const now = Date.now();
  const assignment = {
    title: cleanText(exam.title, 160) || "Untitled exam",
    subject: cleanText(exam.subject, 120) || "General study",
    ownerName,
    workspaceKind,
    summary: cleanText(exam.summary, 1000),
    durationMinutes: Math.max(1, Math.min(180, Number(exam.durationMinutes) || 20)),
    questionCount,
    questionBankCount: questions.length,
    passingScore,
    questions: privateQuestions,
    examId,
    listId,
    listName: cleanText(list.name, 100),
    recipientCount: students.length,
    recipients: students,
    shareId,
    shareUrl,
    active: true,
    emailStatus: "not-sent",
    sentCount: 0,
    totalSubmissions: 0,
    createdAt: now,
    updatedAt: now
  };
  const publicAssignment = {
    ownerUid: uid,
    assignmentId: assignmentRef.id,
    title: assignment.title,
    subject: assignment.subject,
    ownerName: assignment.ownerName,
    workspaceKind: assignment.workspaceKind,
    summary: assignment.summary,
    durationMinutes: assignment.durationMinutes,
    questionCount: assignment.questionCount,
    questionBankCount: assignment.questionBankCount,
    passingScore: assignment.passingScore,
    questions,
    active: true,
    createdAt: now
  };
  const batch = db.batch();
  batch.set(assignmentRef, assignment);
  batch.set(db.collection("publicExams").doc(shareId), publicAssignment);
  await batch.commit();
  const assignmentForWorkspace = { ...assignment };
  delete assignmentForWorkspace.recipients;
  delete assignmentForWorkspace.questions;
  return {
    assignment: { id: assignmentRef.id, ...assignmentForWorkspace }
  };
}

async function sendExistingAssignment(db, uid, user, assignmentId) {
  const userRef = db.collection("users").doc(uid);
  const assignmentRef = userRef.collection("assignments").doc(assignmentId);
  const snapshot = await assignmentRef.get();
  if (!snapshot.exists) {
    const error = new Error("That assignment could not be found.");
    error.status = 404;
    throw error;
  }
  const assignment = snapshot.data();
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    await assignmentRef.update({ emailStatus: "not-configured", updatedAt: Date.now() });
    return { emailStatus: "not-configured", sentCount: 0 };
  }
  if (!assignment.active) {
    const error = new Error("This exam link is inactive.");
    error.status = 410;
    throw error;
  }
  const students = normalizeStudents(assignment.recipients);
  let delivery;
  try {
    delivery = await sendInvitations({
      assignment,
      students,
      teacherName: user.name || user.email.split("@")[0] || "Your educator",
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL
    });
  } catch (error) {
    await assignmentRef.update({
      emailStatus: "failed",
      sentCount: (Number(assignment.sentCount) || 0) + (Number(error.sentCount) || 0),
      lastSentAt: Date.now(),
      updatedAt: Date.now()
    });
    throw error;
  }
  await assignmentRef.update({
    emailStatus: delivery.emailStatus,
    sentCount: (Number(assignment.sentCount) || 0) + delivery.sentCount,
    lastSentAt: Date.now(),
    updatedAt: Date.now()
  });
  return delivery;
}

async function deleteAssignment(db, uid, assignmentId) {
  const userRef = db.collection("users").doc(uid);
  const assignmentRef = userRef.collection("assignments").doc(assignmentId);
  const snapshot = await assignmentRef.get();
  if (!snapshot.exists) return;
  const { shareId } = snapshot.data();
  while (true) {
    const results = await assignmentRef.collection("results").limit(400).get();
    if (results.empty) break;
    const batch = db.batch();
    results.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  while (true) {
    const sessions = await assignmentRef.collection("sessions").limit(400).get();
    if (sessions.empty) break;
    const batch = db.batch();
    sessions.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  const students = await assignmentRef.collection("students").get();
  for (const student of students.docs) {
    const studentUid = String(student.get("studentUid") || student.id);
    const workspaceId = createHash("sha256").update(`${uid}:${assignmentId}`).digest("hex");
    const studentAssignmentRef = db.collection("users").doc(studentUid)
      .collection("assignedExams").doc(workspaceId);
    while (true) {
      const attempts = await studentAssignmentRef.collection("attempts").limit(400).get();
      if (attempts.empty) break;
      const batch = db.batch();
      attempts.docs.forEach((entry) => batch.delete(entry.ref));
      await batch.commit();
    }
    const batch = db.batch();
    batch.delete(studentAssignmentRef);
    batch.delete(student.ref);
    await batch.commit();
  }
  while (true) {
    const results = await userRef.collection("studentResults").where("assignmentId", "==", assignmentId).limit(400).get();
    if (results.empty) break;
    const batch = db.batch();
    results.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  const batch = db.batch();
  batch.delete(assignmentRef);
  if (shareId) batch.delete(db.collection("publicExams").doc(shareId));
  await batch.commit();
}

export default async function handler(request, response) {
  try {
    const user = await requireEducator(request);
    const { db } = getAdminServices();
    const userRef = db.collection("users").doc(user.uid);

    if (request.method === "GET") {
      if (request.query?.view === "results") return response.status(200).json(await loadResults(db, user.uid, request));
      return response.status(200).json(await loadWorkspace(db, user.uid, request));
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      return response.status(405).json({ error: "Use GET or POST for this endpoint." });
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};
    const action = String(body.action || "");
    if (["save-list", "delete-list", "delete-assignment"].includes(action)) {
      consumeUserQuota(user.uid, "educator-write");
    }
    if (action === "send-assignment" && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      consumeUserQuota(user.uid, "educator-email");
    }

    if (action === "save-list") {
      const list = await saveList(db, user.uid, body);
      return response.status(200).json({ list });
    }
    if (action === "delete-list") {
      const id = cleanText(body.id, 100);
      if (!id) return response.status(400).json({ error: "Choose a student list to delete." });
      await userRef.collection("mailingLists").doc(id).delete();
      return response.status(200).json({ ok: true });
    }
    if (action === "create-assignment") {
      const result = await createAssignment(db, user.uid, user, body);
      return response.status(201).json(result);
    }
    if (action === "send-assignment") {
      const result = await sendExistingAssignment(db, user.uid, user, cleanText(body.id, 100));
      return response.status(200).json(result);
    }
    if (action === "delete-assignment") {
      const id = cleanText(body.id, 100);
      if (!id) return response.status(400).json({ error: "Choose an assignment to delete." });
      await deleteAssignment(db, user.uid, id);
      return response.status(200).json({ ok: true });
    }
    return response.status(400).json({ error: "Unknown educator workspace action." });
  } catch (error) {
    return sendError(response, error);
  }
}
