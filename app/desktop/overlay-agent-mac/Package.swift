// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SlayTheListOverlay",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "SlayTheListOverlay",
            path: "Sources/SlayTheListOverlay"
        ),
    ]
)
