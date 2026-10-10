import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toLinkedinLittleText } from "./little-text.mjs";

// Background queue worker for Lili Social. Invoked on a schedule (pg_cron ->
// social_publish_dispatch() -> net.http_post) with no human in the loop, so
// auth is a shared-secret header (X-Notification-Secret, reusing the same
// project secret NOTIFICATIONS_WEBHOOK_SECRET already used by send-notification),
// not a user JWT like the admin-triggered social-publish-linkedin function.
// Only picks up social_publication_jobs rows with queue_state='queued' and a
// due_at in the past - jobs left 'failed' after exhausting retries are NOT
// auto-retried here, they need explicit human attention (or the "publish now"
// admin action once the frontend supports requeuing them).
//
// Deployed directly to Supabase (verify_jwt=false); this copy in the repo is
// the source of truth from 2026-10-10 on.

const ORG_ID = "71060641";
const ORG_URN = `urn:li:organization:${ORG_ID}`;
const LINKEDIN_VERSION = Deno.env.get("LINKEDIN_VERSION")?.trim() || "202608";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_HOST_SUFFIXES = [".supabase.co", ".sharepoint.com", ".1drv.com", ".onedrive.live.com", ".1drv.ms"];
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 15;
const BATCH_LIMIT = 5;
const MEDIA_BUCKET = "project_files";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function linkedinHeaders(token: string, contentType = "application/json") {
  return {
    Authorization: `Bearer ${token}`,
    "Linkedin-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": contentType,
  };
}

function allowedImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

// cached_storage_path may already be a full https URL (older rows) or a bare
// path inside the private "project_files" storage bucket (the same bucket and
// path the composer's own signedUrl() helper uses) - sign it so LinkedIn's
// servers can fetch it directly.
async function resolveImageUrl(admin: ReturnType<typeof createClient>, rawPath: string | null): Promise<string | null> {
  if (!rawPath) return null;
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  const cleanPath = rawPath.replace(/^\/+/, "");
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(cleanPath, 3600);
  if (error || !data?.signedUrl) throw new Error(`Could not sign media path: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}

async function fetchImage(sourceUrl: string) {
  if (!allowedImageUrl(sourceUrl)) {
    throw new Error("image_url must be an HTTPS URL from approved media storage");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(sourceUrl, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`image source returned HTTP ${response.status}`);
    if (!allowedImageUrl(response.url)) throw new Error("image source redirected to an unapproved host");
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/gif"].includes(contentType)) {
      throw new Error("image must be JPG, PNG, or GIF");
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("image is larger than 20 MB");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image is larger than 20 MB");
    return { bytes, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

async function initializeImageUpload(token: string, owner: string) {
  const response = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: linkedinHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.value?.uploadUrl || !data?.value?.image) {
    throw new Error(`LinkedIn image initialization failed (HTTP ${response.status})`);
  }
  return { uploadUrl: data.value.uploadUrl as string, imageUrn: data.value.image as string };
}

async function uploadImage(token: string, uploadUrl: string, bytes: Uint8Array, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: bytes,
  });
  if (!response.ok) throw new Error(`LinkedIn image upload failed (HTTP ${response.status})`);
}

async function createPost(token: string, commentary: string, imageUrn: string | null, altText: string | null, author: string) {
  const post: Record<string, unknown> = {
    author,
    commentary: toLinkedinLittleText(commentary),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageUrn) {
    post.content = { media: { id: imageUrn, ...(altText ? { altText } : {}) } };
  }
  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: linkedinHeaders(token),
    body: JSON.stringify(post),
  });
  const responseText = await response.text();
  let responseJson: Record<string, unknown> | null = null;
  try { responseJson = responseText ? JSON.parse(responseText) : null; } catch { /* not json */ }
  const postUrn = response.headers.get("x-restli-id") ||
    (typeof responseJson?.id === "string" ? responseJson.id : null);
  if (!response.ok || !postUrn) {
    throw new Error(`LinkedIn post creation failed (HTTP ${response.status})`);
  }
  return postUrn;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(null, 204);
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const expected = Deno.env.get("NOTIFICATIONS_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-notification-secret") !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "Server configuration is incomplete" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();
  const { data: due, error: dueError } = await admin
    .from("social_publication_jobs")
    .select("id, post_id, attempt_count")
    .eq("queue_state", "queued")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (dueError) return json({ ok: false, error: dueError.message }, 500);

  let published = 0, retried = 0, failed = 0, skipped = 0;
  const details: Record<string, unknown>[] = [];

  for (const job of due ?? []) {
    const { data: claimedJob } = await admin
      .from("social_publication_jobs")
      .update({ queue_state: "processing", last_attempt_at: nowIso })
      .eq("id", job.id)
      .eq("queue_state", "queued")
      .select("id, post_id, attempt_count")
      .maybeSingle();
    if (!claimedJob) { skipped++; continue; }

    try {
      const { data: post, error: postError } = await admin
        .from("social_posts")
        .select("id,body,status,current_version,social_account_id,published_urn,published_url")
        .eq("id", claimedJob.post_id)
        .maybeSingle();
      if (postError || !post) throw new Error("Social post not found");

      if (post.published_urn) {
        await admin.from("social_publication_jobs")
          .update({ queue_state: "completed", completed_at: nowIso })
          .eq("id", claimedJob.id);
        published++;
        details.push({ post_id: post.id, result: "already_published" });
        continue;
      }
      if (!["approved", "scheduled"].includes(post.status)) {
        throw new Error(`Post status '${post.status}' is not publishable`);
      }

      const { data: approval } = await admin
        .from("social_approvals")
        .select("id")
        .eq("post_id", post.id)
        .eq("version_number", post.current_version)
        .eq("decision", "approved")
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!approval) throw new Error("The current post version has no human approval");

      const { data: account, error: accountError } = await admin
        .from("social_accounts")
        .select("id,enabled,account_type,organization_id,connection_id")
        .eq("id", post.social_account_id)
        .maybeSingle();
      if (accountError || !account) throw new Error("The post's LinkedIn account could not be found");
      if (account.account_type === "organization" && account.organization_id !== ORG_ID) {
        throw new Error("The post is not bound to the Lilian Trade organization");
      }
      if (account.account_type !== "organization" && account.account_type !== "member") {
        throw new Error("Unsupported LinkedIn account type");
      }
      if (!account.enabled) {
        throw new Error("This LinkedIn account is disabled until it is (re)connected with the right permission");
      }

      const { data: connection, error: connectionError } = await admin
        .from("linkedin_connections")
        .select("access_token,scope,account_urn")
        .eq("id", account.connection_id)
        .maybeSingle();
      if (connectionError || !connection?.access_token) throw new Error("LinkedIn connection is unavailable");
      const requiredScope = account.account_type === "member" ? "w_member_social" : "w_organization_social";
      if (!new RegExp(`(^|[,\\s])${requiredScope}([,\\s]|$)`).test(String(connection.scope || ""))) {
        throw new Error(`LinkedIn permission is missing for this account (needs ${requiredScope})`);
      }

      const authorUrn = account.account_type === "member" ? connection.account_urn : ORG_URN;
      if (!authorUrn) throw new Error("This LinkedIn account has no identity on file yet - reconnect it");

      const { data: mediaRows } = await admin
        .from("social_media")
        .select("cached_storage_path, alt_text")
        .eq("post_id", post.id)
        .order("display_order", { ascending: true })
        .limit(1);
      const firstMedia = mediaRows?.[0] ?? null;
      const imageUrl = await resolveImageUrl(admin, firstMedia?.cached_storage_path ?? null);

      const { data: claimedPost } = await admin
        .from("social_posts")
        .update({ status: "publishing", last_error: null })
        .eq("id", post.id)
        .in("status", ["approved", "scheduled"])
        .is("published_urn", null)
        .select("id")
        .maybeSingle();
      if (!claimedPost) throw new Error("Post is already being published or has changed");

      let imageUrn: string | null = null;
      if (imageUrl) {
        const image = await fetchImage(imageUrl);
        const upload = await initializeImageUpload(connection.access_token, authorUrn);
        await uploadImage(connection.access_token, upload.uploadUrl, image.bytes, image.contentType);
        imageUrn = upload.imageUrn;
      }

      const postUrn = await createPost(connection.access_token, post.body, imageUrn, firstMedia?.alt_text ?? null, authorUrn);
      const publishedUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`;
      const publishedAt = new Date().toISOString();

      // social_jobs_validate requires the post to be status='scheduled' on any
      // write to social_publication_jobs, so the job must be marked completed
      // while the post still reads "scheduled" (set by the earlier claim's
      // status="publishing" being reverted here first) - not after the post is
      // flipped to "published", or the trigger silently rejects that update.
      await admin.from("social_posts").update({ status: "scheduled" }).eq("id", post.id);
      const { error: jobCompleteError } = await admin.from("social_publication_jobs").update({
        queue_state: "completed",
        completed_at: publishedAt,
        provider_response: { post_urn: postUrn },
      }).eq("id", claimedJob.id);
      if (jobCompleteError) console.error("social_publish_worker_complete_update_failed", { jobId: claimedJob.id, message: jobCompleteError.message });

      const postUpdate: Record<string, unknown> = {
        status: "published",
        published_urn: postUrn,
        published_url: publishedUrl,
        last_error: null,
      };
      if (post.status === "approved") {
        postUpdate.approved_at = publishedAt;
      }
      const { error: publishedUpdateError } = await admin.from("social_posts").update(postUpdate).eq("id", post.id);
      if (publishedUpdateError) {
        throw new Error(`LinkedIn published the post, but its state could not be persisted: ${publishedUpdateError.message}`);
      }

      const { error: linkedinLogError } = await admin.from("linkedin_posts").insert({
        commentary: post.body,
        alt_text: firstMedia?.alt_text ?? null,
        image_source_host: imageUrl ? new URL(imageUrl).hostname : null,
        linkedin_image_urn: imageUrn,
        linkedin_post_urn: postUrn,
        status: "published",
        published_at: publishedAt,
      });
      if (linkedinLogError) {
        console.error("linkedin_post_audit_error", { postId: post.id, message: linkedinLogError.message });
      }

      published++;
      details.push({ post_id: post.id, result: "published", published_url: publishedUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected publication error";
      const nextAttempt = (claimedJob.attempt_count ?? 0) + 1;
      // social_jobs_validate (a trigger on social_publication_jobs) requires the
      // referenced post to be status='scheduled' on every insert/update of this
      // table. The claim step above may have already moved the post to
      // "publishing", so it must be un-claimed back to "scheduled" BEFORE this
      // job row is touched again, or the trigger silently rejects the update
      // (Postgres raises, PostgREST returns an error object, supabase-js does
      // NOT throw on it) and the job is left stuck in "processing" forever.
      const { error: revertError } = await admin
        .from("social_posts")
        .update({ status: "scheduled", last_error: message })
        .eq("id", claimedJob.post_id)
        .eq("status", "publishing");
      if (revertError) console.error("social_publish_worker_revert_failed", { postId: claimedJob.post_id, message: revertError.message });
      if (nextAttempt < MAX_ATTEMPTS) {
        const { error: jobUpdateError } = await admin.from("social_publication_jobs").update({
          queue_state: "queued",
          attempt_count: nextAttempt,
          last_error: message,
          due_at: new Date(Date.now() + RETRY_DELAY_MINUTES * 60_000).toISOString(),
        }).eq("id", claimedJob.id);
        if (jobUpdateError) console.error("social_publish_worker_retry_update_failed", { jobId: claimedJob.id, message: jobUpdateError.message });
        retried++;
        details.push({ post_id: claimedJob.post_id, result: "retry_scheduled", error: message });
      } else {
        const { error: jobUpdateError } = await admin.from("social_publication_jobs").update({
          queue_state: "failed",
          attempt_count: nextAttempt,
          last_error: message,
        }).eq("id", claimedJob.id);
        if (jobUpdateError) console.error("social_publish_worker_failed_update_failed", { jobId: claimedJob.id, message: jobUpdateError.message });
        await admin.from("social_posts").update({ status: "failed", last_error: message }).eq("id", claimedJob.post_id);
        failed++;
        details.push({ post_id: claimedJob.post_id, result: "failed", error: message });
      }
    }
  }

  return json({ ok: true, processed: (due ?? []).length, published, retried, failed, skipped, details });
});
