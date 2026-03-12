# Desktop Launcher (No-Terminal Start)

This launcher provides a single executable entry point for local use.

## What it does

- Starts API (`backend/api/dist/server.js`) on port `8788`
- Starts web app in production mode on `http://localhost:3000`
- Waits for both services to be ready
- Opens browser automatically
- Starts overlay agent exe if found
- Stops all child processes when launcher closes

## One-time prerequisites

1. Install Node dependencies:
   - `npm install`
2. Build app artifacts:
   - `npm run build`
3. Build overlay agent exe (optional, for auto-start):
   - Open `desktop/overlay-agent/SlayTheList.OverlayAgent.sln` in Visual Studio and build

## Build launcher exe

Run from repo root:

- `dotnet publish "desktop/launcher/SlayTheList.Launcher/SlayTheList.Launcher.csproj" -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true`

The output exe is in:

- `desktop/launcher/SlayTheList.Launcher/bin/Release/net8.0-windows/win-x64/publish/`

Double-click the published `SlayTheList.Launcher.exe` to run the full stack without terminal windows.
