import { getAdminServices } from "../server/admin.js";

function readShareId(request) {
  const fromQuery = request.query?.shareId;
  if (typeof fromQuery === "string") return fromQuery;
  const host = request.headers?.host || "itest.wstudio3d.com";
  try { return new URL(request.url, `https://${host}`).searchParams.get("shareId") || ""; }
  catch { return ""; }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Use GET for this endpoint." });
  }

  const shareId = readShareId(request);
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(shareId)) {
    return response.status(404).json({ error: "This exam link is not valid." });
  }
  try {
    const { db } = getAdminServices();
    const snapshot = await db.collection("publicExams").doc(shareId).get();
    if (!snapshot.exists || snapshot.data().active !== true) {
      return response.status(404).json({ error: "This exam link is no longer available." });
    }
    const data = snapshot.data();
    return response.status(200).json({
      exam: {
        title: data.title,
        subject: data.subject,
        summary: data.summary,
        durationMinutes: data.durationMinutes,
        questionCount: data.questionCount,
        questions: (data.questions || []).map((question) => ({
          id: question.id,
          prompt: question.prompt,
          type: question.type,
          options: question.options,
          points: question.points
        }))
      }
    });
  } catch {
    return response.status(503).json({ error: "This exam could not be loaded right now. Please try again." });
  }
}
