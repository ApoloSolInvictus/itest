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

function getOcrLanguages(value) {
  return String(value || "eng+spa")
    .split("+")
    .map((language) => language.trim())
    .filter((language) => /^[a-z_]{3,12}$/i.test(language))
    .slice(0, 3);
}

async function recognizeScannedPages(pdf, pageTexts, blankPages, languages, onProgress) {
  if (!blankPages.length) return { ocrPages: 0, unreadablePages: 0, ocrError: "" };
  let worker;
  let ocrPages = 0;
  let unreadablePages = blankPages.length;
  let ocrError = "";
  onProgress?.({ stage: "Preparing OCR", current: 0, total: blankPages.length });
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker(getOcrLanguages(languages), 1);
    for (let index = 0; index < blankPages.length; index += 1) {
      const pageNumber = blankPages[index];
      onProgress?.({ stage: "Recognizing scanned pages", current: index + 1, total: blankPages.length, pageNumber });
      let canvas;
      try {
        const page = await pdf.getPage(pageNumber);
        const initialViewport = page.getViewport({ scale: 1 });
        const largestSide = Math.max(initialViewport.width, initialViewport.height);
        const scale = Math.min(1.8, Math.max(0.75, 2400 / largestSide));
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("A canvas is not available for OCR.");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas);
        const recognized = String(result.data.text || "").trim();
        if (recognized) {
          const currentPage = pageTexts[pageNumber - 1];
          const selectableText = currentPage.slice(currentPage.indexOf("\n") + 1).trim();
          pageTexts[pageNumber - 1] = selectableText
            ? `${currentPage}\n\n--- Page ${pageNumber} · OCR ---\n${recognized}`
            : `--- Page ${pageNumber} · OCR ---\n${recognized}`;
          ocrPages += 1;
          unreadablePages -= 1;
        }
      } catch (error) {
        ocrError ||= error?.message || "OCR could not read one or more scanned pages.";
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    }
  } catch (error) {
    ocrError = error?.message || "The OCR engine could not start.";
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
  return { ocrPages, unreadablePages, ocrError };
}

export async function extractDocumentText(file, { ocrLanguages = "eng+spa", onProgress } = {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const [pdfjs, workerModule] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = new Array(pdf.numPages);
    const blankPages = [];
    let extractedBytes = 0;
    let readableCharacterCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (pageNumber === 1 || pageNumber % 10 === 0 || pageNumber === pdf.numPages) {
        onProgress?.({ stage: "Reading PDF pages", current: pageNumber, total: pdf.numPages });
      }
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = collectPdfPageText(content.items);
      if (!pageText) {
        blankPages.push(pageNumber);
      } else if (pageText.length < 500) {
        // Scanned PDFs often keep a page number or header as selectable text
        // while the main content remains a raster image.
        const operators = await page.getOperatorList();
        const imageOps = new Set([
          pdfjs.OPS.paintImageXObject,
          pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintInlineImageXObjectGroup,
          pdfjs.OPS.paintImageXObjectRepeat
        ]);
        if (operators.fnArray.some((operation) => imageOps.has(operation))) blankPages.push(pageNumber);
      }
      readableCharacterCount += pageText.length;
      const pageBlock = `--- Page ${pageNumber} ---\n${pageText}`;
      extractedBytes += new TextEncoder().encode(pageBlock).byteLength;
      if (extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error("This document expands to more than 9 MB of text. Split it into smaller chapters and upload them separately.");
      }
      pages[pageNumber - 1] = pageBlock;
    }
    const ocr = await recognizeScannedPages(pdf, pages, blankPages, ocrLanguages, onProgress);
    const text = pages.join("\n\n");
    assertExtractedTextSize(text);
    const hasSelectableText = readableCharacterCount > 0;
    const hasReadableText = hasSelectableText || ocr.ocrPages > 0;
    return {
      text, pageCount: pdf.numPages, hasSelectableText, hasReadableText,
      ocrPages: ocr.ocrPages, unreadablePages: ocr.unreadablePages, ocrError: ocr.ocrError
    };
  }

  if (name.endsWith(".docx")) {
    const mammothModule = await import("mammoth/mammoth.browser");
    const mammoth = mammothModule.default || mammothModule;
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = String(result.value || "").trim();
    assertExtractedTextSize(text);
    return { text, pageCount: null, hasSelectableText: Boolean(text), hasReadableText: Boolean(text), ocrPages: 0, unreadablePages: 0, ocrError: "" };
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
    return { text, pageCount: null, hasSelectableText: Boolean(text), hasReadableText: Boolean(text), ocrPages: 0, unreadablePages: 0, ocrError: "" };
  }

  throw new Error("Choose a PDF, DOC, or DOCX file.");
}
