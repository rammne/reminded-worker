export type JobStatus = "pending" | "processing" | "completed" | "failed";

export type JobType = "quiz_from_pdf" | "quiz_from_text";

export type JobRecord = {
  id: number;
  status: JobStatus;
  type: JobType;
  payload: unknown;
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
  created_at: string;
};

export type JobResult = {
  questions: Array<{
    question_text: string;
    choices: string[];
    correct_answer: string;
  }>;
  meta?: Record<string, unknown>;
};

export interface IDatabaseService {
  listPendingJobs(limit: number): Promise<JobRecord[]>;

  /**
   * Atomically claims a pending job so multiple workers can run safely.
   * Returns null if the job was already claimed by another worker.
   */
  claimJob(jobId: number): Promise<JobRecord | null>;

  /**
   * Fetch a binary object from Supabase Storage.
   * (Used for jobs that reference storage paths instead of embedding base64 in payload.)
   */
  downloadFromStorage(bucket: string, path: string): Promise<Buffer>;

  /**
   * Moves stale processing jobs back to pending (e.g. if a worker crashed mid-job).
   * Returns the number of rows updated.
   */
  requeueStaleProcessingJobs(staleBeforeIso: string): Promise<number>;

  insertLearningMaterialDraft(input: {
    courseId: number;
    fileName: string;
    filePath: string;
    topicName: string;
  }): Promise<number>;

  /**
   * Persist generated questions to the main `questions` table.
   * Implementations should be idempotent per materialId (e.g. delete then insert).
   */
  replaceQuestionsForMaterial(input: {
    courseId: number;
    materialId: number;
    questions: Array<{
      question_text: string;
      choices: string[];
      correct_answer: string;
    }>;
  }): Promise<void>;

  markCompleted(jobId: number, result: JobResult): Promise<void>;
  markFailed(jobId: number, errorMessage: string): Promise<void>;
}

