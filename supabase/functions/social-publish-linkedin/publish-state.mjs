export function buildPublishedPostUpdate(post, actorId, postUrn, publishedUrl, publishedAt = new Date().toISOString()) {
  const update = {
    status: "published",
    published_urn: postUrn,
    published_url: publishedUrl,
    last_error: null,
  };
  if (post.status === "approved") {
    update.approved_at = publishedAt;
    update.approved_by = actorId;
  }
  return update;
}
