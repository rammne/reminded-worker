export interface ITextExtractorService {
  /**
   * Extracts plain text from a PDF buffer for downstream chunking/map-reduce.
   */
  extractTextFromPdf(buffer: Buffer): Promise<string>;
}

