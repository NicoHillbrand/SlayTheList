# SlayTheList macOS Overlay Agent

macOS overlay agent for SlayTheList. Replicates the core functionality of the Windows C# overlay agent: connects to the backend via WebSocket, detects game states via screen capture, and renders locked zone overlays on top of the game window.

## Prerequisites

- macOS 13 (Ventura) or later
- Swift 5.9+ (included with Xcode 15+)
- SlayTheList backend API running locally

## Build

```bash
cd desktop/overlay-agent-mac
swift build
```

## Run

```bash
.build/debug/SlayTheListOverlay
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLAYTHELIST_WS_URL` | `ws://localhost:8788/ws` | WebSocket URL for the backend API |

## Screen Recording Permission

The app uses `CGWindowListCreateImage` to capture screenshots for game state detection. macOS requires explicit screen recording permission for this to work.

Grant permission at: **System Settings > Privacy & Security > Screen Recording**

The app will still run without this permission, but game state detection will be skipped (screen captures will return nil).

## How It Works

1. Connects to the backend API via WebSocket to receive overlay state updates
2. Finds the game window by title (configured via the backend)
3. Captures screenshots and sends them to the backend for game state detection
4. Renders transparent overlay windows with locked zones on top of the game
5. Supports gold unlock by clicking the unlock button on locked zones

The app runs as a background agent (no dock icon). It automatically reconnects if the WebSocket connection drops.
