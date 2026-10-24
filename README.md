# Red Squiggly 🐝 — 6th Grade Spelling Bee Web App

A zero-build web application built for **Cloudflare Pages** + **Cloudflare KV**, featuring:
- **50 Pre-Baked 6th Grade Study Words** in [`wordlist.csv`](wordlist.csv) with definitions, language of origin, phonetic guides, parts of speech, and blanked-out example sentences (`0ms` latency, no Gemini API key needed).
- **Authentic Human Dictionary Audio (MP3)** via the Free Dictionary API with automatic fallback to natural browser Text-to-Speech.
- **Spaced-Repetition Quiz Engine**, character-by-character visual diffing on missed words, voice spelling recognition, and an interactive **Study List Explorer**.
- **Zero-Login Multi-Device Sync** backed by **Cloudflare KV** (`/api/progress`) + offline-safe `localStorage` merging.

---

## Deploying to Cloudflare Pages + KV

1. **Create a Cloudflare KV Namespace:**
   - In the Cloudflare Dashboard, go to **Storage & Databases → KV** and click **Create a namespace** (e.g., `red-squiggly-progress`).
2. **Create a Cloudflare Pages Project:**
   - Go to **Compute (Workers & Pages) → Create → Pages → Connect to Git** and select this repository.
   - **Framework preset:** `None`
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/`
3. **Bind the KV Namespace:**
   - In your Pages project, go to **Settings → Functions → KV namespace bindings**.
   - Add a binding with:
     - **Variable name:** `PROGRESS_KV`
     - **KV namespace:** `red-squiggly-progress`
   - Redeploy (or push a commit) so the binding takes effect.

---

## Running Locally

Because there is no build step, you can serve the root directory with any static server:

```powershell
# Using Dart (included with Flutter)
dart run dhttpd --path .

# Or using Python
python -m http.server 8080
```
