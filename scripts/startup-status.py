#!/usr/bin/env python3
"""
SlayTheList — Startup Status GUI (Linux / macOS — tkinter)
Launched by start.sh / start.command to show real-time service health.

Usage: python3 startup-status.py --web-port 4000 --api-port 8788 [--has-overlay]
"""

import argparse
import sys
import urllib.request
import subprocess
import threading

try:
    import tkinter as tk
except ImportError:
    print("tkinter not available — skipping startup GUI")
    sys.exit(0)


def check_endpoint(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2):
            return True
    except Exception:
        return False


def check_overlay_process() -> bool:
    try:
        result = subprocess.run(
            ["pgrep", "-f", "overlay_agent.py"],
            capture_output=True, timeout=2,
        )
        return result.returncode == 0
    except Exception:
        return False


class StatusApp:
    COLOR_BG = "#1a1a2e"
    COLOR_FG = "#e0e0e0"
    COLOR_GREEN = "#32cd32"
    COLOR_YELLOW = "#ffd700"
    COLOR_RED = "#ff6347"
    COLOR_GRAY = "#555555"
    COLOR_ACCENT = "#c084fc"
    COLOR_DIM = "#666666"

    def __init__(self, api_port: int, web_port: int, has_overlay: bool):
        self.api_port = api_port
        self.web_port = web_port
        self.has_overlay = has_overlay

        self.root = tk.Tk()
        self.root.title("SlayTheList")
        self.root.configure(bg=self.COLOR_BG)
        self.root.resizable(False, False)
        self.root.geometry("340x260")

        # Center on screen
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = (sw - 340) // 2
        y = (sh - 260) // 2
        self.root.geometry(f"+{x}+{y}")

        frame = tk.Frame(self.root, bg=self.COLOR_BG, padx=24, pady=20)
        frame.pack(fill=tk.BOTH, expand=True)

        # Title
        tk.Label(
            frame, text="SlayTheList", font=("Helvetica", 20, "bold"),
            fg=self.COLOR_ACCENT, bg=self.COLOR_BG,
        ).pack(pady=(0, 16))

        # Service rows
        self.api_dot, self.api_text = self._make_row(frame, "API Server")
        self.web_dot, self.web_text = self._make_row(frame, "Web App")
        self.overlay_dot, self.overlay_text = self._make_row(frame, "Overlay Agent")

        # Footer
        self.footer = tk.Label(
            frame, text="Checking services...", font=("Helvetica", 10),
            fg=self.COLOR_DIM, bg=self.COLOR_BG,
        )
        self.footer.pack(side=tk.BOTTOM, pady=(16, 0))

        self._poll()

    def _make_row(self, parent, label: str):
        row = tk.Frame(parent, bg=self.COLOR_BG)
        row.pack(fill=tk.X, pady=4)

        canvas = tk.Canvas(
            row, width=14, height=14, bg=self.COLOR_BG,
            highlightthickness=0,
        )
        dot = canvas.create_oval(1, 1, 13, 13, fill=self.COLOR_GRAY, outline="")
        canvas.pack(side=tk.LEFT, padx=(0, 10))

        tk.Label(
            row, text=label, font=("Helvetica", 13),
            fg=self.COLOR_FG, bg=self.COLOR_BG, anchor="w",
        ).pack(side=tk.LEFT)

        status = tk.Label(
            row, text="starting...", font=("Helvetica", 11),
            fg=self.COLOR_DIM, bg=self.COLOR_BG, anchor="e",
        )
        status.pack(side=tk.RIGHT)

        return (canvas, dot), status

    def _set_status(self, dot_pair, text_label, color, text):
        canvas, dot = dot_pair
        canvas.itemconfig(dot, fill=color)
        text_label.config(text=text, fg=color)

    def _poll(self):
        def check():
            api_ok = check_endpoint(f"http://localhost:{self.api_port}/api/health")
            if not api_ok:
                api_ok = check_endpoint(f"http://localhost:{self.api_port}/")
            web_ok = check_endpoint(f"http://localhost:{self.web_port}/")
            overlay_ok = check_overlay_process() if self.has_overlay else None
            self.root.after(0, self._update_ui, api_ok, web_ok, overlay_ok)

        threading.Thread(target=check, daemon=True).start()

    def _update_ui(self, api_ok, web_ok, overlay_ok):
        if api_ok:
            self._set_status(self.api_dot, self.api_text, self.COLOR_GREEN, f"port {self.api_port}")
        else:
            self._set_status(self.api_dot, self.api_text, self.COLOR_YELLOW, "starting...")

        if web_ok:
            self._set_status(self.web_dot, self.web_text, self.COLOR_GREEN, f"port {self.web_port}")
        else:
            self._set_status(self.web_dot, self.web_text, self.COLOR_YELLOW, "starting...")

        if overlay_ok is True:
            self._set_status(self.overlay_dot, self.overlay_text, self.COLOR_GREEN, "running")
        elif overlay_ok is False:
            self._set_status(self.overlay_dot, self.overlay_text, self.COLOR_RED, "not found")
        else:
            self._set_status(self.overlay_dot, self.overlay_text, self.COLOR_GRAY, "not installed")

        if api_ok and web_ok:
            self.footer.config(
                text=f"All services running \u2014 http://localhost:{self.web_port}",
                fg=self.COLOR_GREEN,
            )
        else:
            count = sum(1 for x in (api_ok, web_ok) if x)
            self.footer.config(
                text=f"Starting services... ({count}/2 ready)",
                fg=self.COLOR_YELLOW,
            )

        # Poll again in 2 seconds
        self.root.after(2000, self._poll)

    def run(self):
        self.root.mainloop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-port", type=int, default=8788)
    parser.add_argument("--web-port", type=int, default=4000)
    parser.add_argument("--has-overlay", action="store_true")
    args = parser.parse_args()

    app = StatusApp(args.api_port, args.web_port, args.has_overlay)
    app.run()


if __name__ == "__main__":
    main()
