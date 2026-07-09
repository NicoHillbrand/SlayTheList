# SlayTheList Mobile — Build Guide

## Prerequisites

- Node.js >= 20
- Android Studio (for building the native Android app)
- Java JDK 17+ (required by Android Studio)

## First-time setup

```bash
# From the repo root
npm install

# Initialize Capacitor and add Android platform
cd frontend/mobile
npx cap init SlayTheList com.slaythelist.app --web-dir dist
npx cap add android
```

## Development

```bash
# Build the web bundle
npm run build

# Sync to native project
npx cap sync

# Open in Android Studio
npx cap open android
```

## Building for release

1. **Build the web app:**
   ```bash
   npm run build
   npx cap sync
   ```

2. **Open Android Studio:**
   ```bash
   npx cap open android
   ```

3. **Generate signed AAB:**
   - In Android Studio: Build → Generate Signed Bundle / APK
   - Choose "Android App Bundle"
   - Create or select a keystore
   - Build the release AAB

4. **Publish to Google Play:**
   - Go to [Google Play Console](https://play.google.com/console)
   - Create a new app listing
   - Upload the AAB
   - Fill in store listing details, screenshots, privacy policy
   - Submit for review

## App icons

Place `icon.png` (1024x1024) and `splash.png` (2732x2732) in the `resources/` directory, then run:

```bash
npx capacitor-assets generate
```

## Cloud API

The mobile app connects directly to `https://slaythelist.nicohillbrand.com` (the cloud-social server). All data is end-to-end encrypted with the user's vault passphrase before being sent to the server. The server never sees unencrypted data.

## Architecture

- **Auth:** Google OAuth via device flow (same as desktop)
- **Data:** Vault pull → client-side decryption → display
- **Sync:** Local edits → encrypt → push to vault
- **Encryption:** PBKDF2 (600K iterations) + AES-256-GCM
