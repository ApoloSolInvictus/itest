import { getAdminServices } from "../server/admin.js";
import { requireVerifiedUser } from "../server/auth.js";

const ATTEMPT_PAGE_SIZE = 50;

function sendError(response, error) {
  const status = Number.isInteger(error.status) ? error.status : 503;
  return response.status(status).json({
    error: status >= 500 && status !== 503
      ? "The student workspace could not be loaded. Please try again."
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
    const { db } = getAdminServices();
    const assignedExams = db.collection("users").doc(user.uid).collection("assignedExams");
    const assignmentKey = String(request.query?.assignmentKey || "").trim();

    if (request.query?.view === "attempts") {
      if (!/^[a-f0-9]{64}$/.test(assignmentKey)) {
        return response.status(400).json({ error: "Choose an assigned exam to view its results." });
      }
      const assignmentRef = assignedExams.doc(assignmentKey);
      const assignmentSnapshot = await assignmentRef.get();
      if (!assignmentSnapshot.exists || assignmentSnapshot.data().active !== true) {
        return response.status(404).json({ error: "This assigned exam is no longer available." });
      }
      const rawCursor = String(request.query?.cursor || "");
      let query = assignmentRef.collection("attempts").orderBy("attemptNumber", "desc");
      if (rawCursor) {
        const cursor = Number(rawCursor);
        if (!Number.isInteger(cursor) || cursor < 1) {
          return response.status(400).json({ error: "That results page is not valid. Refresh the workspace." });
        }
        query = query.startAfter(cursor);
      }
      const snapshot = await query.limit(ATTEMPT_PAGE_SIZE + 1).get();
      const page = snapshot.docs.slice(0, ATTEMPT_PAGE_SIZE).map((entry) => ({ id: entry.id, ...entry.data() }));
      return response.status(200).json({
        attempts: page,
        hasMore: snapshot.docs.length > ATTEMPT_PAGE_SIZE,
        nextCursor: page.length ? String(page[page.length - 1].attemptNumber) : ""
      });
    }

    const snapshot = await assignedExams.orderBy("assignedAt", "desc").limit(100).get();
    const assignments = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((assignment) => assignment.active === true);
    return response.status(200).json({ assignments });
  } catch (error) {
    return sendError(response, error);
  }
}
