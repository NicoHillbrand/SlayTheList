import AppKit

class IndicatorWindow: NSWindow {
    private let label = NSTextField(labelWithString: "")

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 220, height: 32),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        ignoresMouseEvents = true
        hasShadow = false

        let container = NSView(frame: contentView!.bounds)
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(white: 0.07, alpha: 0.75).cgColor
        container.layer?.cornerRadius = 6

        label.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = NSColor(white: 0.9, alpha: 0.9)
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)

        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -10),
        ])

        contentView = container
        positionTopRight()
    }

    func positionTopRight() {
        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.visibleFrame
        let x = screenFrame.maxX - frame.width - 8
        let y = screenFrame.maxY - frame.height - 8
        setFrameOrigin(NSPoint(x: x, y: y))
    }

    func update(text: String) {
        label.stringValue = text
        positionTopRight()
    }
}
