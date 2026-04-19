import type { IDatabaseService, JobRecord, JobResult } from "../ports/IDatabaseService";
import type { ILLMService } from "../ports/ILLMService";
import type { ITextExtractorService } from "../ports/ITextExtractorService";
import { chunkText } from "../domain/chunking";
import { mapPromptForChunk, reducePromptForQuestions } from "../domain/prompts";
import { distributeAnswerPositions } from "../domain/validation";

type QuizJobPayload = {
  /**
   * Prefer providing text to enable strict map-reduce chunking.
   * If missing, you can provide pdfBase64 for a fallback path.
   */
  text?: string;
  pdfBase64?: string;
  storageBucket?: string;
  storagePath?: string;
  mimeType?: string;
  fileName?: string;
  courseId?: number | string;
  materialId?: number | string;
};

export class ProcessQuizUseCase {
  constructor(
    private readonly db: IDatabaseService,
    private readonly llm: ILLMService,
    private readonly textExtractor: ITextExtractorService,
  ) {}

  private log(jobId: number, message: string) {
    // eslint-disable-next-line no-console
    console.log(`[job ${jobId}] ${message}`);
  }

  private estimateTokens(text: string) {
    return Math.ceil(String(text ?? "").length / 4);
  }

  async processOne(job: JobRecord): Promise<void> {
    const claimed = await this.db.claimJob(job.id);
    if (!claimed) return;

    const t0 = Date.now();
    try {
      const payload = (claimed.payload ?? {}) as QuizJobPayload;
      let text = typeof payload.text === "string" ? payload.text : "";
      const pdfBase64 = typeof payload.pdfBase64 === "string" ? payload.pdfBase64 : "";
      const storageBucket =
        typeof payload.storageBucket === "string" ? payload.storageBucket : "";
      const storagePath = typeof payload.storagePath === "string" ? payload.storagePath : "";
      const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : "";
      const fileName = typeof payload.fileName === "string" ? payload.fileName : "";

      this.log(
        claimed.id,
        `started. type=${claimed.type} file=${fileName || "n/a"} storage=${storageBucket || "n/a"}/${storagePath || "n/a"}`,
      );

      if (!text && !pdfBase64 && !(storageBucket && storagePath)) {
        throw new Error(
          "Job payload must include `text`, `pdfBase64`, or (`storageBucket` + `storagePath`)",
        );
      }

      let resolvedPdfBase64 = pdfBase64;
      let resolvedMimeType = mimeType || "application/pdf";
      if (!text && !resolvedPdfBase64 && storageBucket && storagePath) {
        this.log(claimed.id, `downloading PDF from storage (${storageBucket}/${storagePath})...`);
        const buf = await this.db.downloadFromStorage(storageBucket, storagePath);
        this.log(claimed.id, `downloaded PDF bytes=${buf.byteLength}`);
        resolvedPdfBase64 = buf.toString("base64");
        resolvedMimeType = mimeType || "application/pdf";
      }

      // If text is missing, extract from PDF (storage path or base64).
      if (!text) {
        if (resolvedMimeType !== "application/pdf") {
          throw new Error(`Unsupported mimeType for extraction: ${resolvedMimeType}`);
        }
        const pdfBuffer = resolvedPdfBase64
          ? Buffer.from(resolvedPdfBase64, "base64")
          : storageBucket && storagePath
            ? await this.db.downloadFromStorage(storageBucket, storagePath)
            : null;

        if (!pdfBuffer) {
          throw new Error("No PDF buffer available for extraction");
        }
        this.log(claimed.id, "extracting text from PDF...");
        text = await this.textExtractor.extractTextFromPdf(pdfBuffer);
        this.log(claimed.id, `extracted text chars=${text.length} estTokens=${this.estimateTokens(text)}`);
        if (!text) throw new Error("Extracted PDF text is empty");
      }

      // Map-Reduce orchestration (sequential): chunk text → map notes → reduce to questions.
      this.log(claimed.id, "chunking text...");
      const chunks = chunkText(text);
      this.log(claimed.id, `chunked into ${chunks.length} chunk(s)`);
      const notes: string[] = [];
      for (const c of chunks) {
        const prompt = mapPromptForChunk(c);
        this.log(
          claimed.id,
          `map chunk #${c.index} chars=${c.text.length} promptEstTokens=${this.estimateTokens(prompt)}`,
        );
        const mapped = await this.llm.mapChunkToNotes(prompt);
        this.log(claimed.id, `map chunk #${c.index} notes=${mapped.notes?.length ?? 0}`);
        for (const n of mapped.notes ?? []) {
          const s = String(n).trim();
          if (s) notes.push(s);
        }
      }

      const reducePrompt = reducePromptForQuestions(notes.slice(0, 250));
      this.log(
        claimed.id,
        `reduce notes=${notes.length} reducePromptEstTokens=${this.estimateTokens(reducePrompt)}`,
      );
      const questionsRaw = await this.llm.reduceNotesToQuestions(reducePrompt);
      const questions = distributeAnswerPositions(questionsRaw);
      this.log(claimed.id, `reduce produced questions=${questions.length}`);

      if (!questions.length) {
        throw new Error(
          "No valid questions were produced (map-reduce produced empty output).",
        );
      }

      const courseIdNum =
        payload.courseId != null && payload.courseId !== ""
          ? Number(payload.courseId)
          : NaN;
      let materialIdNum: number | undefined;
      if (
        Number.isFinite(courseIdNum) &&
        storagePath &&
        fileName &&
        !payload.materialId
      ) {
        try {
          const topicSeed =
            fileName.replace(/\.pdf$/i, "").trim() || fileName;
          this.log(claimed.id, `creating learning_materials draft topic="${topicSeed}"...`);
          materialIdNum = await this.db.insertLearningMaterialDraft({
            courseId: courseIdNum,
            fileName,
            filePath: storagePath,
            topicName: topicSeed,
          });
          this.log(claimed.id, `created learning_materials id=${materialIdNum}`);
        } catch (e) {
          // Non-fatal: UI can still create material on publish
          // eslint-disable-next-line no-console
          console.error("[worker] insertLearningMaterialDraft failed:", e);
        }
      }

      // If we have a material, persist questions immediately so the user can navigate away.
      const finalMaterialId =
        payload.materialId != null && payload.materialId !== ""
          ? Number(payload.materialId)
          : materialIdNum;

      if (Number.isFinite(courseIdNum) && finalMaterialId && Number.isFinite(finalMaterialId)) {
        this.log(
          claimed.id,
          `saving questions to DB courseId=${courseIdNum} materialId=${finalMaterialId}...`,
        );
        await this.db.replaceQuestionsForMaterial({
          courseId: courseIdNum,
          materialId: finalMaterialId,
          questions: questions.map((q: any) => ({
            question_text: q.question_text,
            choices: q.choices,
            correct_answer: q.correct_answer,
          })),
        });
        this.log(claimed.id, "saved questions to DB");
      }

      const result: JobResult = {
        questions: questions.map((q: any) => ({
          question_text: q.question_text,
          choices: q.choices,
          correct_answer: q.correct_answer,
        })),
        meta: {
          courseId: payload.courseId,
          materialId:
            payload.materialId ??
            (materialIdNum != null ? String(materialIdNum) : undefined),
          questionsSaved:
            Number.isFinite(courseIdNum) &&
            (payload.materialId != null || materialIdNum != null),
        },
      };

      await this.db.markCompleted(claimed.id, result);
      this.log(claimed.id, `completed in ${Date.now() - t0}ms`);
    } catch (err) {
      const msg = String((err as any)?.message || err);
      this.log(claimed.id, `failed after ${Date.now() - t0}ms: ${msg}`);
      await this.db.markFailed(claimed.id, msg);
    }
  }
}

