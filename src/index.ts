import { SupabaseAdapter } from "./adapters/SupabaseAdapter";
import { OpenAIAdapter } from "./adapters/OpenAIAdapter";
import { MockLLMAdapter } from "./adapters/MockLLMAdapter";
import { PdfParseTextExtractorAdapter } from "./adapters/PdfParseTextExtractorAdapter";
import { ResendAdapter } from "./adapters/ResendAdapter";
import { GetUsersWithPendingReviewsUseCase } from "./application/GetUsersWithPendingReviewsUseCase";
import { ProcessQuizUseCase } from "./application/ProcessQuizUseCase";
import { DailyReminderDispatcher } from "./cron/DailyReminderDispatcher";
import { loadWorkerEnv } from "./loadEnv";

loadWorkerEnv();

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/** Accept same URL name as Next.js `.env.local` */
function getSupabaseUrl(): string {
  const url =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Missing Supabase URL: set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in worker/.env.local",
    );
  }
  return url;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : fallback;
  return Number.isFinite(n) ? n : fallback;
}

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      next();
    }
  };
}

function minutesAgoIso(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function main() {
  const db = new SupabaseAdapter({
    supabaseUrl: getSupabaseUrl(),
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  });

  const isDev = process.env.NODE_ENV !== "production";
  const llm = isDev
    ? new MockLLMAdapter()
    : new OpenAIAdapter({
        apiKey: getEnv("OPENAI_API_KEY"),
        model: "gpt-4o-mini",
      });

  const textExtractor = new PdfParseTextExtractorAdapter();
  const useCase = new ProcessQuizUseCase(db, llm, textExtractor);

  const pendingReviewsUseCase = new GetUsersWithPendingReviewsUseCase(db.getSupabaseClient());
  const resendAdapter = new ResendAdapter();
  const dailyReminderDispatcher = new DailyReminderDispatcher(pendingReviewsUseCase, resendAdapter);
  dailyReminderDispatcher.start();

  const pollIntervalMs = numEnv("POLL_INTERVAL_MS", 5000);
  const maxConcurrentJobs = Math.max(1, Math.min(5, numEnv("MAX_CONCURRENT_JOBS", 5)));
  const runLimited = createLimiter(maxConcurrentJobs);
  const staleProcessingMinutes = Math.max(1, numEnv("STALE_PROCESSING_MINUTES", 15));

  let tickRunning = false;

  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const requeued = await db.requeueStaleProcessingJobs(minutesAgoIso(staleProcessingMinutes));
      if (requeued > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[worker] requeued ${requeued} stale processing jobs`);
      }

      const pending = await db.listPendingJobs(maxConcurrentJobs * 3);
      const batch = pending.slice(0, maxConcurrentJobs);

      if (batch.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[worker] claiming up to ${batch.length} job(s): ${batch.map((j) => j.id).join(", ")}`,
        );
      }

      await Promise.allSettled(
        batch.map((job) =>
          runLimited(async () => {
            await useCase.processOne(job);
          }),
        ),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[worker] tick error:", err);
    } finally {
      tickRunning = false;
    }
  };

  await tick();
  setInterval(tick, pollIntervalMs);
  // eslint-disable-next-line no-console
  console.log(
    `[worker] started. poll=${pollIntervalMs}ms maxConcurrent=${maxConcurrentJobs}; daily reminders at 08:00. Env loaded from worker/.env*`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal:", err);
  process.exit(1);
});

