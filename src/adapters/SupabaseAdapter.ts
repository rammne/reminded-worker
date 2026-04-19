import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IDatabaseService, JobRecord, JobResult } from "../ports/IDatabaseService";

type JobQueueRow = {
  id: number;
  status: string;
  type: string;
  payload: any;
  result: any;
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export class SupabaseAdapter implements IDatabaseService {
  private readonly supabase: SupabaseClient;

  constructor(opts: { supabaseUrl: string; serviceRoleKey: string }) {
    this.supabase = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /**
   * Same service-role client used by this adapter — for use cases that call `.rpc()` or ad-hoc queries.
   */
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  async listPendingJobs(limit: number): Promise<JobRecord[]> {
    const { data, error } = await this.supabase
      .from("job_queue")
      .select("id,status,type,payload,attempts,last_error,locked_at,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => this.toJobRecord(r));
  }

  async claimJob(jobId: number): Promise<JobRecord | null> {
    // Atomic claim: update only if still pending.
    const { data, error } = await this.supabase
      .from("job_queue")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "pending")
      .select("id,status,type,payload,attempts,last_error,locked_at,created_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    // increment attempts (best-effort)
    await this.supabase
      .from("job_queue")
      .update({ attempts: (data as any).attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    return this.toJobRecord(data as any);
  }

  async markCompleted(jobId: number, result: JobResult): Promise<void> {
    const { error } = await this.supabase
      .from("job_queue")
      .update({
        status: "completed",
        result,
        last_error: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) throw error;
  }

  async markFailed(jobId: number, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from("job_queue")
      .update({
        status: "failed",
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) throw error;
  }

  async downloadFromStorage(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    if (error) throw error;
    if (!data) throw new Error("Storage download returned empty data");

    // supabase-js returns a Blob in many environments (Node 20 supports Blob).
    const anyData: any = data as any;
    if (Buffer.isBuffer(anyData)) return anyData;
    if (typeof anyData?.arrayBuffer === "function") {
      const ab = await anyData.arrayBuffer();
      return Buffer.from(ab);
    }
    if (anyData instanceof ArrayBuffer) return Buffer.from(anyData);

    throw new Error("Unsupported storage download data type");
  }

  async requeueStaleProcessingJobs(staleBeforeIso: string): Promise<number> {
    const { data, error } = await this.supabase
      .from("job_queue")
      .update({
        status: "pending",
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("status", "processing")
      .lt("locked_at", staleBeforeIso)
      .select("id");

    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
  }

  async insertLearningMaterialDraft(input: {
    courseId: number;
    fileName: string;
    filePath: string;
    topicName: string;
  }): Promise<number> {
    const { data, error } = await this.supabase
      .from("learning_materials")
      .insert({
        course_id: input.courseId,
        file_name: input.fileName,
        file_path: input.filePath,
        topic_name: input.topicName,
      })
      .select("id")
      .single();
    if (error) throw error;
    return Number((data as any).id);
  }

  async replaceQuestionsForMaterial(input: {
    courseId: number;
    materialId: number;
    questions: Array<{
      question_text: string;
      choices: string[];
      correct_answer: string;
    }>;
  }): Promise<void> {
    // Idempotency: remove previous questions for this material, then insert the new set.
    const { error: delErr } = await this.supabase
      .from("questions")
      .delete()
      .eq("material_id", input.materialId);
    if (delErr) throw delErr;

    const rows = input.questions.map((q) => ({
      course_id: input.courseId,
      material_id: input.materialId,
      question_text: q.question_text,
      choices: q.choices,
      correct_answer: q.correct_answer,
    }));

    const { error: insErr } = await this.supabase.from("questions").insert(rows);
    if (insErr) throw insErr;
  }

  private toJobRecord(row: JobQueueRow): JobRecord {
    return {
      id: row.id,
      status: row.status as any,
      type: row.type as any,
      payload: row.payload,
      attempts: row.attempts ?? 0,
      last_error: row.last_error ?? null,
      locked_at: row.locked_at ?? null,
      created_at: row.created_at,
    };
  }
}

