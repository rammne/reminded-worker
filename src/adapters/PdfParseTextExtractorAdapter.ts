import { PDFParse } from "pdf-parse";
import type { ITextExtractorService } from "../ports/ITextExtractorService";

export class PdfParseTextExtractorAdapter implements ITextExtractorService {
  async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const res = await parser.getText();
      // PDF text often returns with lots of whitespace; normalize a bit.
      return String(res.text ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
}

