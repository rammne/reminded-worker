import cron from "node-cron";

import type { ResendAdapter } from "../adapters/ResendAdapter";
import type { GetUsersWithPendingReviewsUseCase } from "../application/GetUsersWithPendingReviewsUseCase";

/**
 * Schedules a once-daily job that loads learners with due reviews and sends reminder emails via Resend.
 *
 * `start()` only registers `node-cron` timers; it returns immediately so the worker poll loop stays responsive.
 */
export class DailyReminderDispatcher {
  constructor(
    private readonly getUsersWithPendingReviews: GetUsersWithPendingReviewsUseCase,
    private readonly resend: ResendAdapter,
  ) {}

  /**
   * Registers a cron expression for **08:00 every day** (server local time).
   * The callback never blocks the event loop: async work runs inside a detached promise chain.
   */
  start(): void {
    const expr = process.env.DAILY_REMINDER_CRON?.trim() || "0 8 * * *";
    const tz = process.env.REMINDER_TIMEZONE?.trim();

    // Minute 0, hour 8, every day — standard five-field cron used by node-cron.
    cron.schedule(
      expr,
      () => {
      void this.runDailyReminderJob();
      },
      tz ? { timezone: tz } : undefined,
    );

    // eslint-disable-next-line no-console
    console.log(
      `[DailyReminderDispatcher] scheduled: ${expr}${tz ? ` (timezone ${tz})` : ""}`,
    );
  }

  /**
   * Fetches due users, maps rows into Resend batch payloads, and sends email batches.
   */
  private async runDailyReminderJob(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log("[DailyReminderDispatcher] daily reminder job started");

    try {
      const dueUsers = await this.getUsersWithPendingReviews.execute();
      // eslint-disable-next-line no-console
      console.log(
        `[DailyReminderDispatcher] due users found: ${dueUsers.length} (REMINDER_TIMEZONE=${process.env.REMINDER_TIMEZONE || "UTC"})`,
      );

      const payloads = dueUsers.map((u) => ({
        to: u.email,
        reviewCount: u.pendingCount,
        userName: u.name,
      }));

      await this.resend.sendBatchReminders(payloads);

      // eslint-disable-next-line no-console
      console.log(
        `[DailyReminderDispatcher] daily reminder job finished successfully; reminders dispatched for ${payloads.length} user(s).`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[DailyReminderDispatcher] daily reminder job failed:", err);
    }
  }
}
