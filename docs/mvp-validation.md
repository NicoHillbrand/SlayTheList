# MVP Validation Checklist

## Setup

1. `npm install`
2. Run API: `npm run dev:api`
3. Run web app: `npm run dev:web`
4. Run overlay agent from Visual Studio (`desktop/overlay-agent/SlayTheList.OverlayAgent.sln`)
5. Launch Slay the Spire 2 in borderless/windowed mode.

## Functional checks

- Create a todo in the web app and confirm it appears in list after refresh/reload.
- Create a lock zone and assign that todo as a requirement.
- Confirm overlay shows a red locked rectangle over game.
- Confirm clicks in that area are blocked while todo is active.
- Mark todo done in web app and verify zone unlocks within 1 second.
- Restart API and ensure todos + zones + requirements persist.

## Known MVP limits

- Exclusive fullscreen game mode is not guaranteed.
- Lock-zone editor uses numeric coordinate controls (no direct drag on canvas yet).
