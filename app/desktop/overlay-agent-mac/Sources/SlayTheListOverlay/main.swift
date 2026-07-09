import AppKit

// Make this a background agent (no dock icon)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let controller = OverlayController()
controller.start()

app.run()
