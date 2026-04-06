"""Data models matching the Windows overlay agent's JSON contracts."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Zone:
    id: str = ""
    name: str = ""
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0
    locked: bool = False
    unlockMode: str = "todos"  # "todos" | "gold"
    goldCost: int = 0


@dataclass
class ZoneState:
    zone: Zone = field(default_factory=Zone)
    requiredTodoTitles: list[str] = field(default_factory=list)
    isLocked: bool = False
    goldUnlockActive: bool = False
    cooldownExpiresAt: Optional[str] = None
    blockId: Optional[str] = None
    blockUnlockMode: str = "individual"  # "individual" | "shared"


@dataclass
class GameWindow:
    titleHint: str = "Slay the Spire 2"


@dataclass
class DetectedGameState:
    gameStateId: Optional[str] = None
    gameStateName: Optional[str] = None
    confidence: float = 0.0
    detectedAt: Optional[str] = None


@dataclass
class GameState:
    id: str = ""
    name: str = ""
    enabled: bool = True
    matchThreshold: float = 0.8
    alwaysDetect: bool = False


@dataclass
class OverlayState:
    gameWindow: GameWindow = field(default_factory=GameWindow)
    zones: list[ZoneState] = field(default_factory=list)
    detectedGameState: Optional[DetectedGameState] = None
    gameStates: list[GameState] = field(default_factory=list)
    lastUpdatedAt: Optional[str] = None
    showDetectionIndicator: bool = False


def parse_overlay_state(data: dict) -> OverlayState:
    """Parse a raw JSON dict into an OverlayState."""
    state = OverlayState()

    gw = data.get("gameWindow", {})
    state.gameWindow = GameWindow(titleHint=gw.get("titleHint", "Slay the Spire 2"))

    for z in data.get("zones", []):
        zd = z.get("zone", {})
        zone = Zone(
            id=zd.get("id", ""),
            name=zd.get("name", ""),
            x=zd.get("x", 0),
            y=zd.get("y", 0),
            width=zd.get("width", 0),
            height=zd.get("height", 0),
            locked=zd.get("locked", False),
            unlockMode=zd.get("unlockMode", "todos"),
            goldCost=zd.get("goldCost", 0),
        )
        zs = ZoneState(
            zone=zone,
            requiredTodoTitles=z.get("requiredTodoTitles", []),
            isLocked=z.get("isLocked", False),
            goldUnlockActive=z.get("goldUnlockActive", False),
            cooldownExpiresAt=z.get("cooldownExpiresAt"),
            blockId=z.get("blockId"),
            blockUnlockMode=z.get("blockUnlockMode", "individual"),
        )
        state.zones.append(zs)

    dgs = data.get("detectedGameState")
    if dgs:
        state.detectedGameState = DetectedGameState(
            gameStateId=dgs.get("gameStateId"),
            gameStateName=dgs.get("gameStateName"),
            confidence=dgs.get("confidence", 0.0),
            detectedAt=dgs.get("detectedAt"),
        )

    for gs in data.get("gameStates", []):
        state.gameStates.append(GameState(
            id=gs.get("id", ""),
            name=gs.get("name", ""),
            enabled=gs.get("enabled", True),
            matchThreshold=gs.get("matchThreshold", 0.8),
            alwaysDetect=gs.get("alwaysDetect", False),
        ))

    state.lastUpdatedAt = data.get("lastUpdatedAt")
    state.showDetectionIndicator = data.get("showDetectionIndicator", False)

    return state
