-- Publication jobs are managed by the authenticated admin dashboard.
-- The existing SELECT policy remains in place; these policies cover queue writes.

create policy "social_jobs_admin_insert"
on public.social_publication_jobs
for insert
to authenticated
with check ((select public.social_is_admin()));

create policy "social_jobs_admin_update"
on public.social_publication_jobs
for update
to authenticated
using ((select public.social_is_admin()))
with check ((select public.social_is_admin()));
