import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");

assert.match(source, /\/api\/auth\/recover/, "the worker must proxy password recovery");
assert.match(source, /async function requestPasswordReset\(/, "the UI must request a recovery email");
assert.match(source, /async function updatePassword\(/, "the UI must update the password from a recovery link");
assert.match(source, /¿Olvidaste|Restablecer contraseña/, "the login must expose password recovery");
assert.match(
  source,
  /targetPath === "\/auth\/v1\/token" \|\| targetPath === "\/auth\/v1\/recover"[\s\S]*headers\.set\("Authorization", "Bearer " \+ key\)/,
  "login and recovery must forward the Supabase anonymous authorization key",
);
console.log("auth recovery regression test passed");
