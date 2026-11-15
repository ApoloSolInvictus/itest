import { auth } from "./firebase.js";

const MAX_TEXT_LENGTH = 26000;

export async function extractDocumentText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const [pdfjs, workerModule] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 100); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
      if (pages.join("\n").length > MAX_TEXT_LENGTH) break;
    }
    return pages.join("\n").slice(0, MAX_TEXT_LENGTH);
  }
  if (name.endsWith(".docx")) {
    const mammothModule = await import("mammoth/mammoth.browser");
    const mammoth = mammothModule.default || mammothModule;
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value.slice(0, MAX_TEXT_LENGTH);
  }
  if (name.endsWith(".doc")) {
    const user = auth?.currentUser;
    if (!user) throw new Error("Sign in with Firebase to extract legacy .doc files.");
    const token = await user.getIdToken();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const fileBase64 = btoa(binary);
    const response = await fetch("/api/extract-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileBase64 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The Word document could not be read.");
    return String(result.text || "").slice(0, MAX_TEXT_LENGTH);
  }
  throw new Error("Choose a PDF, DOC, or DOCX file.");
}
