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

  /**
   * Returns unique users with the number of due rows in `student_progress` whose `next_review_date`
   * (date) is NULL or <= the UTC date of “now”.
   */
  async execute(): Promise<UserPendingReviewRow[]> {
    const pNow = new Date().toISOString();

    const { data, error } = await this.supabase.rpc("get_users_with_pending_reviews", {
      p_now: pNow,
    });

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<{
      email: string;
      name: string;
      pending_count: number | string;
    }>;

    return rows.map((r) => ({
      email: r.email,
      name: r.name?.trim() ? r.name : "Student",
      pendingCount: typeof r.pending_count === "string" ? Number(r.pending_count) : r.pending_count,
    }));
  }
}
