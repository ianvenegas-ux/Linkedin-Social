# Lili Social: GitHub Pages Migration Design

## Purpose

Move Lili Social away from OpenAI Sites so `ian@liliantrade.com` can use the existing LinkedIn publishing workflow without a ChatGPT/OpenAI login. Keep the existing GitHub repository as the single source repository and use GitHub Pages to publish the frontend.

## Chosen architecture

```text
Existing GitHub repository
        |
        v
GitHub Actions -> GitHub Pages static site
        |
        | HTTPS requests with a Supabase publishable key and user JWT
        v
Managed Supabase project qjvaqxjmxydqjrcwuavp
  Auth + Postgres/RLS + Storage + Edge Functions
        |
        v
LinkedIn REST API
```

GitHub Pages serves only browser assets. Supabase remains the backend. No Node server, Docker container, reverse proxy, service-role key, LinkedIn token, or OpenAI runtime is introduced into the frontend deployment.

## Access and privacy model

- The GitHub repository remains private when the owner's GitHub plan supports Pages for private repositories.
- A GitHub Pages URL is internet-reachable; it is not an access-control layer.
- Supabase Auth is the access-control boundary. Initially, only the existing `ian@liliantrade.com` account is used. Do not create additional accounts or enable public sign-up as part of this migration.
- Existing RLS policies and `social-publish-linkedin` authorization remain in force. Its JWT verification stays enabled.
- The frontend receives only `SUPABASE_URL` and a publishable key. Both are injected into the Pages build artifact through GitHub Actions; neither service-role credentials nor LinkedIn credentials are committed or sent to the browser.

## Frontend behavior

The present browser application calls same-origin `/api/*` routes because OpenAI Sites runs the Worker proxy. GitHub Pages cannot execute that proxy.

The static build therefore changes only the transport layer:

- Login, password recovery, current-user lookup, REST, Storage, and Edge Function calls target the managed Supabase project directly.
- Every request uses the publishable key. Authenticated requests also include the current user's bearer token.
- Signed storage URLs and the publication image URL keep using the managed Supabase origin.
- The current editor, draft flow, scheduling behavior, image crop UI, database schema, RLS policies, Edge Functions, and LinkedIn publication logic remain unchanged.

## Deployment

GitHub Actions builds a standalone `index.html` from the existing application source and deploys it to GitHub Pages. The first acceptance URL can be the repository's GitHub Pages URL. `social.liliantrade.com` remains the desired custom domain and is configured only after Pages is working.

The repository's GitHub Pages settings and DNS are external configuration. The deployment workflow must not change DNS or enable Pages until the repository is accessible to the executor and Ian approves those external settings.

Supabase Auth URL Configuration must allow the active Pages origin for password recovery. When `social.liliantrade.com` is enabled, add it too and retain the OpenAI Sites URL temporarily as rollback.

## LinkedIn OAuth

GitHub Pages does not change the LinkedIn OAuth callback. LinkedIn OAuth continues to use the existing Supabase `linkedin-oauth-callback` Edge Function configured through `LINKEDIN_REDIRECT_URI`. LinkedIn Developers must be changed only if that existing secret/registered callback does not already use the Supabase function URL.

## Verification

Before every implementation commit run `npm test`, the Pages build validation, and `git diff --check`.

Before declaring migration complete verify:

1. The Pages URL shows the Lili login screen without OpenAI or ChatGPT login.
2. `ian@liliantrade.com` can sign in, view drafts and materials, save a draft, and log out.
3. Password recovery returns to the active Pages origin.
4. The existing published post remains visible as `Publicado`.
5. A human-approved LinkedIn publication occurs only with Ian's explicit approval.
6. No runtime code, Pages artifact, Git history, or Actions log contains a service-role key, LinkedIn token, OAuth secret, or Supabase password.

## Out of scope

- Creating new Supabase users or agent accounts.
- Modifying RLS policies, tables, migrations, or LinkedIn credentials.
- Publishing test content to LinkedIn.
- Moving Supabase, Auth, Storage, or Edge Functions to another host.
- Configuring a VPS, Docker, reverse proxy, or a generic self-hosted server.
