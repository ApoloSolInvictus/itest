import { auth } from "./firebase.js";

const MAX_EXTRACTED_BYTES = 9 * 1024 * 1024;

function assertExtractedTextSize(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_EXTRACTED_BYTES) {
    throw new Error("This document expands to more than 9 MB of text. Split it into smaller chapters and upload them separately.");
  }
}

function collectPdfPageText(items) {
  return items
    .map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

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
    let extractedBytes = 0;
    let unreadablePages = 0;
    let readableCharacterCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = collectPdfPageText(content.items);
      if (!pageText) unreadablePages += 1;
      readableCharacterCount += pageText.length;
      const pageBlock = `--- Page ${pageNumber} ---\n${pageText}`;
      extractedBytes += new TextEncoder().encode(pageBlock).byteLength;
      if (extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error("This document expands to more than 9 MB of text. Split it into smaller chapters and upload them separately.");
      }
      pages.push(pageBlock);
    }
    const text = pages.join("\n\n");
    assertExtractedTextSize(text);
    return { text, pageCount: pdf.numPages, unreadablePages, hasSelectableText: readableCharacterCount > 0 };
  }

  if (name.endsWith(".docx")) {
    const mammothModule = await import("mammoth/mammoth.browser");
    const mammoth = mammothModule.default || mammothModule;
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = String(result.value || "").trim();
    assertExtractedTextSize(text);
    return { text, pageCount: null, unreadablePages: 0, hasSelectableText: Boolean(text) };
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
    const text = String(result.text || "").trim();
    assertExtractedTextSize(text);
    return { text, pageCount: null, unreadablePages: 0, hasSelectableText: Boolean(text) };
  }

  throw new Error("Choose a PDF, DOC, or DOCX file.");
}
