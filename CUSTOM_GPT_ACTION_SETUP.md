# Wildlife Documentary Engine — Custom GPT Action Setup

## 1. Start the local server

```bash
npm run dev
```

Server starts at `http://localhost:3000`.

## 2. Deploy the backend

Pick one option:

### Option A — Vercel (recommended)

Install the Vercel CLI:

```bash
npm i -g vercel
```

Deploy:

```bash
cd E:\DEV_WORKS\wildlife-gpt-backend
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? Pick your account
- Link to existing project? **N**
- Project name: `wildlife-gpt-backend` (or any name)
- Directory: `.` (current)
- Override settings? **N**

Vercel gives you a URL like `https://wildlife-gpt-backend.vercel.app`.

Set your API key as a Vercel environment variable:

```bash
vercel env add ACTION_API_KEY
```

Paste your secret key. Or do it in the Vercel dashboard: Settings → Environment Variables.

Redeploy with env vars:

```bash
vercel --prod
```

Update `gpt-action-openapi.yaml` — replace the server URL:

```yaml
servers:
  - url: "https://wildlife-gpt-backend.vercel.app"   # ← your Vercel URL
```

Skip to **Step 5** below.

### Option B — Local tunnel (ngrok/cloudflared)

Use this for quick local testing without deploying.

```bash
ngrok http 3000
```

or

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the public HTTPS URL (e.g. `https://abc123.ngrok-free.app`).

## 3. Update the OpenAPI spec (Option B only)

Open `gpt-action-openapi.yaml` and replace the placeholder:

```yaml
servers:
  - url: "https://YOUR-PUBLIC-BACKEND-URL-HERE"   # ← replace with your tunnel URL
```

## 4. Set your API key (Option B only)

Edit `.env`:

```
ACTION_API_KEY=your_strong_secret_here
```

This key protects the save endpoint. The Custom GPT sends it in the `x-action-api-key` header.

## 5. Configure the Custom GPT Action

1. Open your Wildlife Documentary Engine Custom GPT in the ChatGPT editor.
2. Go to **Configure** → **Actions** → **Create new action**.
3. Set authentication:
   - **Authentication Type:** API Key
   - **Auth Type:** Custom
   - **Custom Header Name:** `x-action-api-key`
   - **Value:** same as `ACTION_API_KEY`
4. Paste the full contents of `gpt-action-openapi.yaml` into the schema editor.
5. Click **Test** on `checkHealth` — verify it returns `{ "ok": true }`.
6. Click **Test** on `saveWildlifePackage` — send a valid wildlife package to confirm it saves.

## 6. Add Custom GPT instruction

Add this to your Custom GPT instructions:

```
After generating the final valid Wildlife Documentary JSON package,
call the saveWildlifePackage action and send the complete JSON package.

Only call saveWildlifePackage after the JSON is complete and matches
the required schema.

Do not send markdown.
Do not send partial JSON.
Do not add extra fields.

After saving successfully, reply:
"Saved. Preview should update automatically."
```

## 7. Verify end-to-end

1. Open your deployed URL (Vercel) or `http://localhost:3000` (tunnel) in your browser.
2. Click **Start Auto Preview**.
3. Go to your Custom GPT and generate a wildlife package.
4. The frontend detects the new package within 3 seconds and auto-renders it.
5. Status bar shows "New package received".

## Testing Checklist

- [ ] `npm run dev` works locally
- [ ] `GET /api/health` returns `{ "ok": true }`
- [ ] `POST /api/packages` rejects requests missing `x-action-api-key`
- [ ] Invalid JSON returns 400 with validation errors
- [ ] Valid JSON saves successfully (201 response)
- [ ] `GET /api/packages/latest` returns the newest package
- [ ] Frontend auto-preview polls and detects new packages
- [ ] `gpt-action-openapi.yaml` is valid OpenAPI 3.1.0
- [ ] No OpenAI API key required anywhere

## Data persistence note

- **Vercel**: Packages stored in-memory (`/tmp`). Survives warm function instances (minutes to hours on free tier). Cold starts reset to empty. For permanent storage, add Vercel KV later.
- **Local**: Packages stored in `data/packages.json` on disk. Fully persistent.

## No OpenAI API Key

This backend never calls OpenAI. The Custom GPT generates content on ChatGPT's side.
The backend only receives, validates, stores, and serves JSON packages.

No `OPENAI_API_KEY` needed. No OpenAI SDK installed.
