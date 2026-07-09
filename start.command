#!/bin/bash
# SlayTheList — macOS launcher (double-click in Finder).
# Thin wrapper: all logic lives in start.sh, which handles macOS and Linux.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh" "$@"
