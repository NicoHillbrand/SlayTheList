import AppKit
import CoreGraphics

struct GameWindow {
    let windowNumber: CGWindowID
    let ownerPID: pid_t
    let bounds: CGRect
    let title: String
}

func findGameWindow(titleContains: String?) -> GameWindow? {
    guard let titleHint = titleContains, !titleHint.isEmpty else { return nil }

    guard let windowList = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return nil
    }

    for window in windowList {
        guard let name = window[kCGWindowName as String] as? String,
              name.localizedCaseInsensitiveContains(titleHint),
              let windowNumber = window[kCGWindowNumber as String] as? CGWindowID,
              let ownerPID = window[kCGWindowOwnerPID as String] as? pid_t,
              let boundsDict = window[kCGWindowBounds as String] as? [String: Any],
              let boundsRect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
        else { continue }

        // Skip very small windows (menus, tooltips, etc.)
        if boundsRect.width < 200 || boundsRect.height < 200 { continue }

        return GameWindow(
            windowNumber: windowNumber,
            ownerPID: ownerPID,
            bounds: boundsRect,
            title: name
        )
    }
    return nil
}

func isGameWindowFocused(gameWindow: GameWindow?) -> Bool {
    guard let gw = gameWindow else { return false }
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return false }
    return frontApp.processIdentifier == gw.ownerPID
}
