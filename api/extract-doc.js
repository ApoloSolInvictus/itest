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
    const text = document.getBody().replace(/\u0000/g, " ").trim().slice(0, 26000);
    if (!text) return response.status(422).json({ error: "No readable text was found in that document." });
    return response.status(200).json({ text });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 422;
    return response.status(status).json({
      error: status >= 500 && status !== 503
        ? "iTest could not read that document."
        : error.message
    });
  }
}
