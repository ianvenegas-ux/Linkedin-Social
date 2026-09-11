import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const saveStart = source.indexOf("async function saveDraft");
const publishStart = source.indexOf("async function publish", saveStart);
assert(saveStart >= 0 && publishStart > saveStart, "saveDraft must exist");
const saveDraft = source.slice(saveStart, publishStart);
const approvalIndex = saveDraft.indexOf("/rest/v1/social_approvals");
const approvedStatusIndex = saveDraft.indexOf('status:approve ? "approved"');
assert(approvalIndex >= 0, "approval must be persisted");
assert(approvedStatusIndex < 0 || approvalIndex < approvedStatusIndex,
  "approval must be persisted before the post enters approved/scheduled state");

console.log("approval flow regression test passed");
