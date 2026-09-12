# Lili Social: GitHub Pages migration runbook

This runbook moves the Lili Social frontend from OpenAI Sites to GitHub Pages. Supabase remains the backend and LinkedIn remains connected through its existing Supabase Edge Functions.

## Before starting

- Use the existing private GitHub repository as the source repository.
- Keep the legacy Worker deployment online until the Pages acceptance checks pass.
- Do not create users. The initial account remains `ian@liliantrade.com`.
- Do not publish a test post to LinkedIn while validating this migration.

## 1. Push and enable Pages

1. Push the commits containing the Pages workflow to the repository's `master` branch.
2. In the repository's **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
3. Do not configure a custom domain at this stage. Let the workflow deploy to the repository's default Pages URL first.

## 2. Add the build-only public configuration

In the repository's **Settings → Secrets and variables → Actions**, create these two repository secrets:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | `https://qjvaqxjmxydqjrcwuavp.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | The existing Supabase **publishable** key for this project |

The publishable key is intentionally embedded in the browser build and is not a privileged credential. Do not supply a service-role key, a LinkedIn credential, an OAuth secret, a database password, or a user access token.

## 3. Deploy once

1. Open **Actions → Deploy Lili Social to GitHub Pages**.
2. Run the workflow manually or push a commit to `master`.
3. Wait for the deploy job to complete and record the displayed Pages URL exactly, including its repository subpath and trailing slash when present.

## 4. Allow password recovery to return to Pages

In the Supabase project, open **Authentication → URL Configuration** and add the exact Pages URL from the completed workflow to **Redirect URLs**.

Keep the current OpenAI Sites URL in the allow-list temporarily. This leaves the legacy deployment usable as a rollback path while Pages is being accepted.

## 5. Acceptance checks

At the Pages URL, sign in only as `ian@liliantrade.com` and confirm:

1. The Lili Social login screen appears without a ChatGPT or OpenAI login.
2. Existing drafts and materials load.
3. The already-published post is still labelled `Publicado`.
4. A draft can be saved, then is visible after a refresh.
5. Logging out returns to the Lili Social login screen.
6. Password recovery sends an email whose return URL is the Pages URL, including the GitHub project subpath.

Do not approve or publish a LinkedIn post as part of these checks unless Ian explicitly asks to publish that specific post.

## 6. Optional custom domain: `social.liliantrade.com`

Only after the default Pages URL passes acceptance:

1. Configure `social.liliantrade.com` in GitHub Pages.
2. Configure the DNS record requested by GitHub Pages.
3. Wait for GitHub Pages HTTPS to become active.
4. Add `https://social.liliantrade.com/` to Supabase Auth Redirect URLs.
5. Repeat every acceptance check at the custom domain before retiring the legacy URL.

## LinkedIn Developers

No LinkedIn Developers change is required for GitHub Pages. OAuth continues through the existing Supabase `linkedin-oauth-callback` Edge Function. Change LinkedIn Developers only if the registered redirect URI or the `LINKEDIN_REDIRECT_URI` setting does not already point to that Supabase function URL.

## Rollback

1. Disable the Pages workflow or revert the Pages migration commits.
2. Use the existing Worker deployment, which remains intact during migration.
3. Confirm the legacy app works before removing the unused Pages Redirect URL from Supabase Auth URL Configuration.

Do not remove the existing LinkedIn OAuth callback, change LinkedIn tokens, or remove the legacy OpenAI URL from Supabase until rollback is no longer needed.
