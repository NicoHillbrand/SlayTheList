#!/usr/bin/env python3
"""
SlayTheList — Linux Overlay Agent

A transparent, always-on-top overlay that blocks locked game zones.
Connects to the backend API via WebSocket, receives overlay state,
and renders blocking rectangles over the game window.

Requires: GTK 3, PyGObject, websocket-client, Pillow, mss
Platform: Linux (X11). Wayland support is limited by compositor restrictions.

Environment variables:
  SLAYTHELIST_WS_URL       WebSocket URL (default: ws://localhost:8788/ws)
  SLAYTHELIST_VISUAL_ONLY  "1"/"true"/"yes" to disable click interaction
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gtk, Gdk, GLib, Pango  # noqa: E402

import websocket  # noqa: E402

from models import OverlayState, ZoneState, parse_overlay_state  # noqa: E402
from detection import (  # noqa: E402
    DetectionRefs,
    capture_screen,
    capture_window,
    fetch_detection_refs,
    prepare_pixels,
    score_match,
    send_detected_state,
    DETECTION_INTERVAL_S,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("overlay")

# ── Configuration ───────────────────────────────────────────────────────────

WS_URL = os.environ.get("SLAYTHELIST_WS_URL", "ws://localhost:8788/ws")
VISUAL_ONLY = os.environ.get("SLAYTHELIST_VISUAL_ONLY", "").lower() in ("1", "true", "yes")

TEMPLATE_WIDTH = 1280
TEMPLATE_HEIGHT = 720
SYNC_INTERVAL_MS = 100  # how often to reposition overlay
RECONNECT_DELAYS = [1, 2, 4, 8]  # seconds, exponential backoff

# Colors matching the Windows agent
COLOR_ZONE_BG = (22 / 255, 101 / 255, 52 / 255, 95 / 255)         # dark green fallback
COLOR_ZONE_BORDER = (220 / 255, 22 / 255, 101 / 255, 52 / 255)    # dark red-green
COLOR_LOCK_TEXT = (248 / 255, 248 / 255, 250 / 255, 252 / 255)     # off-white
COLOR_GOLD_BG = (232 / 255, 73 / 255, 53 / 255, 18 / 255)         # dark brown
COLOR_GOLD_BORDER = (210 / 255, 212 / 255, 170 / 255, 71 / 255)   # gold
COLOR_GOLD_TEXT = (255 / 255, 248 / 255, 223 / 255, 139 / 255)     # golden
COLOR_INDICATOR_BG = (17 / 255, 24 / 255, 38 / 255, 180 / 255)    # dark blue
COLOR_INDICATOR_TEXT = (229 / 255, 231 / 255, 235 / 255, 230 / 255)


def _api_base_from_ws(ws_url: str) -> str:
    """Convert ws://host:port/path to http://host:port."""
    url = ws_url
    if url.startswith("wss://"):
        url = "https://" + url[6:]
    elif url.startswith("ws://"):
        url = "http://" + url[5:]
    # Strip path
    parts = url.split("/")
    return "/".join(parts[:3])


API_BASE = _api_base_from_ws(WS_URL)


def _find_overlay_images() -> list[str]:
    """Search upward from script dir for assets/blocked-overlays/."""
    search = Path(__file__).resolve().parent
    for _ in range(8):
        candidate = search / "assets" / "blocked-overlays"
        if candidate.is_dir():
            exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
            return sorted(
                str(p) for p in candidate.iterdir()
                if p.suffix.lower() in exts
            )
        # Also check frontend public dir
        candidate2 = search / "frontend" / "web" / "public" / "blocked-overlays"
        if candidate2.is_dir():
            exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
            return sorted(
                str(p) for p in candidate2.iterdir()
                if p.suffix.lower() in exts
            )
        search = search.parent
    return []


def _hash_zone_id(zone_id: str) -> int:
    """Deterministic hash matching the C# version."""
    h = 0
    for c in zone_id:
        h = (h * 31 + ord(c)) & 0x7FFFFFFF
    return h


def _find_audio_file() -> Optional[str]:
    """Find gold-sack.wav in assets."""
    search = Path(__file__).resolve().parent
    for _ in range(8):
        for name in ("assets/gold-sack.wav", "frontend/web/public/sfx/gold-sack.wav"):
            candidate = search / name
            if candidate.exists():
                return str(candidate)
        search = search.parent
    return None


# ── X11 Window Utilities ───────────────────────────────────────────────────

def _find_game_window(title_hint: str) -> Optional[int]:
    """Find an X11 window by title substring using xdotool."""
    try:
        result = subprocess.run(
            ["xdotool", "search", "--name", title_hint],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip():
            # Return the first match
            return int(result.stdout.strip().split("\n")[0])
    except Exception:
        pass
    return None


def _get_active_window() -> Optional[int]:
    """Get the currently focused X11 window ID."""
    try:
        result = subprocess.run(
            ["xdotool", "getactivewindow"],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip())
    except Exception:
        pass
    return None


def _get_window_geometry(wid: int) -> Optional[tuple[int, int, int, int]]:
    """Get window (x, y, width, height) using xdotool."""
    try:
        result = subprocess.run(
            ["xdotool", "getwindowgeometry", "--shell", str(wid)],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode != 0:
            return None
        vals = {}
        for line in result.stdout.strip().split("\n"):
            if "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = int(v.strip())
        # xdotool gives position; need size from xwininfo
        x = vals.get("X", 0)
        y = vals.get("Y", 0)

        result2 = subprocess.run(
            ["xdotool", "getwindowsize", "--shell", str(wid)],
            capture_output=True, text=True, timeout=2,
        )
        if result2.returncode == 0:
            for line in result2.stdout.strip().split("\n"):
                if "=" in line:
                    k, v = line.split("=", 1)
                    vals[k.strip()] = int(v.strip())

        w = vals.get("WIDTH", 0)
        h = vals.get("HEIGHT", 0)
        if w > 0 and h > 0:
            return (x, y, w, h)
    except Exception:
        pass
    return None


def _get_window_name(wid: int) -> str:
    """Get window title."""
    try:
        result = subprocess.run(
            ["xdotool", "getwindowname", str(wid)],
            capture_output=True, text=True, timeout=2,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


# ── Detection Indicator Window ──────────────────────────────────────────────

class DetectionIndicator(Gtk.Window):
    """Small top-right indicator showing detection status."""

    def __init__(self):
        super().__init__(type=Gtk.WindowType.POPUP)
        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_accept_focus(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)

        # RGBA transparency
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.set_visual(visual)
        self.set_app_paintable(True)

        self._label = Gtk.Label()
        self._label.set_use_markup(True)
        self._label.set_halign(Gtk.Align.CENTER)
        self._label.set_margin_start(10)
        self._label.set_margin_end(10)
        self._label.set_margin_top(6)
        self._label.set_margin_bottom(6)
        self.add(self._label)

        self.connect("draw", self._on_draw)

        self._text = ""
        self._transient_text: Optional[str] = None
        self._transient_until: float = 0.0

        # Position top-right
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        geom = monitor.get_geometry()
        self.set_default_size(200, 30)
        self.move(geom.x + geom.width - 220, geom.y + 8)

    def _on_draw(self, widget, cr):
        cr.set_source_rgba(*COLOR_INDICATOR_BG)
        w, h = self.get_size()
        _rounded_rect(cr, 0, 0, w, h, 6)
        cr.fill()
        return False

    def set_status(self, text: str):
        self._text = text
        self._update_label()

    def set_transient(self, text: str, duration: float = 3.5):
        self._transient_text = text
        self._transient_until = time.time() + duration
        self._update_label()
        GLib.timeout_add(int(duration * 1000) + 100, self._clear_transient)

    def _clear_transient(self):
        if self._transient_text and time.time() >= self._transient_until:
            self._transient_text = None
            self._update_label()
        return False  # don't repeat

    def _update_label(self):
        text = self._transient_text if self._transient_text and time.time() < self._transient_until else self._text
        if text:
            r, g, b, a = COLOR_INDICATOR_TEXT
            color = f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"
            self._label.set_markup(f'<span foreground="{color}" size="small">{GLib.markup_escape_text(text)}</span>')
            self.show_all()
        else:
            self.hide()


# ── Main Overlay Window ─────────────────────────────────────────────────────

def _rounded_rect(cr, x, y, w, h, r):
    """Draw a rounded rectangle path."""
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()


class OverlayWindow(Gtk.Window):
    """Transparent overlay window that renders blocked zones."""

    def __init__(self):
        super().__init__(type=Gtk.WindowType.POPUP)
        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_accept_focus(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)

        # RGBA transparency
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.set_visual(visual)
        self.set_app_paintable(True)

        self.set_events(
            Gdk.EventMask.BUTTON_PRESS_MASK
            | Gdk.EventMask.BUTTON_RELEASE_MASK
            | Gdk.EventMask.POINTER_MOTION_MASK
        )

        self.connect("draw", self._on_draw)
        self.connect("button-release-event", self._on_click)

        # State
        self._overlay_state: Optional[OverlayState] = None
        self._game_wid: Optional[int] = None
        self._game_rect: Optional[tuple[int, int, int, int]] = None
        self._overlay_images = _find_overlay_images()
        self._audio_file = _find_audio_file()
        self._click_zones: list[tuple[float, float, float, float, ZoneState]] = []

        # Focus debouncing (matches Windows: 1 acquire, 3 release ticks)
        self._focus_acquire_counter = 0
        self._focus_release_counter = 0
        self._game_focused = False

        # Detection indicator
        self._indicator = DetectionIndicator()

        # WebSocket + detection threads
        self._ws_connected = False
        self._ws_reconnect_idx = 0
        self._stop_event = threading.Event()

        self._ws_thread = threading.Thread(target=self._ws_loop, daemon=True)
        self._ws_thread.start()

        self._detection_thread = threading.Thread(target=self._detection_loop, daemon=True)
        self._detection_thread.start()

        # Sync timer
        GLib.timeout_add(SYNC_INTERVAL_MS, self._sync_tick)

        logger.info("Overlay agent started (visual_only=%s)", VISUAL_ONLY)
        logger.info("WebSocket: %s", WS_URL)
        logger.info("API base: %s", API_BASE)
        logger.info("Overlay images: %d found", len(self._overlay_images))

    # ── WebSocket ───────────────────────────────────────────────────────────

    def _ws_loop(self):
        """Background WebSocket connection loop with reconnect."""
        # Wait a moment for GTK to initialize
        time.sleep(0.5)

        while not self._stop_event.is_set():
            try:
                ws = websocket.WebSocketApp(
                    WS_URL,
                    on_open=self._ws_on_open,
                    on_message=self._ws_on_message,
                    on_close=self._ws_on_close,
                    on_error=self._ws_on_error,
                )
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                logger.warning("WebSocket error: %s", e)

            if self._stop_event.is_set():
                break

            delay = RECONNECT_DELAYS[min(self._ws_reconnect_idx, len(RECONNECT_DELAYS) - 1)]
            self._ws_reconnect_idx += 1
            logger.info("Reconnecting in %ds...", delay)
            self._stop_event.wait(delay)

    def _ws_on_open(self, ws):
        logger.info("WebSocket connected")
        self._ws_connected = True
        self._ws_reconnect_idx = 0
        GLib.idle_add(self._indicator.set_status, "")

    def _ws_on_message(self, ws, message):
        try:
            envelope = json.loads(message)
            if envelope.get("type") == "overlay_state":
                payload = envelope.get("payload", {})
                state = parse_overlay_state(payload)
                GLib.idle_add(self._apply_state, state)
        except Exception as e:
            logger.warning("Failed to parse message: %s", e)

    def _ws_on_close(self, ws, code, reason):
        logger.info("WebSocket closed: %s %s", code, reason)
        self._ws_connected = False
        GLib.idle_add(self._indicator.set_status, "\u23f8 Detection idle")

    def _ws_on_error(self, ws, error):
        logger.debug("WebSocket error: %s", error)

    # ── State application ───────────────────────────────────────────────────

    def _apply_state(self, state: OverlayState):
        self._overlay_state = state

        if state.showDetectionIndicator:
            dgs = state.detectedGameState
            locked_count = sum(1 for z in state.zones if z.isLocked)
            if dgs and dgs.gameStateName:
                conf = int(dgs.confidence * 100) if dgs.confidence <= 1 else int(dgs.confidence)
                text = f"\U0001f50d {dgs.gameStateName} ({conf}%)"
                if locked_count > 0:
                    text += f" | Locked: {locked_count}"
                self._indicator.set_status(text)
            else:
                self._indicator.set_status("")
        else:
            self._indicator.set_status("")

        self.queue_draw()

    # ── Sync timer ──────────────────────────────────────────────────────────

    def _sync_tick(self) -> bool:
        """Called every SYNC_INTERVAL_MS to reposition the overlay."""
        state = self._overlay_state
        if not state:
            self.hide()
            return True

        locked_zones = [z for z in state.zones if z.isLocked]
        if not locked_zones and not VISUAL_ONLY:
            self.hide()
            return True

        # Find the game window
        title_hint = state.gameWindow.titleHint
        if not self._game_wid:
            self._game_wid = _find_game_window(title_hint)

        # Verify game window still exists
        if self._game_wid:
            name = _get_window_name(self._game_wid)
            if not name or title_hint.lower() not in name.lower():
                self._game_wid = _find_game_window(title_hint)

        # Check focus with debouncing
        active = _get_active_window()
        raw_focused = active is not None and active == self._game_wid

        if raw_focused:
            self._focus_acquire_counter += 1
            self._focus_release_counter = 0
            if self._focus_acquire_counter >= 1:
                self._game_focused = True
        else:
            self._focus_release_counter += 1
            self._focus_acquire_counter = 0
            if self._focus_release_counter >= 3:
                self._game_focused = False

        if not self._game_focused and not any(
            gs.alwaysDetect for gs in state.gameStates if gs.enabled
        ):
            self.hide()
            return True

        # Position overlay
        if self._game_wid:
            geom = _get_window_geometry(self._game_wid)
            if geom:
                x, y, w, h = geom
                self._game_rect = geom

                # Check if approximately fullscreen
                display = Gdk.Display.get_default()
                monitor = display.get_primary_monitor() or display.get_monitor(0)
                screen_geom = monitor.get_geometry()
                if (abs(w - screen_geom.width) < 50 and
                        abs(h - screen_geom.height) < 50):
                    self.move(screen_geom.x, screen_geom.y)
                    self.resize(screen_geom.width, screen_geom.height)
                else:
                    self.move(x, y)
                    self.resize(w, h)

                self.show_all()
                self.queue_draw()
                return True

        # Fallback: fullscreen
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        screen_geom = monitor.get_geometry()
        self.move(screen_geom.x, screen_geom.y)
        self.resize(screen_geom.width, screen_geom.height)
        self.show_all()
        self.queue_draw()
        return True

    # ── Drawing ─────────────────────────────────────────────────────────────

    def _on_draw(self, widget, cr):
        # Clear to fully transparent
        cr.set_operator(0)  # CAIRO_OPERATOR_CLEAR
        cr.paint()
        cr.set_operator(2)  # CAIRO_OPERATOR_OVER

        state = self._overlay_state
        if not state:
            return False

        w_alloc = self.get_allocated_width()
        h_alloc = self.get_allocated_height()
        if w_alloc <= 0 or h_alloc <= 0:
            return False

        scale_x = w_alloc / TEMPLATE_WIDTH
        scale_y = h_alloc / TEMPLATE_HEIGHT

        self._click_zones.clear()

        locked_zones = [z for z in state.zones if z.isLocked]

        if not locked_zones and VISUAL_ONLY:
            # Show "visual only" indicator
            bw, bh = 320, 120
            bx = (w_alloc - bw) / 2
            by = (h_alloc - bh) / 2
            cr.set_source_rgba(70 / 255, 59 / 255, 130 / 255, 246 / 255)
            _rounded_rect(cr, bx, by, bw, bh, 8)
            cr.fill()
            cr.set_source_rgba(1, 1, 1, 0.9)
            self._draw_text(cr, "Overlay visual sign active", bx, by, bw, bh, 14)
            return False

        for zs in locked_zones:
            zone = zs.zone
            zx = zone.x * scale_x
            zy = zone.y * scale_y
            zw = zone.width * scale_x
            zh = zone.height * scale_y

            # Background (image or solid color)
            self._draw_zone_bg(cr, zx, zy, zw, zh, zone.id)

            # Border
            cr.set_source_rgba(*COLOR_ZONE_BORDER)
            cr.set_line_width(2)
            cr.rectangle(zx, zy, zw, zh)
            cr.stroke()

            # Lock text
            min_dim = min(zw, zh)
            narrow_scale = min(1.0, zw / max(zh, 1) * 0.7 + 0.3)
            font_size = max(7, min(13, min_dim * 0.043 * narrow_scale))

            if zone.unlockMode == "gold":
                cost = zone.goldCost
                if zs.blockUnlockMode == "shared":
                    lock_text = f"Unlock all for\n\n{cost} gold"
                else:
                    lock_text = f"Unlock for\n\n{cost} gold"
            else:
                titles = zs.requiredTodoTitles
                if len(titles) == 1:
                    lock_text = f"Unlock via\n\n{titles[0]}"
                elif len(titles) > 1:
                    lock_text = f"Unlock via\n\n{len(titles)} to-dos"
                else:
                    lock_text = "Unlock via\n\nto-do"

            cr.set_source_rgba(*COLOR_LOCK_TEXT)
            self._draw_text(cr, lock_text, zx, zy, zw, zh * 0.65, font_size)

            # Gold unlock button
            if zone.unlockMode == "gold" and not VISUAL_ONLY:
                btn_font = max(11, font_size * 0.82)
                btn_text = f"{zone.goldCost} gold"
                btn_w = len(btn_text) * btn_font * 0.6 + 20
                btn_h = btn_font + 10
                btn_x = zx + (zw - btn_w) / 2
                btn_y = zy + zh * 0.7

                cr.set_source_rgba(*COLOR_GOLD_BG)
                _rounded_rect(cr, btn_x, btn_y, btn_w, btn_h, btn_h / 2)
                cr.fill()

                cr.set_source_rgba(*COLOR_GOLD_BORDER)
                cr.set_line_width(1)
                _rounded_rect(cr, btn_x, btn_y, btn_w, btn_h, btn_h / 2)
                cr.stroke()

                cr.set_source_rgba(*COLOR_GOLD_TEXT)
                self._draw_text(cr, btn_text, btn_x, btn_y, btn_w, btn_h, btn_font)

            # Record clickable area
            if zone.unlockMode == "gold" and not VISUAL_ONLY:
                self._click_zones.append((zx, zy, zw, zh, zs))

        return False

    def _draw_zone_bg(self, cr, x, y, w, h, zone_id: str):
        """Draw zone background with image or fallback color."""
        if self._overlay_images:
            idx = _hash_zone_id(zone_id) % len(self._overlay_images)
            img_path = self._overlay_images[idx]
            try:
                import cairo
                surface = cairo.ImageSurface.create_from_png(img_path)
                img_w = surface.get_width()
                img_h = surface.get_height()
                if img_w > 0 and img_h > 0:
                    # Scale to fill (UniformToFill equivalent)
                    sx = w / img_w
                    sy = h / img_h
                    scale = max(sx, sy)

                    cr.save()
                    cr.rectangle(x, y, w, h)
                    cr.clip()
                    cr.translate(
                        x + (w - img_w * scale) / 2,
                        y + (h - img_h * scale) / 2,
                    )
                    cr.scale(scale, scale)
                    cr.set_source_surface(surface, 0, 0)
                    cr.paint_with_alpha(0.95)
                    cr.restore()
                    return
            except Exception:
                pass  # Fall through to solid color

        cr.set_source_rgba(*COLOR_ZONE_BG)
        cr.rectangle(x, y, w, h)
        cr.fill()

    def _draw_text(self, cr, text: str, x, y, w, h, font_size: float):
        """Draw centered multiline text."""
        layout = Pango.Layout(self.get_pango_context())
        font_desc = Pango.FontDescription()
        font_desc.set_family("Georgia, serif")
        font_desc.set_weight(Pango.Weight.BOLD)
        font_desc.set_absolute_size(font_size * Pango.SCALE)
        layout.set_font_description(font_desc)
        layout.set_text(text, -1)
        layout.set_alignment(Pango.Alignment.CENTER)
        layout.set_width(int(w * Pango.SCALE))

        ink, logical = layout.get_pixel_extents()
        text_h = logical.height
        tx = x
        ty = y + (h - text_h) / 2

        cr.move_to(tx, ty)
        from gi.repository import PangoCairo
        PangoCairo.show_layout(cr, layout)

    # ── Click handling ──────────────────────────────────────────────────────

    def _on_click(self, widget, event):
        if VISUAL_ONLY:
            return False

        for zx, zy, zw, zh, zs in self._click_zones:
            if zx <= event.x <= zx + zw and zy <= event.y <= zy + zh:
                if zs.zone.unlockMode == "gold":
                    threading.Thread(
                        target=self._do_gold_unlock,
                        args=(zs,),
                        daemon=True,
                    ).start()
                return True
        return False

    def _do_gold_unlock(self, zs: ZoneState):
        """POST gold unlock to API."""
        zone = zs.zone
        try:
            url = f"{API_BASE}/api/zones/{zone.id}/gold-unlock"
            req = urllib.request.Request(url, data=b"", method="POST")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=5) as resp:
                status = resp.status

            if 200 <= status < 300:
                self._play_unlock_sound()
                msg = f"Unlocked {zone.name} for {zone.goldCost} gold"
                GLib.idle_add(self._indicator.set_transient, msg)
            else:
                msg = f"Failed to unlock {zone.name}"
                GLib.idle_add(self._indicator.set_transient, msg)

        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace") if e.fp else ""
            msg = body or f"Failed to unlock {zone.name}"
            GLib.idle_add(self._indicator.set_transient, msg)
        except Exception as e:
            msg = f"Failed to unlock {zone.name}"
            GLib.idle_add(self._indicator.set_transient, msg)

    def _play_unlock_sound(self):
        """Play the gold unlock sound effect."""
        if self._audio_file:
            try:
                subprocess.Popen(
                    ["paplay", self._audio_file],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except FileNotFoundError:
                pass
            try:
                subprocess.Popen(
                    ["aplay", "-q", self._audio_file],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except FileNotFoundError:
                pass

    # ── Detection loop ──────────────────────────────────────────────────────

    def _detection_loop(self):
        """Background thread for local game-state detection."""
        # Wait for initial connection
        time.sleep(3)

        cached_refs: Optional[DetectionRefs] = None

        while not self._stop_event.is_set():
            try:
                state = self._overlay_state
                if not state or not self._ws_connected:
                    self._stop_event.wait(DETECTION_INTERVAL_S)
                    continue

                game_states = [gs for gs in state.gameStates if gs.enabled]
                if not game_states:
                    self._stop_event.wait(DETECTION_INTERVAL_S)
                    continue

                should_detect = self._game_focused or any(gs.alwaysDetect for gs in game_states)
                if not should_detect:
                    self._stop_event.wait(DETECTION_INTERVAL_S)
                    continue

                # Refresh refs if stale
                if not cached_refs or cached_refs.is_stale():
                    new_refs = fetch_detection_refs(API_BASE)
                    if new_refs:
                        cached_refs = new_refs

                if not cached_refs or not cached_refs.refs:
                    self._stop_event.wait(DETECTION_INTERVAL_S)
                    continue

                # Capture
                img = None
                if self._game_focused and self._game_wid:
                    img = capture_window(self._game_wid)
                if not img:
                    img = capture_screen()
                if not img:
                    self._stop_event.wait(DETECTION_INTERVAL_S)
                    continue

                # Score each reference
                best_id = None
                best_name = None
                best_score = 0.0
                best_threshold = 0.8

                for ref in cached_refs.refs:
                    ref_pixels = ref.get("pixels", [])
                    regions = ref.get("regions")
                    if not ref_pixels:
                        continue

                    test_pixels = prepare_pixels(img, cached_refs, regions)
                    score = score_match(test_pixels, ref_pixels)

                    threshold = ref.get("threshold", 0.8)
                    if score > best_score:
                        best_score = score
                        best_id = ref.get("id")
                        best_name = ref.get("name")
                        best_threshold = threshold

                if best_score >= best_threshold:
                    send_detected_state(API_BASE, best_id, best_score)
                else:
                    send_detected_state(API_BASE, None, 0.0)

            except Exception as e:
                logger.warning("Detection error: %s", e)

            self._stop_event.wait(DETECTION_INTERVAL_S)

    # ── Cleanup ─────────────────────────────────────────────────────────────

    def shutdown(self):
        self._stop_event.set()


# ── Entry point ─────────────────────────────────────────────────────────────

def main():
    # Check for X11 (Wayland overlay support is very limited)
    session_type = os.environ.get("XDG_SESSION_TYPE", "")
    if session_type == "wayland":
        logger.warning(
            "Wayland detected. The overlay may not work correctly. "
            "Consider running under X11 or XWayland for full support."
        )

    # Check xdotool availability
    try:
        subprocess.run(["xdotool", "version"], capture_output=True, timeout=2)
    except FileNotFoundError:
        logger.error("xdotool not found. Install it: sudo apt install xdotool")
        sys.exit(1)

    overlay = OverlayWindow()

    def on_destroy(*args):
        overlay.shutdown()
        Gtk.main_quit()

    overlay.connect("destroy", on_destroy)

    try:
        Gtk.main()
    except KeyboardInterrupt:
        overlay.shutdown()


if __name__ == "__main__":
    main()
