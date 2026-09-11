import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const jobsRls = fs.readFileSync(new URL("../supabase/migrations/20260911080325_social_publication_jobs_rls.sql", import.meta.url), "utf8");
assert.match(source, /async function processDueJobs\(\)/, "due publication processing must exist");
const processStart = source.indexOf("async function processDueJobs()");
const processEnd = source.indexOf("function renderRecentPosts", processStart);
const processBody = source.slice(processStart, processEnd);
assert.match(processBody, /social_publication_jobs/, "scheduler must use publication jobs");
assert.match(processBody, /queue_state.*processing/, "scheduler must claim queued jobs");
assert.match(processBody, /queue_state.*completed/, "scheduler must complete successful jobs");
assert.match(jobsRls, /create policy\s+"social_jobs_admin_insert"/i, "publication jobs must allow admin inserts");
assert.match(jobsRls, /for insert\s+to authenticated/i, "publication job inserts must be limited to authenticated users");
assert.match(jobsRls, /create policy\s+"social_jobs_admin_update"/i, "publication jobs must allow admin updates");
assert.match(jobsRls, /for update\s+to authenticated/i, "publication job updates must be limited to authenticated users");
console.log("scheduled publication processing test passed");
