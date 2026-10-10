import assert from "node:assert/strict";
import fs from "node:fs";
import { toLinkedinLittleText } from "./little-text.mjs";

assert.equal(
  toLinkedinLittleText("lo corremos comprimido a 4 bits (Q4), que es una forma"),
  "lo corremos comprimido a 4 bits \\(Q4\\), que es una forma",
  "parentheses must be escaped or LinkedIn truncates the post at the first one",
);
assert.equal(
  toLinkedinLittleText("a_b *c* ~d~ <e> [f] {g} h|i @j k\\l"),
  "a\\_b \\*c\\* \\~d\\~ \\<e\\> \\[f\\] \\{g\\} h\\|i \\@j k\\\\l",
  "every little-text reserved character must be escaped",
);
assert.equal(
  toLinkedinLittleText("#China #InteligenciaArtificial #ComercioExterior"),
  "{hashtag|\\#|China} {hashtag|\\#|InteligenciaArtificial} {hashtag|\\#|ComercioExterior}",
  "hashtags must use LinkedIn's hashtag template so they stay clickable",
);
assert.equal(toLinkedinLittleText("Oficina #3, piso # 2"), "Oficina {hashtag|\\#|3}, piso \\# 2", "a lone # must be escaped");
assert.equal(toLinkedinLittleText("Día de exportación: 15 GB, 64 GB."), "Día de exportación: 15 GB, 64 GB.", "plain text must be unchanged");
assert.equal(toLinkedinLittleText(null), "", "a missing body must not crash");

// The cron worker publishes scheduled posts on its own and must escape the same way.
const workerDir = new URL("../social-publish-worker/", import.meta.url);
assert.equal(
  fs.readFileSync(new URL("little-text.mjs", workerDir), "utf8"),
  fs.readFileSync(new URL("./little-text.mjs", import.meta.url), "utf8"),
  "the worker's little-text.mjs copy must match the tested one",
);
assert.match(
  fs.readFileSync(new URL("index.ts", workerDir), "utf8"),
  /commentary: toLinkedinLittleText\(commentary\)/,
  "scheduled posts must be escaped as LinkedIn little text too",
);

console.log("LinkedIn little text escaping test passed");
