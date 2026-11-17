# Whatdo — setup guide

One to-do list on your **website**, **Chrome extension** and **Android app**. Everyone signs in with Google and tasks sync through a private file in their own Google Drive (the hidden `appDataFolder`, so you store nothing on a server).

```
src/            shared source (edit here)
build.py        builds web/, extension/, android-app/www/
web/            index.html  <- single file, upload to InfinityFree htdocs
extension/      load unpacked in Chrome/Edge (or zip for Chrome Web Store)
android-app/    push to a GitHub repo -> Actions builds the APK
```

## 1. Google Cloud (one time, ~10 min)

1. console.cloud.google.com → new project **Whatdo**.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **OAuth consent screen** → External → add scope `.../auth/drive.appdata` (non-sensitive scope, so no Google review needed beyond the basic one). Add your Gmail as a test user while testing, then **Publish app**.
4. **Credentials → Create OAuth client ID**, three of them:

| Type | Used by | What to enter |
|---|---|---|
| **Web application** | website + Android | Authorized JavaScript origins: your site URL, e.g. `https://whatdo.infinityfreeapp.com` (and `http://localhost:8080` for testing) |
| **Chrome extension** | extension | Item ID = your extension's ID (see step 3) |
| **Android** | Android app | Package `com.whatdo.app`, SHA-1 `E9:EF:E3:4B:DE:B4:41:66:57:A2:5B:93:A8:45:C2:EB:98:8A:EB:5F` (from the bundled `whatdo.keystore`) |

## 2. Fill in the config

- `src/config.js` → `GOOGLE_WEB_CLIENT_ID` (the Web client), `PAYMENT_URL`, `LICENSE_VERIFY_URL`
- `extension/manifest.json` → `oauth2.client_id` (the Chrome extension client)
- `android-app/capacitor.config.json` → `serverClientId` (the **Web** client ID again)

Then run `python3 build.py`.

## 3. Ship each piece

**Website** — upload `web/index.html` (rename if you like) to InfinityFree `htdocs/`. Nothing else needed. Make sure that exact URL is in the Web client's authorized origins.

**Extension** — `chrome://extensions` → Developer mode → *Load unpacked* → pick `extension/`. Copy the ID shown, create the Chrome-extension OAuth client with it. To keep the ID stable across machines, add a `"key"` to the manifest (Chrome Web Store gives you one once you upload).

**Android APK** — create a GitHub repo, upload the *contents* of `android-app/`, push to `main`. Open **Actions → Build Whatdo APK → run**; download the `Whatdo-apk` artifact, unzip, sideload `app-debug.apk`. The workflow signs with the bundled keystore so the SHA-1 above stays valid. (For Play Store, make a private release keystore, register its SHA-1 too, and build a release bundle.)

## 4. Selling Pro ($5)

Pro features (accent colors, unlimited colored tags) are gated by `state.pro.active`, which is synced via Drive so one purchase unlocks all three apps. Activation flow: user buys at `PAYMENT_URL` → receives a license key → enters it under **Upgrade → Activate** → app POSTs `{key, email}` to `LICENSE_VERIFY_URL` and expects `{"valid":true}`.

You need a tiny verifier. Easiest options:
- **Gumroad / Lemon Squeezy**: both generate license keys and have a license-verify API. Put a Cloudflare Worker (free) in front that calls it and returns `{valid}` with CORS enabled.
- **Razorpay / Stripe**: webhook → store key + email in a small DB (Cloudflare KV/D1), Worker checks it.

Be aware: this is client-side gating, so a determined user can edit local data to fake Pro. That is normal for a $5 utility; if it matters later, have the Worker sign the license and verify the signature in `activatePro()`.

## How sync works

- Tasks, tags and settings live in `whatdo-data.json` in the Drive app-data folder.
- Each item carries an `updated` time; on sync the newest version of every item wins, deletes are kept as tombstones for 30 days.
- Changes push ~1 s after you edit; each app also pulls every 30 s, on focus and when back online. Offline edits sync when you reconnect.
- Free: unlimited tasks, light/dark, up to 3 plain tags. Pro: any accent color, unlimited tags with custom colors.

## Honest limits of this first build

- I syntax-checked the code but could not run the full flow here: no live Google sign-in, no Android build (the sandbox can't reach the Android toolchain). Expect to fix small things on first run, especially the Android Google plugin version pairing.
- Chrome sign-in uses `chrome.identity.getAuthToken`; Edge/Brave fall back to a web auth flow that also needs the Web client to list `https://<extension-id>.chromiumapp.org/` as a redirect URI.
