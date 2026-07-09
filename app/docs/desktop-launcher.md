# Desktop Launcher

The current launcher is an Electron app in `desktop/app`. It is meant to be the cross-platform path for running the core SlayTheList stack without visible shell windows.

## What it does

- Starts the API on port `8788`
- Starts the web app on `http://127.0.0.1:4000` when available, otherwise falls back to a free local port
- Waits for both services to become healthy
- Opens the UI inside an Electron window
- Stores launcher logs under the app's user data folder
- Keeps the overlay out of the startup path for now

## Development launcher

Run from repo root:

- `npm install`
- `npm run desktop:dev`

This uses the Electron shell plus the existing development servers, but keeps them as hidden child processes instead of opening extra terminal windows.

The older alias still works:

- `npm run app:dev`

## Packaged launcher

Run from repo root:

- `npm run desktop:package`

That command:

- syncs the shared blocked-overlay assets
- builds the workspace artifacts
- packages an unpacked Electron desktop bundle from `desktop/app`

The packaged app currently targets the core web + API stack. The Windows overlay remains a separate, future integration.

The older alias still works:

- `npm run app:package`

## Data and logs

- API data directory can be overridden with `SLAYTHELIST_DATA_DIR`
- The Electron launcher sets that automatically to an app-specific user data folder
- Launcher logs are written to `launcher.log` inside the app's user data `logs` directory
