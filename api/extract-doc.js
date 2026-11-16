import WordExtractor from "word-extractor";
import { consumeUserQuota, requireUser } from "../server/auth.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Use POST for this endpoint." });
  }

  try {
    const user = await requireUser(request);
    await consumeUserQuota(user.uid, "extract-doc");
    const encoded = String(request.body?.fileBase64 || "");
    if (!encoded || encoded.length > 4_200_000) {
      return response.status(413).json({ error: "Legacy Word files must be smaller than 3 MB." });
    }
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > 3_000_000) {
      return response.status(413).json({ error: "Legacy Word files must be smaller than 3 MB." });
    }
    const document = await new WordExtractor().extract(buffer);
    const text = document.getBody().replace(/\u0000/g, " ").trim();
    if (!text) return response.status(422).json({ error: "No readable text was found in that document." });
    const payload = JSON.stringify({ text });
    if (Buffer.byteLength(payload, "utf8") > 4 * 1024 * 1024) {
      return response.status(413).json({ error: "This legacy Word file expands beyond the server's safe response size. Save it as DOCX or split it into smaller chapters, then upload it again." });
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.status(200).send(payload);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 422;
    return response.status(status).json({
      error: status >= 500 && status !== 503
        ? "iTest could not read that document."
        : error.message
    });
  }
}
