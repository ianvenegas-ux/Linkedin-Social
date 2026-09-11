# Lili Social Self-Hosted Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover Lili Social desde OpenAI Sites a un enlace HTTPS independiente alojado en el servidor privado de Lilian Trade, conservando el login propio, Supabase, las imágenes y la publicación en LinkedIn.

**Architecture:** Mantener Supabase administrado como backend de Auth, Postgres, Storage y Edge Functions. Ejecutar el Worker actual dentro de un contenedor Node.js en el servidor privado, escuchando sólo en `127.0.0.1:18080`, detrás del mismo reverse proxy y sistema de certificados que usa el CRM. El navegador seguirá hablando únicamente con rutas same-origin `/api/*`; el servidor reenviará esas rutas a Supabase con la publishable key y el JWT del usuario.

**Tech Stack:** JavaScript ESM, Node.js 24, Docker Compose, reverse proxy existente del CRM, Supabase Auth/Postgres/Storage/Edge Functions y LinkedIn REST API.

**Spec:** `docs/superpowers/plans/2026-09-11-lili-social-self-hosted-migration.md#specification-and-handoff-context`

## Global Constraints

- El hostname objetivo por defecto es `social.liliantrade.com`. Si el inventario del CRM demuestra que Lilian Trade usa otra convención, cambiar el hostname en un solo commit antes de tocar DNS.
- La primera migración elimina la dependencia de OpenAI, pero mantiene el proyecto administrado de Supabase `qjvaqxjmxydqjrcwuavp`.
- No migrar Postgres, Auth, Storage ni Edge Functions a un Supabase self-hosted en esta fase.
- No copiar al servidor `SUPABASE_SERVICE_ROLE_KEY`, tokens de LinkedIn ni secretos OAuth. Permanecen dentro de Supabase.
- El servidor de la app sólo recibe `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `PORT`.
- Mantener `verify_jwt = true` para `social-publish-linkedin`.
- Mantener RLS habilitado en todas las tablas expuestas. No resolver permisos deshabilitando RLS ni agregando políticas `TO authenticated` sin un predicado de autorización.
- No refactorizar el editor visual ni separar el HTML gigante durante la migración. Ese trabajo es posterior al cutover.
- No crear una publicación pública de prueba en LinkedIn sin aprobación explícita de Ian.
- No apagar ni eliminar el sitio actual de OpenAI durante la migración. Conservarlo como rollback hasta que Ian apruebe el enlace nuevo.
- Nunca registrar o incluir en commits contraseñas, JWT, publishable keys, service-role keys, tokens OAuth o archivos `.env.production`.
- Ejecutar `npm test`, `npm run validate` y `git diff --check` antes de cada commit de implementación.
- Usar una rama o worktree `feat/lili-social-self-hosted` creada desde `dc80c39d0da0ada6e5dd04692cc06d5a9604951e`.

---

## Specification and handoff context

### Resultado requerido

Al terminar, `https://social.liliantrade.com/` debe funcionar aunque `chatgpt.site`, los headers OAI y la sesión de ChatGPT no existan. Una persona debe poder abrir el enlace, iniciar sesión con su cuenta de Supabase, recuperar/cambiar su contraseña, gestionar borradores e imágenes y publicar en LinkedIn con el mismo flujo actual.

OpenAI no debe participar en el tráfico, la autenticación ni el despliegue del nuevo enlace. Supabase y LinkedIn siguen siendo dependencias externas deliberadas de esta fase.

### Estado confirmado al entregar este handoff

- Repositorio local: `work/lili-social-build`.
- Commit base validado: `dc80c39d0da0ada6e5dd04692cc06d5a9604951e` (`Align LinkedIn publication state`).
- Sitio actual: `https://lili-social.liliantrade-5085.chatgpt.site/`.
- OpenAI Sites: versión 18 desplegada correctamente.
- Supabase: proyecto `qjvaqxjmxydqjrcwuavp`.
- Edge Function activa: `social-publish-linkedin`, versión 10, `verify_jwt = true`.
- Variables actuales del hosting: `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. El valor de la key no está ni debe quedar en este documento.
- Publicación real verificada el 11 de septiembre de 2026:
  - Post interno: `ada39c24-e73b-4363-b8ff-807600245e78`.
  - Estado: `published`.
  - URN: `urn:li:share:7504113224976478208`.
  - URL: `https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7504113224976478208`.
- Suite actual: siete pruebas, todas aprobadas.
- Los archivos `.tgz` sin seguimiento en la raíz son artefactos locales de despliegues anteriores; no agregarlos al commit.

### Dependencia real de OpenAI hoy

OpenAI Sites aporta solamente:

1. El dominio `chatgpt.site` y el runtime del Worker.
2. Una capa externa owner-only antes de mostrar la app.
3. Las variables de entorno del Worker.
4. El repositorio remoto y el mecanismo de despliegue de Sites.

La aplicación no consume la API de OpenAI ni usa un modelo OpenAI en tiempo de ejecución. El login visible ya usa Supabase Auth con correo y contraseña. Por eso la migración no requiere reemplazar el sistema de usuarios: requiere sustituir el runtime, dominio y despliegue de Sites.

### Componentes que deben conservarse

- `worker/index.js`: UI completa y proxy same-origin.
- `worker/*.test.mjs`: pruebas de auth, workflow, calendario, editor y rutas.
- `supabase/functions/social-publish-linkedin/index.ts`: publicación segura en LinkedIn.
- `supabase/functions/social-publish-linkedin/publish-state.mjs`: construcción del estado publicado.
- `supabase/migrations/20260911080325_social_publication_jobs_rls.sql`: RLS para trabajos programados.
- Bucket de Storage: `project_files`.
- Tablas con RLS: `profiles`, `social_accounts`, `social_posts`, `social_media`, `social_post_versions`, `social_approvals`, `social_publication_jobs`, `linkedin_connections` y `linkedin_posts`.
- Las tablas `linkedin_connections` y `linkedin_posts` niegan acceso directo a clientes. La Edge Function usa su entorno privilegiado dentro de Supabase.

### Rutas que debe servir el contenedor

| Ruta pública | Destino |
|---|---|
| `/` y `/index.html` | HTML de Lili Social |
| `/healthz` | Health check local, sin datos ni secretos |
| `/api/auth/login` | Supabase `/auth/v1/token` |
| `/api/auth/recover` | Supabase `/auth/v1/recover` |
| `/api/auth/user` | Supabase `/auth/v1/user` |
| `/api/rest/*` | Supabase `/rest/*` |
| `/api/storage/*` | Supabase `/storage/*` |
| `/api/functions/*` | Supabase `/functions/v1/*` |

### Arquitectura objetivo

```text
Navegador / Claude / LLM local con navegador
                  |
                  | HTTPS + login Supabase
                  v
       social.liliantrade.com
                  |
          Reverse proxy del CRM
                  |
       127.0.0.1:18080 en el host
                  |
       Contenedor lili-social:8080
                  |
        Proxy same-origin /api/*
                  |
                  v
 Supabase Auth + Postgres/RLS + Storage + Edge Functions
                  |
                  v
              LinkedIn API
```

### Fuera de alcance de este cutover

- Self-hosting completo de Supabase.
- Sustituir Supabase Auth por otro proveedor.
- Mover tokens de LinkedIn al servidor privado.
- Convertir el scheduler actual, que procesa vencidos al abrir la app, en un cron independiente.
- Reescribir la UI con React/Vue/Svelte.
- Convertir `localStorage` a cookies HTTP-only.
- Diseñar un API/MCP programático para agentes. Para acceso inmediato, Claude o un LLM local puede usar el enlace con navegador y una cuenta Supabase dedicada; no debe reutilizar la contraseña de Ian.

### Documentación vigente consultada

- Redirect URLs de Supabase Auth: `https://supabase.com/docs/guides/auth/redirect-urls`
- Auth de Edge Functions: `https://supabase.com/docs/guides/functions/auth`
- Headers `Authorization` y `apikey`: `https://supabase.com/docs/guides/functions/auth-headers`
- Configuración de funciones: `https://supabase.com/docs/guides/functions/function-configuration`
- Changelog de breaking changes: `https://supabase.com/changelog?types=breaking-change`

La revisión del changelog del 11 de septiembre de 2026 confirma cambios recientes para Supabase self-hosted en Envoy y `API_EXTERNAL_URL`. No afectan esta fase porque el backend sigue administrado por Supabase, pero deben revisarse antes de una futura migración total.

---

## File map for the migration

### Archivos a crear

- `server/index.mjs`: adaptador HTTP de Node al contrato `fetch(request, env)` del Worker.
- `server/index.test.mjs`: prueba real del adaptador en un puerto efímero.
- `Dockerfile`: imagen sin dependencias npm de producción.
- `compose.yaml`: servicio local en `127.0.0.1:18080`.
- `.dockerignore`: excluye Git, secretos, artefactos y documentación innecesaria.
- `.env.production.example`: nombres de variables sin valores secretos.
- `scripts/verify-self-hosted.mjs`: smoke test HTTP del contenedor.
- `docs/migration/lili-social-self-hosted-runbook.md`: valores no secretos observados del CRM, comandos de deploy, rollback y evidencia final.

### Archivos a modificar

- `worker/index.js`: health check, validación obligatoria de entorno e inyección segura de la URL pública de Supabase en el HTML.
- `worker/routing.test.mjs`: pruebas de entorno requerido, `/healthz` y rutas Supabase.
- `worker/editor.test.mjs`: elimina la expectativa de una URL de Supabase codificada en el archivo.
- `package.json`: agrega scripts `start`, `test:server` y `verify:self-hosted`.
- `.gitignore`: excluye `.env.production`, `*.tgz` e imágenes de Docker exportadas.

### Archivos que no se deben modificar en esta migración

- `.openai/hosting.json`: conservar para rollback hasta aprobación de Ian.
- `supabase/functions/social-publish-linkedin/index.ts`: ya está validado y desplegado como versión 10.
- Migraciones SQL existentes y políticas RLS.
- Registros de `linkedin_connections` y secretos de las Edge Functions.

---

## Task 1: Freeze the baseline and discover the CRM deployment pattern

**Files:**
- Create: `docs/migration/lili-social-self-hosted-runbook.md`
- Read: `.openai/hosting.json`
- Read: `worker/index.js`
- Read: `supabase/functions/social-publish-linkedin/index.ts`

**Interfaces:**
- Consumes: el checkout en `dc80c39d0da0ada6e5dd04692cc06d5a9604951e` y acceso de sólo lectura al servidor/stack del CRM.
- Produces: hostname final, host SSH, usuario de despliegue, reverse proxy detectado, ruta de despliegue y mecanismo de certificados registrados en el runbook.

- [ ] **Step 1: Create an isolated worktree**

Usar `superpowers:using-git-worktrees` si está disponible. Crear `feat/lili-social-self-hosted` desde el commit base; no trabajar sobre cambios sin confirmar del usuario.

- [ ] **Step 2: Verify the baseline**

Run:

```bash
git rev-parse --verify HEAD
npm test
npm run validate
git diff --check
```

Expected: SHA base `dc80c39d0da0ada6e5dd04692cc06d5a9604951e`, siete pruebas aprobadas, artefacto ESM válido y cero errores de diff.

- [ ] **Step 3: Inspect the CRM deployment without changing it**

Determinar y registrar en el runbook:

- distribución Linux y arquitectura;
- si usa Docker Compose;
- Caddy, Nginx, Traefik u otro reverse proxy;
- forma de emitir/renovar TLS;
- carpeta de aplicaciones;
- usuario/grupo propietario;
- red y convención de puertos;
- mecanismo de backups;
- repositorio Git independiente de OpenAI que usa el CRM.

No instalar un segundo reverse proxy. Si la tarea no tiene acceso al servidor ni conoce el proyecto del CRM, detener sólo este paso y pedir a Ian el proyecto/host exacto; el desarrollo local de Tasks 2–5 puede continuar.

- [ ] **Step 4: Write the runbook baseline**

El runbook debe registrar los valores observados, el commit base, el proyecto Supabase, `social.liliantrade.com`, el puerto host `18080` y la confirmación de que no contiene secretos.

- [ ] **Step 5: Commit**

```bash
git add docs/migration/lili-social-self-hosted-runbook.md
git commit -m "docs: record self-hosted migration baseline"
```

---

## Task 2: Remove runtime constants tied to the current hosting environment

**Files:**
- Modify: `worker/index.js`
- Modify: `worker/routing.test.mjs`
- Modify: `worker/editor.test.mjs`

**Interfaces:**
- Consumes: `{ SUPABASE_URL: string, SUPABASE_PUBLISHABLE_KEY: string }`.
- Produces: `renderAppHtml(env): string`, `requiredSupabaseConfig(env): { url: string, key: string }` y el endpoint `GET /healthz`.

- [ ] **Step 1: Write failing environment tests**

Agregar pruebas que exijan:

```js
assert.doesNotMatch(source, /const FALLBACK_SUPABASE_URL/);
assert.doesNotMatch(source, /qjvaqxjmxydqjrcwuavp\.supabase\.co/);

const missing = await worker.fetch(new Request("https://lili-social.test/"), {});
assert.equal(missing.status, 500);

const health = await worker.fetch(new Request("https://lili-social.test/healthz"), {});
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: "lili-social" });
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
node worker/routing.test.mjs
node worker/editor.test.mjs
```

Expected: fallan porque existe el fallback codificado, el HTML contiene el project URL y `/healthz` devuelve 404.

- [ ] **Step 3: Implement strict configuration**

Usar estas interfaces en `worker/index.js`:

```js
function requiredSupabaseConfig(env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
  return { url, key };
}

function renderAppHtml(env) {
  const { url } = requiredSupabaseConfig(env);
  return ENHANCED_APP_HTML.replace('"__PUBLIC_SUPABASE_URL__"', JSON.stringify(url));
}
```

Cambiar la constante inyectada en el HTML a:

```js
const PUBLIC_SUPABASE_URL = "__PUBLIC_SUPABASE_URL__";
```

`supabaseTarget()` y `forward()` deben consumir `requiredSupabaseConfig(env)`. Si falta configuración, `fetch()` debe devolver JSON 500 sin revelar valores de entorno.

Agregar antes de las demás rutas:

```js
if (url.pathname === "/healthz") {
  return json({ ok: true, service: "lili-social" });
}
```

- [ ] **Step 4: Run tests and verify GREEN**

```bash
npm test
npm run validate
git diff --check
```

Expected: todas las pruebas pasan y el project URL no aparece en los archivos de runtime.

- [ ] **Step 5: Commit**

```bash
git add worker/index.js worker/routing.test.mjs worker/editor.test.mjs
git commit -m "refactor: require portable Supabase runtime config"
```

---

## Task 3: Add a dependency-free Node HTTP adapter

**Files:**
- Create: `server/index.mjs`
- Create: `server/index.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `worker.fetch(request: Request, env: object): Promise<Response>`.
- Produces: `createAppServer(env): http.Server` y `startServer(env): http.Server`.

- [ ] **Step 1: Write a failing server test**

La prueba debe arrancar el servidor en `127.0.0.1` con puerto efímero y verificar `/healthz` y `/`:

```js
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "./index.mjs";

const server = createAppServer({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
});
server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: "lili-social" });

  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Lili Social/);
} finally {
  server.close();
  await once(server, "close");
}
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node server/index.test.mjs
```

Expected: falla porque `server/index.mjs` no existe.

- [ ] **Step 3: Implement the Node adapter**

`server/index.mjs` debe usar únicamente módulos estándar:

```js
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import worker from "../worker/index.js";

function incomingHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function toWebRequest(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = req.headers.host || "127.0.0.1";
  const init = { method: req.method, headers: incomingHeaders(req) };
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(new URL(req.url || "/", `${forwarded}://${host}`), init);
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}

export function createAppServer(env = process.env) {
  return createServer(async (req, res) => {
    try {
      await sendWebResponse(res, await worker.fetch(toWebRequest(req), env));
    } catch (error) {
      console.error("lili_social_request_error", error);
      res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}

export function startServer(env = process.env) {
  const port = Number(env.PORT || 8080);
  const server = createAppServer(env);
  server.listen(port, "0.0.0.0", () => console.log(`lili-social listening on ${port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
```

- [ ] **Step 4: Add package scripts**

```json
{
  "start": "node server/index.mjs",
  "test:server": "node server/index.test.mjs"
}
```

Agregar `npm run test:server` al script `test`.

- [ ] **Step 5: Run tests and commit**

```bash
npm test
npm run validate
git diff --check
git add server/index.mjs server/index.test.mjs package.json
git commit -m "feat: run Lili Social on a standard Node server"
```

---

## Task 4: Package the application for the private server

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Create: `.env.production.example`
- Create: `scripts/verify-self-hosted.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: `node server/index.mjs` y las tres variables de entorno.
- Produces: Docker service `lili-social`, host endpoint `127.0.0.1:18080` and health endpoint `/healthz`.

- [ ] **Step 1: Write the container smoke test**

`scripts/verify-self-hosted.mjs`:

```js
import assert from "node:assert/strict";

const origin = process.env.LILI_SOCIAL_ORIGIN || "http://127.0.0.1:18080";
const health = await fetch(`${origin}/healthz`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: "lili-social" });

const home = await fetch(`${origin}/`);
assert.equal(home.status, 200);
assert.match(await home.text(), /Lili Social/);
console.log(`self-hosted smoke test passed: ${origin}`);
```

- [ ] **Step 2: Add the Dockerfile**

```dockerfile
FROM node:24.19.0-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY package.json ./
COPY worker ./worker
COPY server ./server

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:8080/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

CMD ["node", "server/index.mjs"]
```

- [ ] **Step 3: Add Compose configuration**

```yaml
services:
  lili-social:
    container_name: lili-social
    build:
      context: .
    restart: unless-stopped
    env_file:
      - .env.production
    ports:
      - "127.0.0.1:18080:8080"
    read_only: true
    tmpfs:
      - /tmp:size=32m,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

- [ ] **Step 4: Add secret-safe examples and ignores**

`.env.production.example` must contain only:

```dotenv
SUPABASE_URL=https://qjvaqxjmxydqjrcwuavp.supabase.co
SUPABASE_PUBLISHABLE_KEY=
PORT=8080
```

`.dockerignore`:

```text
.git
.openai
.env*
!.env.production.example
dist
docs
*.tgz
node_modules
```

Agregar a `.gitignore`:

```text
.env.production
*.tgz
*.tar
```

- [ ] **Step 5: Build and test locally**

Obtener la publishable key con el conector Supabase o el dashboard. No imprimirla en logs. Guardarla sólo en `.env.production` con permisos restringidos.

```bash
docker compose build --pull
docker compose up -d
node scripts/verify-self-hosted.mjs
docker compose ps
docker compose logs --tail=100 lili-social
```

Expected: servicio `healthy`; `/` y `/healthz` responden 200; los logs no contienen variables ni tokens.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile compose.yaml .dockerignore .env.production.example .gitignore scripts/verify-self-hosted.mjs package.json
git commit -m "build: package Lili Social for private hosting"
```

---

## Task 5: Verify the Supabase proxy without OpenAI

**Files:**
- Modify: `server/index.test.mjs`
- Modify: `docs/migration/lili-social-self-hosted-runbook.md`

**Interfaces:**
- Consumes: contenedor local y credenciales de prueba existentes de Supabase.
- Produces: evidencia de que el login y todas las rutas llegan a Supabase sin cookies o headers OAI.

- [ ] **Step 1: Add proxy boundary tests**

Cubrir en pruebas, con `globalThis.fetch` reemplazado igual que `worker/routing.test.mjs`:

- `/api/auth/login` -> `/auth/v1/token`;
- `/api/rest/v1/social_posts` -> `/rest/v1/social_posts`;
- `/api/storage/v1/object/sign/...` -> `/storage/v1/object/sign/...`;
- `/api/functions/social-publish-linkedin` -> `/functions/v1/social-publish-linkedin`;
- preservación de `Authorization: Bearer <user-jwt>`;
- inyección de `apikey` desde el entorno;
- ausencia de `OAI-Sites-Authorization` y headers `oai-authenticated-*`.

- [ ] **Step 2: Run tests**

```bash
npm test
npm run validate
git diff --check
```

- [ ] **Step 3: Run manual local acceptance**

Abrir `http://127.0.0.1:18080` en una ventana privada y confirmar:

1. Se muestra el login de Lili Social sin login de ChatGPT.
2. Un password incorrecto muestra error de Supabase.
3. La cuenta de Ian entra correctamente.
4. Cargan borradores, calendario y materiales.
5. La imagen de un post guardado aparece en el preview.
6. Se puede guardar un borrador nuevo sin publicarlo.
7. Cerrar sesión elimina `lili_social_session` y vuelve al login.

- [ ] **Step 4: Record evidence and commit**

Registrar fecha, commit, resultado y cualquier request ID no sensible en el runbook.

```bash
git add server/index.test.mjs docs/migration/lili-social-self-hosted-runbook.md
git commit -m "test: verify OpenAI-independent Supabase proxy"
```

---

## Task 6: Deploy beside the CRM on the private server

**Files:**
- Modify: `docs/migration/lili-social-self-hosted-runbook.md`
- Server-only, never commit: `/opt/lili-social/.env.production`
- Server-only: configuración del reverse proxy existente.

**Interfaces:**
- Consumes: patrón exacto descubierto en Task 1 y la imagen/checkout del commit probado.
- Produces: `https://social.liliantrade.com` apuntando a `127.0.0.1:18080` con TLS válido.

- [ ] **Step 1: Establish an independent source/deploy path**

Usar el mismo Git remoto privado o mecanismo de deploy del CRM. No usar `git.chatgpt-team.site` como origen de producción. Copiar la historia Git o el checkout validado al sistema privado y verificar que el SHA desplegado coincide con el último commit de la rama.

- [ ] **Step 2: Install the production files**

Usar `/opt/lili-social` salvo que Task 1 confirme otra convención del CRM. El directorio y `.env.production` deben pertenecer al usuario de despliegue del CRM; `.env.production` debe tener modo `0600`.

Obtener `SUPABASE_PUBLISHABLE_KEY` directamente desde Supabase o desde el secret manager autorizado. No copiarla desde logs, conversaciones ni el HTML.

- [ ] **Step 3: Start the container**

```bash
cd /opt/lili-social
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail --silent http://127.0.0.1:18080/healthz
```

Expected: JSON `{"ok":true,"service":"lili-social"}` y contenedor `healthy`.

- [ ] **Step 4: Configure the existing reverse proxy**

Aplicar exactamente una variante, la que coincida con el CRM.

Caddy:

```caddyfile
social.liliantrade.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:18080
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    X-Frame-Options DENY
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "default-src 'self'; img-src 'self' blob: data: https://*.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }
}
```

Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name social.liliantrade.com;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options DENY always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' blob: data: https://*.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
}
```

Conservar la configuración TLS/certificados existente del CRM; no reemplazarla con valores inventados.

- [ ] **Step 5: Create DNS and verify TLS**

Crear el registro `social.liliantrade.com` hacia el mismo endpoint público seguro del CRM. Verificar:

```bash
curl --fail --silent https://social.liliantrade.com/healthz
curl --fail --silent --head https://social.liliantrade.com/
```

- [ ] **Step 6: Record and commit deployment metadata**

Registrar SHA, digest de imagen, hora, host, puerto, proxy y resultado del health check, sin secretos.

```bash
git add docs/migration/lili-social-self-hosted-runbook.md
git commit -m "docs: record private server deployment"
```

---

## Task 7: Update Supabase Auth redirects for the independent domain

**Files:**
- Modify: `docs/migration/lili-social-self-hosted-runbook.md`
- Supabase dashboard/config only: URL Configuration.

**Interfaces:**
- Consumes: `https://social.liliantrade.com/` operativo.
- Produces: recuperación de contraseña y redirects de Auth válidos en el dominio nuevo, con rollback al dominio antiguo.

- [ ] **Step 1: Update Auth URL Configuration**

En Supabase Auth:

- establecer Site URL en `https://social.liliantrade.com/`;
- agregar Redirect URL exacta `https://social.liliantrade.com/`;
- conservar temporalmente `https://lili-social.liliantrade-5085.chatgpt.site/` en Additional Redirect URLs;
- no usar un wildcard de producción.

La UI ya envía `redirect_to: window.location.origin + "/"`, así que el reset seguirá el dominio desde el cual se solicitó.

- [ ] **Step 2: Verify password recovery**

Solicitar recuperación desde el dominio nuevo, abrir el correo y confirmar que el enlace vuelve a `https://social.liliantrade.com/`, permite guardar una contraseña nueva y luego iniciar sesión.

- [ ] **Step 3: Verify LinkedIn OAuth is unaffected**

Las funciones `linkedin-oauth-start` y `linkedin-oauth-callback` usan `LINKEDIN_REDIRECT_URI` desde secretos de Supabase y no contienen `chatgpt.site`. Confirmar que el URI registrado en LinkedIn sigue apuntando a la Edge Function de callback. No rotar ni mover los tokens si ese URI no cambia.

- [ ] **Step 4: Verify Edge Function auth**

Confirmar con Supabase que `social-publish-linkedin` sigue `ACTIVE`, versión 10 o superior, y `verify_jwt = true`. Una llamada sin JWT debe responder 401; no cambiar el flag para evitar ese 401.

- [ ] **Step 5: Record evidence**

Agregar al runbook la configuración no sensible y los resultados de login/reset. No copiar enlaces de recuperación porque contienen tokens.

---

## Task 8: Production acceptance, cutover and rollback

**Files:**
- Modify: `docs/migration/lili-social-self-hosted-runbook.md`

**Interfaces:**
- Consumes: dominio nuevo, Auth configurado y contenedor sano.
- Produces: aceptación explícita de Ian y un rollback probado.

- [ ] **Step 1: Prove there is no OpenAI runtime dependency**

Run:

```bash
rg -n -i 'chatgpt\.site|git\.chatgpt-team\.site|OAI-Sites-Authorization|oai-authenticated|openai' \
  worker server Dockerfile compose.yaml scripts package.json
```

Expected: cero coincidencias en archivos de runtime. Se permiten referencias históricas sólo en `.openai/` y documentación de rollback.

Abrir el dominio en incógnito y verificar que no aparece SIWC, ChatGPT ni una cookie OAI. Debe aparecer directamente el login de Lili Social.

- [ ] **Step 2: Run functional acceptance**

Con Ian presente:

1. Iniciar sesión con la cuenta existente.
2. Abrir la publicación ya publicada y verificar el estado `Publicado`.
3. Crear y guardar un borrador nuevo.
4. Subir una imagen, comprobar el preview y ajustar el encuadre mediante arrastre.
5. Cambiar de borrador y volver sin error de clave duplicada.
6. Confirmar que el calendario carga y que no duplica jobs.
7. Usar una publicación real aprobada por Ian para la prueba final de LinkedIn. Ian debe pulsar `Aprobar y publicar`.
8. Confirmar un solo URN nuevo en `social_posts` y un solo registro correspondiente en `linkedin_posts`.

No publicar contenido de relleno ni pulsar el botón en nombre de Ian.

- [ ] **Step 3: Verify logs and database state**

Confirmar:

- respuestas 2xx para `/api/rest/*`, `/api/storage/*` y `/api/functions/social-publish-linkedin`;
- `social_posts.status = 'published'` y `published_urn` no nulo;
- cero secretos/JWT en logs del contenedor y reverse proxy;
- ausencia de duplicados en `linkedin_posts` para el URN generado.

- [ ] **Step 4: Test rollback**

Antes de anunciar el cutover como completo:

```bash
cd /opt/lili-social
docker compose down
```

Confirmar que el sitio antiguo de OpenAI todavía funciona. Luego restaurar:

```bash
cd /opt/lili-social
docker compose up -d
curl --fail --silent https://social.liliantrade.com/healthz
```

- [ ] **Step 5: Obtain explicit acceptance**

Entregar a Ian:

- enlace `https://social.liliantrade.com/`;
- commit desplegado;
- resultado de tests;
- estado del contenedor;
- evidencia de login, password reset, imagen y publicación;
- procedimiento de rollback.

Mantener el sitio de OpenAI activo al menos siete días. Después de ese periodo, solicitar autorización explícita antes de archivarlo, despublicarlo o eliminarlo.

- [ ] **Step 6: Final commit**

```bash
git add docs/migration/lili-social-self-hosted-runbook.md
git commit -m "docs: complete Lili Social self-hosted cutover"
```

---

## Access for Claude or a local LLM

La migración elimina OpenAI como guardián del enlace. Cualquier navegador autorizado puede abrir `https://social.liliantrade.com/`.

Para un agente que opere la UI:

1. Crear una cuenta Supabase dedicada por agente, usando un correo o alias controlado por Lilian Trade.
2. Asignar únicamente el rol que necesita. Hoy las políticas sociales requieren `profiles.role = 'admin'`; no compartir la cuenta de Ian.
3. Guardar la contraseña en el secret manager del agente, nunca en prompts ni repositorios.
4. Revocar la sesión y deshabilitar la cuenta cuando el agente deje de utilizarse.

Para acceso programático sin navegador, escribir un plan separado para un API/MCP con scopes (`drafts:read`, `drafts:write`, `publish:request`) y aprobación humana obligatoria antes de publicar. No exponer `SUPABASE_SERVICE_ROLE_KEY` ni el token de LinkedIn a Claude o al LLM local.

---

## Definition of done

La migración está completa sólo si se cumplen todos estos puntos:

- `https://social.liliantrade.com/` carga desde el servidor privado con TLS válido.
- No se necesita login, cookie, header, dominio, repositorio ni runtime de OpenAI para usar el enlace nuevo.
- Login, logout y recuperación de contraseña funcionan con Supabase.
- Borradores, versiones, aprobaciones, imágenes, recorte y calendario funcionan.
- Una publicación real aprobada por Ian llega a LinkedIn una sola vez.
- RLS continúa habilitado; `verify_jwt` continúa activo.
- Ningún secreto quedó en Git, logs, imágenes Docker o este handoff.
- El sitio anterior permanece disponible como rollback hasta autorización explícita.
- El runbook registra commit, imagen, servidor, proxy, DNS, resultados y rollback.

## Suggested prompt for Terra or Luna

```text
Continúa Lili Social usando el handoff
docs/superpowers/plans/2026-09-11-lili-social-self-hosted-migration.md.
Lee el documento completo antes de cambiar archivos. Ejecuta Tasks 1–8 con TDD y commits pequeños.
Usa el mismo patrón de servidor, reverse proxy, TLS y repositorio privado que el CRM.
El objetivo es https://social.liliantrade.com/ sin dependencia de OpenAI, manteniendo Supabase administrado.
No publiques contenido de prueba en LinkedIn, no muevas service-role/tokens al servidor y no apagues el sitio anterior sin aprobación explícita de Ian.
Si no tienes acceso al servidor o al proyecto del CRM, avanza con Tasks 2–5 y pide únicamente el host/proyecto exacto necesario para Tasks 6–8.
```
