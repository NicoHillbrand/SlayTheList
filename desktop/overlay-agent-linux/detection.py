"""
Local game-state detection via image matching.

Matches the Windows overlay agent's NCC + histogram approach:
- Captures the game window (or full screen for alwaysDetect states)
- Resizes to compareSize x compareSize grayscale
- Scores against reference pixel arrays using NCC (70%) + histogram (30%)
"""

from __future__ import annotations

import json
import logging
import math
import subprocess
import time
import urllib.request
from typing import Optional

from PIL import Image

logger = logging.getLogger("detection")

DETECTION_INTERVAL_S = 0.1  # 100ms
REFERENCE_CACHE_TTL_S = 30.0
NUM_HISTOGRAM_BINS = 32


def _grayscale_pixels(img: Image.Image, size: int) -> list[float]:
    """Resize to size x size and return grayscale floats [0,1]."""
    img = img.resize((size, size), Image.LANCZOS).convert("RGB")
    pixels = list(img.getdata())
    return [(0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0 for r, g, b in pixels]


def _ncc(test: list[float], ref: list[float]) -> float:
    """Normalized cross-correlation, returned in [0, 1]."""
    n = len(test)
    if n == 0 or n != len(ref):
        return 0.0

    mean_t = sum(test) / n
    mean_r = sum(ref) / n

    num = 0.0
    den_t = 0.0
    den_r = 0.0
    for i in range(n):
        dt = test[i] - mean_t
        dr = ref[i] - mean_r
        num += dt * dr
        den_t += dt * dt
        den_r += dr * dr

    denom = math.sqrt(den_t * den_r)
    if denom < 1e-12:
        return 0.0

    raw = num / denom  # [-1, 1]
    return max(0.0, min(1.0, (raw + 1.0) / 2.0))


def _histogram_similarity(test: list[float], ref: list[float]) -> float:
    """32-bin histogram intersection similarity in [0, 1]."""
    n = len(test)
    if n == 0 or n != len(ref):
        return 0.0

    bins_t = [0.0] * NUM_HISTOGRAM_BINS
    bins_r = [0.0] * NUM_HISTOGRAM_BINS

    for i in range(n):
        bt = min(int(test[i] * NUM_HISTOGRAM_BINS), NUM_HISTOGRAM_BINS - 1)
        br = min(int(ref[i] * NUM_HISTOGRAM_BINS), NUM_HISTOGRAM_BINS - 1)
        bins_t[bt] += 1.0
        bins_r[br] += 1.0

    intersection = sum(min(bins_t[j], bins_r[j]) for j in range(NUM_HISTOGRAM_BINS))
    return intersection / n if n > 0 else 0.0


def score_match(test: list[float], ref: list[float]) -> float:
    """Combined NCC (70%) + histogram (30%) score."""
    return _ncc(test, ref) * 0.7 + _histogram_similarity(test, ref) * 0.3


class DetectionRefs:
    """Cached detection references from the API."""

    def __init__(self):
        self.compare_size: int = 64
        self.template_width: int = 1280
        self.template_height: int = 720
        self.refs: list[dict] = []  # [{id, name, threshold, pixels, regions, alwaysDetect}]
        self.fetched_at: float = 0.0

    def is_stale(self) -> bool:
        return (time.time() - self.fetched_at) > REFERENCE_CACHE_TTL_S


def fetch_detection_refs(api_base: str) -> Optional[DetectionRefs]:
    """GET /api/detection-refs and parse into DetectionRefs."""
    try:
        url = f"{api_base}/api/detection-refs"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())

        refs = DetectionRefs()
        refs.compare_size = data.get("compareSize", 64)
        refs.template_width = data.get("templateWidth", 1280)
        refs.template_height = data.get("templateHeight", 720)
        refs.refs = data.get("refs", [])
        refs.fetched_at = time.time()
        return refs
    except Exception as e:
        logger.warning("Failed to fetch detection refs: %s", e)
        return None


def capture_window(window_id: int) -> Optional[Image.Image]:
    """Capture a specific X11 window using xdotool + import (ImageMagick)."""
    try:
        result = subprocess.run(
            ["import", "-window", str(window_id), "png:-"],
            capture_output=True, timeout=5,
        )
        if result.returncode != 0:
            return None
        from io import BytesIO
        return Image.open(BytesIO(result.stdout)).convert("RGB")
    except Exception as e:
        logger.debug("Window capture failed: %s", e)
        return None


def capture_screen() -> Optional[Image.Image]:
    """Capture the full screen using mss."""
    try:
        import mss
        with mss.mss() as sct:
            monitor = sct.monitors[1]  # primary monitor
            shot = sct.grab(monitor)
            return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    except Exception as e:
        logger.debug("Screen capture failed: %s", e)
        return None


def prepare_pixels(
    img: Image.Image,
    refs: DetectionRefs,
    regions: Optional[list[dict]] = None,
) -> list[float]:
    """Convert a captured image to normalized grayscale pixels for comparison."""
    cs = refs.compare_size

    if not regions:
        return _grayscale_pixels(img, cs)

    # Resize to template dimensions, extract regions, concatenate
    tw, th = refs.template_width, refs.template_height
    img = img.resize((tw, th), Image.LANCZOS)

    all_pixels: list[float] = []
    for region in regions:
        rx = max(0, int(region.get("x", 0)))
        ry = max(0, int(region.get("y", 0)))
        rw = int(region.get("width", cs))
        rh = int(region.get("height", cs))
        rx2 = min(rx + rw, tw)
        ry2 = min(ry + rh, th)
        crop = img.crop((rx, ry, rx2, ry2))
        all_pixels.extend(_grayscale_pixels(crop, cs))

    return all_pixels


def send_detected_state(
    api_base: str,
    game_state_id: Optional[str],
    confidence: float,
) -> None:
    """PUT /api/detected-game-state with the detection result."""
    try:
        url = f"{api_base}/api/detected-game-state"
        body = json.dumps({
            "gameStateId": game_state_id,
            "confidence": confidence,
        }).encode()
        req = urllib.request.Request(url, data=body, method="PUT")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception as e:
        logger.warning("Failed to send detected state: %s", e)
