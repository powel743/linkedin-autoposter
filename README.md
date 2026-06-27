# LinkedIn Auto-Poster

Posts one update per day to your LinkedIn profile automatically — even when your
PC is off — using **GitHub Actions** (a free scheduled cron in the cloud).

It reads `posts.json`, sends the post at `last_posted_index` to LinkedIn, then
increments the index and commits the file back to the repo. After day 30 it
loops back to day 1.

- **No dependencies** — pure Node.js built-ins (`https`, `fs`).
- **Runs in the cloud** — daily at **06:00 UTC = 09:00 EAT (Nairobi)**.
- **Manual trigger** supported for testing.

---

## How it works

| File | Purpose |
| --- | --- |
| `posts.json` | Your 30 posts + a `last_posted_index` cursor. |
| `poster.js` | Reads the current post, sends it to LinkedIn, advances the cursor, commits the file back. |
| `.github/workflows/post.yml` | The daily scheduled GitHub Action. |

Each run posts the entry at `last_posted_index`, then advances it by 1
(wrapping back to `0` after index 29 / day 30). Entries whose content is still
`"PLACEHOLDER - will be replaced"` are skipped without advancing.

---

## Setup

### 1. Fill in your posts

Edit `posts.json` and replace each `content` placeholder with the text you want
to publish that day. Leave the structure intact:

```json
{
  "posts": [
    { "day": 1, "content": "Your first post here..." },
    { "day": 2, "content": "Your second post here..." }
  ],
  "last_posted_index": 0
}
```

### 2. Get a LinkedIn access token

You need an OAuth 2.0 access token with the **`w_member_social`** scope (to post)
and **`openid profile`** (to read your profile/URN).

1. Create an app at the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Add the **"Share on LinkedIn"** and **"Sign In with LinkedIn using OpenID Connect"** products.
3. Follow the OAuth flow to obtain a token:
   [LinkedIn OAuth docs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).

> ⚠️ LinkedIn member tokens typically expire after ~60 days. When posting starts
> failing with `401`, generate a fresh token and update the GitHub secret.

### 3. Find your LinkedIn Person URN

With your access token, call the userinfo endpoint:

```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://api.linkedin.com/v2/userinfo
```

The response includes a `"sub"` field — that's your member id. Your Person URN is:

```
urn:li:person:<sub>
```

You can store either the full `urn:li:person:...` value **or** just the `sub`
id in the secret — the script normalizes both.

### 4. Add GitHub Secrets

In your repository: **Settings → Secrets and variables → Actions → New repository secret**.

Add these two secrets:

| Secret name | Value |
| --- | --- |
| `LINKEDIN_ACCESS_TOKEN` | Your LinkedIn OAuth access token. |
| `LINKEDIN_PERSON_URN` | `urn:li:person:<sub>` (or just `<sub>`). |

> `GITHUB_TOKEN` is **provided automatically** by GitHub Actions — you do **not**
> create it. The workflow already grants it `contents: write` so it can commit
> the updated `posts.json`.

### 5. Test it manually

1. Push this repo to GitHub (see commands below).
2. Go to the **Actions** tab.
3. Select **LinkedIn Auto-Poster** in the left sidebar.
4. Click **Run workflow** → **Run workflow**.
5. Open the run logs to confirm which day was posted.

After this, it runs automatically every day at 06:00 UTC.

---

## Schedule

```
cron: '0 6 * * *'   # 06:00 UTC = 09:00 EAT (Nairobi)
```

GitHub's scheduled runs can be delayed by a few minutes during peak load — this
is normal.
