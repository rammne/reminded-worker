import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One row per learner who has at least one spaced-repetition item due at `p_now`
 * (aggregated from `student_progress`).
 *
 * Populated by the `get_users_with_pending_reviews` database function (see `GET_USERS_WITH_PENDING_REVIEWS_RPC_SQL`).
 */
export type UserPendingReviewRow = {
  email: string;
  name: string;
  pendingCount: number;
};

/**
 * Copy the entire string into **Supabase → SQL Editor → New query → Run**.
 *
 * Schema alignment (your DB):
 * - `student_progress.user_id` → `profiles.id`; `next_review_date` is **date** (nullable).
 * - `profiles` holds **email** and **full_name** — no `auth.users` join required.
 *
 * Due rule: include rows where `next_review_date` is on or before the **UTC calendar date** of `p_now`
 * (matches `new Date().toISOString()` from the worker). Rows with NULL `next_review_date` are included.
 */
export const GET_USERS_WITH_PENDING_REVIEWS_RPC_SQL = `
-- get_users_with_pending_reviews: due review rows aggregated per user
-- student_progress.next_review_date is type DATE; compare using UTC calendar date of p_now.
create or replace function public.get_users_with_pending_reviews(p_now timestamptz)
returns table (
  email text,
  name text,
  pending_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with due_as_of as (
    select ((p_now at time zone 'utc'))::date as d
  )
  select
    p.email::text as email,
    coalesce(nullif(trim(p.full_name), ''), 'Student') as name,
    count(*)::bigint as pending_count
  from public.student_progress sp
  inner join public.profiles p on p.id = sp.user_id
  cross join due_as_of
  where (sp.next_review_date is null or sp.next_review_date <= due_as_of.d)
    and p.email is not null
    and btrim(p.email) <> ''
  group by p.id, p.email, p.full_name;
$$;

revoke all on function public.get_users_with_pending_reviews(timestamptz) from public;
grant execute on function public.get_users_with_pending_reviews(timestamptz) to service_role;
`.trim();

/**
 * Fetches learners with spaced-repetition items due on or before the UTC calendar day of “now”
 * (`student_progress.next_review_date` is a **date**; compared to `p_now` converted to UTC date).
 *
 * Calls `get_users_with_pending_reviews` in the database via `.rpc()` so grouping and counts happen
 * server-side. Install the function once using `GET_USERS_WITH_PENDING_REVIEWS_RPC_SQL`, then deploy the worker.
 */
export class GetUsersWithPendingReviewsUseCase {
  constructor(private readonly supabase: SupabaseClient) {}

  private todayIsoDate(timeZone: string): string {
    // en-CA yields YYYY-MM-DD which PostgREST accepts for DATE comparisons.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  /**
   * Returns unique users with the number of due rows in `student_progress` whose `next_review_date`
   * (date) is NULL or <= the UTC date of “now”.
   */
  async execute(): Promise<UserPendingReviewRow[]> {
    // Prefer timezone-aware "today" to match what learners see in the UI.
    // Configure with REMINDER_TIMEZONE (e.g., "Asia/Manila"). Defaults to UTC.
    const tz = process.env.REMINDER_TIMEZONE?.trim() || "UTC";
    const today = this.todayIsoDate(tz);

    // Query directly to avoid relying on a pre-installed RPC function and to keep the definition
    // of "due today" consistent with the configured timezone.
    const { data, error } = await this.supabase
      .from("student_progress")
      .select(
        `
        user_id,
        next_review_date,
        profiles!inner (
          email,
          full_name
        )
      `,
      )
      .or(`next_review_date.is.null,next_review_date.lte.${today}`);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      user_id: string;
      next_review_date: string | null;
      profiles: { email: string | null; full_name: string | null } | Array<unknown>;
    }>;

    const byEmail = new Map<string, UserPendingReviewRow>();

    for (const r of rows) {
      const profile = Array.isArray(r.profiles) ? null : r.profiles;
      const email = profile?.email?.trim() ?? "";
      if (!email) continue;

      const name = profile?.full_name?.trim() ? profile.full_name.trim() : "Student";
      const existing = byEmail.get(email);
      if (existing) {
        existing.pendingCount += 1;
      } else {
        byEmail.set(email, { email, name, pendingCount: 1 });
      }
    }

    return Array.from(byEmail.values());
  }
}
