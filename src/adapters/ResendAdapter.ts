import { Resend } from "resend";
import type { CreateBatchEmailOptions } from "resend";

/**
 * One recipient row produced by the spaced-repetition reminder job.
 * `to` must be a deliverable address Resend accepts for the verified domain.
 */
export type ReminderBatchPayload = {
  to: string;
  reviewCount: number;
  userName: string;
};

/** Resend batch API hard limit — never exceed this per `batch.send()` call. */
const RESEND_BATCH_MAX = 100;

/**
 * Sender identity (placeholder domain until production DNS is wired).
 * RFC 5322 friendly-name form so inbox clients show “ReMindED” correctly.
 */
const REMINDER_FROM = "ReMindED <onboarding@resend.dev>";

const REMINDER_SUBJECT = "You have cards to review today.";

/**
 * Thin adapter around Resend’s Node SDK for daily spaced-repetition reminder email batches.
 *
 * - Reads `RESEND_API_KEY` and `FRONTEND_URL` from the process environment.
 * - Splits large recipient lists into API-compliant chunks (max 100 emails per request).
 * - Isolates failures per chunk so one bad batch does not stop the rest of the run.
 */
export class ResendAdapter {
  /** Underlying SDK client; constructed once per worker process lifetime. */
  private readonly resend: Resend;

  constructor() {
    // Intentionally pass through `undefined` when unset — `batch.send` will surface a typed API error.
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  /**
   * Sends one HTML reminder per payload row using `resend.batch.send`, automatically chunking
   * when more than {@link RESEND_BATCH_MAX} recipients are supplied.
   */
  public async sendBatchReminders(payloads: ReminderBatchPayload[]): Promise<void> {
    if (payloads.length === 0) {
      return;
    }

    const frontendBase = process.env.FRONTEND_URL?.replace(/\/+$/, "") ?? "";

    // Walk the list in fixed-size windows aligned with Resend’s batch contract.
    for (let offset = 0; offset < payloads.length; offset += RESEND_BATCH_MAX) {
      const chunk = payloads.slice(offset, offset + RESEND_BATCH_MAX);

      const batchPayload: CreateBatchEmailOptions[] = chunk.map((row) => ({
        from: REMINDER_FROM,
        to: row.to,
        subject: REMINDER_SUBJECT,
        html: this.generateReminderHtml(row.userName, row.reviewCount, frontendBase),
      }));

      try {
        const { error } = await this.resend.batch.send(batchPayload);

        if (error) {
          // Structured Resend error — log and continue with remaining chunks.
          console.error(
            `[ResendAdapter] batch.send failed for chunk starting at index ${offset} (size ${chunk.length}):`,
            {
              name: error.name,
              message: error.message,
              statusCode: error.statusCode,
            },
          );
        }
      } catch (err) {
        // Network / runtime failures from the SDK — do not bubble; preserve worker stability.
        console.error(
          `[ResendAdapter] unexpected exception during batch.send for chunk starting at index ${offset} (size ${chunk.length}):`,
          err,
        );
      }
    }
  }

  /**
   * Builds a self-contained HTML email body (inline styles only) for maximum client compatibility.
   *
   * @param userName Display name; HTML-escaped to avoid injection via stored profile values.
   * @param reviewCount Number of due cards — drives copy and pluralization.
   * @param frontendBase Normalized app origin (no trailing slash); CTA falls back to `#` if unset.
   */
  private generateReminderHtml(userName: string, reviewCount: number, frontendBase: string): string {
    const safeName = escapeHtml(userName);
    const cardWord = reviewCount === 1 ? "card" : "cards";
    const ctaHref = frontendBase ? `${frontendBase}/` : "#";

    return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${REMINDER_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#131312;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#131312;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
            <tr>
              <td style="padding:0 0 24px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#a3a3a3;">
                ReMindED
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px 0;font-size:22px;line-height:1.35;font-weight:600;">
                Hi ${safeName},
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 28px 0;font-size:16px;line-height:1.6;color:#e5e5e5;">
                You have <strong style="color:#ffffff;">${reviewCount}</strong> ${cardWord} ready for review today. A short session now keeps your schedule light later.
              </td>
            </tr>
            <tr>
              <td align="left" style="padding:0 0 32px 0;">
                <a href="${ctaHref}" style="display:inline-block;padding:14px 28px;background-color:#ffffff;color:#131312;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
                  Start reviewing
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0;font-size:12px;line-height:1.5;color:#737373;">
                If the button does not work, copy and paste this link into your browser:<br />
                <span style="color:#a3a3a3;word-break:break-all;">${escapeHtml(ctaHref)}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
  }
}

/**
 * Minimal HTML entity escaping for untrusted text interpolated into markup.
 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
