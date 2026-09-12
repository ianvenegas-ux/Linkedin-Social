# Lili Social GitHub Pages Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Lili Social browser application on GitHub Pages, backed directly by the existing managed Supabase project, without requiring an OpenAI login.

**Architecture:** Keep `worker/index.js` as the single source for the browser UI, but make its generated HTML transport-configurable. The legacy Worker continues to render proxy-mode HTML for rollback; a Node build script renders direct-Supabase HTML for Pages. GitHub Actions injects only the Supabase URL and publishable key while building and deploys the generated static directory.

**Tech Stack:** Vanilla browser JavaScript, Node.js ESM build/validation scripts, GitHub Actions, GitHub Pages, Supabase Auth/PostgREST/Storage/Edge Functions.

**Spec:** `docs/superpowers/specs/2026-09-12-lili-social-github-pages-design.md`

## Global Constraints

- Keep the existing Supabase project `qjvaqxjmxydqjrcwuavp`; do not add tables, migrations, RLS changes, or users.
- Do not create, log, commit, or expose a service-role key, LinkedIn credential, OAuth secret, database password, or access token.
- The static runtime may contain only `SUPABASE_URL` and the Supabase publishable key supplied by GitHub Actions.
- Preserve the existing editor, drafts, scheduling, crop UI, storage, Edge Function, and LinkedIn publication behavior.
- Preserve `social-publish-linkedin` JWT verification and do not publish test content to LinkedIn.
- Keep the current Worker proxy functional as a rollback path until the Pages acceptance run succeeds.
- Do not enable GitHub Pages, change DNS, or update Supabase Auth URL Configuration without repository access and Ian's approval of those external settings.
- Run `npm test`, `npm run validate:pages`, and `git diff --check` before every implementation commit.

---

## File Structure

- Modify `worker/index.js`: expose a configurable HTML renderer; direct mode rewrites `/api/*` calls to Supabase, adds publishable-key headers, and computes a project-site-safe recovery redirect URL.
- Modify `worker/auth.test.mjs`: retain proxy regression coverage and add direct-mode assertions for Auth endpoints, headers, and project-path recovery redirects.
- Modify `worker/routing.test.mjs`: retain the Worker proxy test and add generated-direct-runtime routing assertions.
- Create `scripts/build-pages.mjs`: render `dist-pages/index.html` from the exported HTML renderer using build-time environment values.
- Create `scripts/validate-pages-artifact.mjs`: verify a Pages artifact contains resolved public configuration, direct Supabase routes, and no unresolved placeholders or restricted credential markers.
- Create `scripts/pages-build.test.mjs`: build a temporary artifact with synthetic public values and assert the static output's direct transport contract.
- Modify `package.json`: expose Pages build and validation commands and include the Pages regression test in the test suite.
- Create `.github/workflows/deploy-pages.yml`: build and deploy only `dist-pages` through the official GitHub Pages Actions flow, with the public Supabase values read from repository secrets at build time.
- Create `docs/migration/lili-social-github-pages-runbook.md`: give the owner the exact post-push Pages, Supabase Auth, optional domain, and acceptance steps.

## Task 1: Transport-configurable browser runtime

**Files:**
- Modify: `worker/index.js`
- Test: `worker/auth.test.mjs`
- Test: `worker/routing.test.mjs`

**Interfaces:**
- Produces: `renderAppHtml({ supabaseUrl, publishableKey, transport }) => string`, where `transport` is either `"proxy"` or `"direct"`.
- Produces: browser constants `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `LILI_TRANSPORT`, resolved into generated HTML.
- Consumes: existing Worker `fetch(request, env)` and its same-origin proxy mapping.

- [ ] **Step 1: Write failing direct-runtime assertions**

Extend `worker/auth.test.mjs` to import `renderAppHtml`, generate direct HTML with `https://project.supabase.co` and `test-publishable-key`, and assert the output contains the resolved URL/key, `LILI_TRANSPORT = "direct"`, `/auth/v1/token`, `/auth/v1/recover`, `/auth/v1/user`, and `redirect_to: applicationRoot()`.

Extend `worker/routing.test.mjs` to assert direct HTML maps each existing prefix as follows:

```js
assert.match(directHtml, /"\/api\/rest"\s*:\s*"\/rest"/);
assert.match(directHtml, /"\/api\/storage"\s*:\s*"\/storage"/);
assert.match(directHtml, /"\/api\/functions"\s*:\s*"\/functions\/v1"/);
assert.match(directHtml, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node worker/auth.test.mjs; if ($LASTEXITCODE -eq 0) { node worker/routing.test.mjs }`

Expected: FAIL because `renderAppHtml` and direct runtime constants do not yet exist.

- [ ] **Step 3: Add the renderer and direct request adapter**

In `worker/index.js`, replace the fixed enhanced HTML constant with an exported renderer whose configuration is interpolated through three unique source placeholders:

```js
export function renderAppHtml({ supabaseUrl = "", publishableKey = "", transport = "proxy" } = {}) {
  return ENHANCED_APP_TEMPLATE
    .replaceAll("__LILI_SUPABASE_URL__", supabaseUrl)
    .replaceAll("__LILI_SUPABASE_PUBLISHABLE_KEY__", publishableKey)
    .replaceAll("__LILI_TRANSPORT__", transport);
}
```

Inside the browser script, define a direct route map and a helper that preserves proxy mode but uses the Supabase origin in direct mode:

```js
const DIRECT_ROUTE_MAP = {
  "/api/auth/login": "/auth/v1/token",
  "/api/auth/recover": "/auth/v1/recover",
  "/api/auth/user": "/auth/v1/user",
  "/api/rest": "/rest",
  "/api/storage": "/storage",
  "/api/functions": "/functions/v1",
};

function endpoint(path) {
  const apiPath = path.startsWith("/api/") ? path : "/api" + path;
  if (LILI_TRANSPORT !== "direct") return apiPath;
  const match = Object.keys(DIRECT_ROUTE_MAP).find(prefix => apiPath === prefix || apiPath.startsWith(prefix + "/"));
  const directPath = match ? DIRECT_ROUTE_MAP[match] + apiPath.slice(match.length) : apiPath;
  return SUPABASE_URL.replace(/\/$/, "") + directPath;
}

function requestHeaders(extra = {}) {
  return { apikey: SUPABASE_PUBLISHABLE_KEY, ...apiHeaders(extra) };
}

function applicationRoot() {
  return new URL("./", window.location.href).href;
}
```

Use `endpoint()` in generic REST/Storage calls and the login, recovery, current-user, password-update, and Edge Function calls. Use `requestHeaders()` for all direct requests, adding the anonymous `Authorization: Bearer <publishable key>` only for login and recovery when there is no user bearer token. Keep `credentials: "same-origin"` only in proxy mode; omit it in direct mode. Resolve relative signed storage URLs against `${SUPABASE_URL}/storage/v1` in direct mode.

Change the Worker root response to:

```js
return new Response(renderAppHtml({
  supabaseUrl: env.SUPABASE_URL || FALLBACK_SUPABASE_URL,
  transport: "proxy",
}), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
```

Do not change the Worker proxy routes or its server-side key handling.

- [ ] **Step 4: Run focused tests and the full suite**

Run: `npm test`

Expected: all existing regression tests pass, including the direct-mode assertions and the legacy Worker Edge Function forwarding assertion.

- [ ] **Step 5: Commit the transport layer**

```bash
git add worker/index.js worker/auth.test.mjs worker/routing.test.mjs
git commit -m "feat: add direct Supabase transport for Pages"
```

## Task 2: Deterministic Pages artifact build and validation

**Files:**
- Create: `scripts/build-pages.mjs`
- Create: `scripts/validate-pages-artifact.mjs`
- Create: `scripts/pages-build.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `renderAppHtml({ supabaseUrl, publishableKey, transport: "direct" })` from `worker/index.js`.
- Produces: `dist-pages/index.html`.
- Produces: `npm run build:pages`, `npm run validate:pages`, and a test that safely uses only synthetic configuration.

- [ ] **Step 1: Write the failing Pages build regression test**

Create `scripts/pages-build.test.mjs` that invokes the exported build function with this configuration and a temporary output directory:

```js
const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "lili-pages-"));
await buildPages({
  outputDir,
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "test-publishable-key",
});
const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
assert.match(html, /https:\/\/project\.supabase\.co/);
assert.match(html, /test-publishable-key/);
assert.match(html, /LILI_TRANSPORT = "direct"/);
assert.doesNotMatch(html, /__LILI_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|TRANSPORT)__/);
```

Remove only that exact temporary directory in a `finally` block.

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `node scripts/pages-build.test.mjs`

Expected: FAIL because the Pages build module and command do not exist.

- [ ] **Step 3: Implement the static builder and validator**

Create `scripts/build-pages.mjs` with `buildPages({ outputDir = "dist-pages", supabaseUrl = process.env.SUPABASE_URL, publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY } = {})`. It must reject a missing or non-HTTPS Supabase URL and a missing key, remove only the resolved `outputDir`, create it, write `index.html` using `renderAppHtml`, and return its absolute path. Invoke `buildPages()` only when the module is executed directly.

Create `scripts/validate-pages-artifact.mjs` to read `dist-pages/index.html` and fail if any interpolation placeholder remains, if `LILI_TRANSPORT = "direct"` is absent, if `service_role`, `LINKEDIN_`, `SUPABASE_DB_`, or `OPENAI_API_KEY` appears, or if the expected direct endpoints `/auth/v1/token`, `/rest/v1/`, `/storage/v1`, and `/functions/v1/social-publish-linkedin` are absent.

Add these scripts to `package.json`:

```json
"build:pages": "node scripts/build-pages.mjs",
"validate:pages": "node scripts/validate-pages-artifact.mjs",
"test": "node scripts/pages-build.test.mjs && node worker/workflow.test.mjs && ..."
```

The test command includes the new test before the existing test sequence.

- [ ] **Step 4: Prove build, validation, and test behavior**

Run:

```powershell
$env:SUPABASE_URL = 'https://project.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
npm run build:pages
npm run validate:pages
npm test
```

Expected: `dist-pages/index.html` exists, validation reports success, and all regression tests pass. Do not commit `dist-pages`.

- [ ] **Step 5: Commit the Pages build toolchain**

```bash
git add package.json scripts/build-pages.mjs scripts/validate-pages-artifact.mjs scripts/pages-build.test.mjs
git commit -m "build: add GitHub Pages artifact pipeline"
```

## Task 3: GitHub Pages deployment workflow

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Test: `scripts/validate-pages-artifact.mjs`

**Interfaces:**
- Consumes: repository Actions secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- Consumes: `npm run build:pages` and `npm run validate:pages`.
- Produces: a GitHub Pages deployment artifact containing only `dist-pages`.

- [ ] **Step 1: Write a workflow-content regression assertion**

Add assertions in `scripts/pages-build.test.mjs` that read `.github/workflows/deploy-pages.yml` and require:

```js
assert.match(workflow, /actions\/configure-pages@v5/);
assert.match(workflow, /actions\/upload-pages-artifact@v3/);
assert.match(workflow, /actions\/deploy-pages@v4/);
assert.match(workflow, /SUPABASE_URL:\s*\$\{\{ secrets\.SUPABASE_URL \}\}/);
assert.match(workflow, /SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|LINKEDIN_/);
```

- [ ] **Step 2: Run the regression test and confirm it fails**

Run: `node scripts/pages-build.test.mjs`

Expected: FAIL because `.github/workflows/deploy-pages.yml` does not exist.

- [ ] **Step 3: Add a minimal Pages workflow**

Create `.github/workflows/deploy-pages.yml` with this exact deployment contract:

```yaml
name: Deploy Lili Social to GitHub Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - run: npm run build:pages
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}
      - run: npm run validate:pages
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist-pages
      - id: deployment
        uses: actions/deploy-pages@v4
```

Do not specify a custom domain, a `CNAME` file, a service-role key, or LinkedIn credentials in this workflow.

- [ ] **Step 4: Run all local verification**

Run: `npm test; $env:SUPABASE_URL = 'https://project.supabase.co'; $env:SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'; npm run build:pages; npm run validate:pages; git diff --check`

Expected: all checks exit successfully. This validates workflow shape and artifact contents without enabling or deploying Pages.

- [ ] **Step 5: Commit the deployment workflow**

```bash
git add .github/workflows/deploy-pages.yml scripts/pages-build.test.mjs
git commit -m "ci: deploy static Lili Social app to Pages"
```

## Task 4: Owner configuration and acceptance runbook

**Files:**
- Create: `docs/migration/lili-social-github-pages-runbook.md`

**Interfaces:**
- Consumes: the deployed Pages URL emitted by the GitHub Actions workflow.
- Consumes: Supabase Auth URL Configuration and existing LinkedIn OAuth function callback.
- Produces: a no-secret operator checklist for enabling the deployment and validating `ian@liliantrade.com`.

- [ ] **Step 1: Write the runbook with exact external configuration steps**

Document these ordered actions:

1. Push the commits to the existing private GitHub repository and enable GitHub Pages with source set to GitHub Actions.
2. Add Actions secrets `SUPABASE_URL=https://qjvaqxjmxydqjrcwuavp.supabase.co` and the existing **publishable** Supabase key; never use a service-role key.
3. Run the workflow once and record the repository Pages URL.
4. In Supabase Auth URL Configuration, add that exact Pages URL (including its project subpath and trailing slash when GitHub provides one) to Redirect URLs; keep the current OpenAI URL for rollback.
5. Sign in as `ian@liliantrade.com`; verify drafts, materials, save a draft, logout, password-recovery return path, and the existing published post.
6. Only after those checks, optionally configure `social.liliantrade.com` in GitHub Pages and DNS, add it to Supabase Redirect URLs, and repeat acceptance.
7. Leave LinkedIn Developers unchanged unless `LINKEDIN_REDIRECT_URI` or the registered LinkedIn redirect URI is not the existing Supabase `linkedin-oauth-callback` function URL.

Include a rollback: disable the Pages workflow or revert its commit, leave the existing Worker deployment live, and remove only the unused Pages redirect URL after confirming the legacy app works.

- [ ] **Step 2: Check the runbook for accidental secrets and prohibited actions**

Run: `rg -n -i "service.role|linkedin.*(secret|token)|database password|create user|publish test" docs/migration/lili-social-github-pages-runbook.md`

Expected: matches may appear only in explicit prohibitions; the document contains no actual credential values beyond the public project URL and no instruction to create an account or publish content.

- [ ] **Step 3: Run final repository checks**

Run: `npm test; $env:SUPABASE_URL = 'https://project.supabase.co'; $env:SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'; npm run build:pages; npm run validate:pages; git diff --check`

Expected: every command exits successfully.

- [ ] **Step 4: Commit the operational handoff**

```bash
git add docs/migration/lili-social-github-pages-runbook.md
git commit -m "docs: add GitHub Pages migration runbook"
```

## Task 5: Final implementation review

**Files:**
- Review: `worker/index.js`
- Review: `scripts/build-pages.mjs`
- Review: `scripts/validate-pages-artifact.mjs`
- Review: `.github/workflows/deploy-pages.yml`
- Review: `docs/migration/lili-social-github-pages-runbook.md`

- [ ] **Step 1: Check spec coverage**

Verify the implementation contains a static Pages artifact, direct Supabase transport, publishable-key-only injection, preserved legacy proxy, project-path-safe recovery redirects, no LinkedIn OAuth change, no database/RLS change, no automatic publication, and no DNS or Pages state change performed locally.

- [ ] **Step 2: Scan tracked implementation files for restricted credential names**

Run: `rg -n -i "SUPABASE_SERVICE_ROLE_KEY|service_role|LINKEDIN_CLIENT_SECRET|LINKEDIN_ACCESS_TOKEN|OPENAI_API_KEY" worker scripts .github docs/migration`

Expected: only explicit validator/runbook prohibitions may match; no value assignment or request header must use a restricted credential.

- [ ] **Step 3: Run the complete verification sequence**

Run: `npm test; $env:SUPABASE_URL = 'https://project.supabase.co'; $env:SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'; npm run build:pages; npm run validate:pages; git diff --check; git status --short`

Expected: tests, build, validation, and diff check pass; generated `dist-pages/` is ignored or removed before the handoff, and only intentional implementation commits are present.

- [ ] **Step 4: Report external actions that remain owner-gated**

Report that pushing to the private GitHub repository, enabling GitHub Pages, adding the two public build secrets, and adding the exact deployed URL to Supabase Auth Redirect URLs require repository/dashboard access. State that LinkedIn Developers needs no change unless its existing redirect is not the Supabase callback.
