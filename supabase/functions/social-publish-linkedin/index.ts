import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPublishedPostUpdate } from "./publish-state.mjs";

// The Lilian Trade organization page - still the only organization account
// that exists, so this stays a fixed identity check. A `social_accounts` row
// with account_type="member" (e.g. someone's personal profile) has no
// organization_id at all; its identity comes from its own linkedin_connections
// row instead (account_urn, resolved at OAuth time as urn:li:person:{sub}).
const ORG_ID = "71060641";
const ORG_URN = `urn:li:organization:${ORG_ID}`;
const LINKEDIN_VERSION = Deno.env.get("LINKEDIN_VERSION")?.trim() || "202608";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_HOST_SUFFIXES = [".supabase.co", ".sharepoint.com", ".1drv.com", ".onedrive.live.com", ".1drv.ms"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function errorResponse(message: string, status: number, details?: unknown) {
  console.error("social_publish_error", { message, details });
  return json({ ok: false, error: message }, status);
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
    commentary,
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
  try { responseJson = responseText ? JSON.parse(responseText) : null; } catch {}
  const postUrn = response.headers.get("x-restli-id") ||
    (typeof responseJson?.id === "string" ? responseJson.id : null);
  if (!response.ok || !postUrn) {
    throw new Error(`LinkedIn post creation failed (HTTP ${response.status})`);
  }
  return postUrn;
}

async function requireAdmin(req: Request, supabaseUrl: string, publicKey: string, admin: ReturnType<typeof createClient>) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Authorization header is required");
  const userClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) throw new Error("Authenticated user could not be verified");
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin") throw new Error("Administrator permission is required");
  return user.id;
}

// account_type="organization" always posts as the Lilian Trade page (ORG_URN).
// account_type="member" posts as whoever connected that row personally - their
// identity lives on the connection itself (account_urn), never hardcoded,
// because unlike the single organization there can be more than one member
// account over time.
function requiredScopeFor(accountType: string) {
  return accountType === "member" ? "w_member_social" : "w_organization_social";
}

function scopeIncludes(scope: string, wanted: string) {
  return new RegExp(`(^|[,\\s])${wanted}([,\\s]|$)`).test(scope);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(null, 204);
  if (req.method !== "POST") return errorResponse("Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !serviceRoleKey || !publicKey) {
    return errorResponse("Server configuration is incomplete", 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const actorId = await requireAdmin(req, supabaseUrl, publicKey, admin);
    const input = await req.json().catch(() => null);
    const postId = typeof input?.post_id === "string" ? input.post_id.trim() : "";
    const imageUrl = typeof input?.image_url === "string" ? input.image_url.trim() : "";
    if (!postId) return errorResponse("post_id is required", 400);

    const { data: post, error: postError } = await admin
      .from("social_posts")
      .select("id,body,status,current_version,social_account_id,published_urn,published_url")
      .eq("id", postId)
      .maybeSingle();
    if (postError || !post) return errorResponse("Social post not found", 404);

    if (post.published_urn) {
      return json({ ok: true, status: "published", post_urn: post.published_urn, published_url: post.published_url });
    }
    if (!["approved", "scheduled"].includes(post.status)) {
      return errorResponse("Only an approved or scheduled post can be published", 409);
    }

    const { data: approval } = await admin
      .from("social_approvals")
      .select("id,decided_by,decided_at")
      .eq("post_id", post.id)
      .eq("version_number", post.current_version)
      .eq("decision", "approved")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!approval) return errorResponse("The current post version has no human approval", 409);

    const { data: account, error: accountError } = await admin
      .from("social_accounts")
      .select("id,enabled,account_type,organization_id,connection_id")
      .eq("id", post.social_account_id)
      .maybeSingle();
    if (accountError || !account) {
      return errorResponse("The post's LinkedIn account could not be found", 409);
    }
    if (account.account_type === "organization" && account.organization_id !== ORG_ID) {
      return errorResponse("The post is not bound to the Lilian Trade organization", 409);
    }
    if (account.account_type !== "organization" && account.account_type !== "member") {
      return errorResponse("Unsupported LinkedIn account type", 409);
    }
    if (!account.enabled) {
      return errorResponse("This LinkedIn account is disabled until it is (re)connected with the right permission", 409);
    }

    const { data: connection, error: connectionError } = await admin
      .from("linkedin_connections")
      .select("access_token,scope,account_urn")
      .eq("id", account.connection_id)
      .maybeSingle();
    if (connectionError || !connection?.access_token) return errorResponse("LinkedIn connection is unavailable", 409);
    const requiredScope = requiredScopeFor(account.account_type);
    if (!scopeIncludes(String(connection.scope || ""), requiredScope)) {
      return errorResponse(`LinkedIn permission is missing for this account (needs ${requiredScope})`, 409);
    }

    const authorUrn = account.account_type === "member" ? connection.account_urn : ORG_URN;
    if (!authorUrn) {
      return errorResponse("This LinkedIn account has no identity on file yet - reconnect it", 409);
    }

    const { count: mediaCount } = await admin
      .from("social_media")
      .select("id", { count: "exact", head: true })
      .eq("post_id", post.id);
    if ((mediaCount || 0) > 0 && !imageUrl) {
      return errorResponse("image_url is required for this post's media", 400);
    }

    const { data: claimed, error: claimError } = await admin
      .from("social_posts")
      .update({ status: "publishing", last_error: null })
      .eq("id", post.id)
      .in("status", ["approved", "scheduled"])
      .is("published_urn", null)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) return errorResponse("Post is already being published or has changed", 409);

    let imageUrn: string | null = null;
    try {
      if (imageUrl) {
        const image = await fetchImage(imageUrl);
        const upload = await initializeImageUpload(connection.access_token, authorUrn);
        await uploadImage(connection.access_token, upload.uploadUrl, image.bytes, image.contentType);
        imageUrn = upload.imageUrn;
      }

      const postUrn = await createPost(
        connection.access_token,
        post.body,
        imageUrn,
        typeof input?.alt_text === "string" ? input.alt_text.trim() : null,
        authorUrn,
      );
      const publishedUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`;
      const publishedAt = new Date().toISOString();
      const { error: publishedUpdateError } = await admin
        .from("social_posts")
        .update(buildPublishedPostUpdate(post, actorId, postUrn, publishedUrl, publishedAt))
        .eq("id", post.id);
      if (publishedUpdateError) {
        throw new Error(`LinkedIn published the post, but its state could not be persisted: ${publishedUpdateError.message}`);
      }

      const { error: linkedinLogError } = await admin.from("linkedin_posts").insert({
        commentary: post.body,
        alt_text: typeof input?.alt_text === "string" ? input.alt_text.trim() || null : null,
        image_source_host: imageUrl ? new URL(imageUrl).hostname : null,
        linkedin_image_urn: imageUrn,
        linkedin_post_urn: postUrn,
        status: "published",
        published_at: publishedAt,
      });
      if (linkedinLogError) {
        console.error("linkedin_post_audit_error", { postId: post.id, message: linkedinLogError.message });
      }

      return json({ ok: true, status: "published", post_urn: postUrn, published_url: publishedUrl }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected publication error";
      await admin.from("social_posts").update({
        status: "failed",
        last_error: message,
      }).eq("id", post.id);
      return errorResponse(message, 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected request error";
    const status = message.includes("permission") ? 403 : message.includes("Authorization") ? 401 : 400;
    return errorResponse(message, status);
  }
});
