import AppKit
import CoreGraphics

func captureWindow(_ windowNumber: CGWindowID) -> Data? {
    guard let image = CGWindowListCreateImage(
        .null,
        .optionIncludingWindow,
        windowNumber,
        [.boundsIgnoreFraming, .bestResolution]
    ) else { return nil }
    return pngData(from: image)
}

func captureScreen() -> Data? {
    guard let image = CGWindowListCreateImage(
        CGRect.infinite,
        .optionOnScreenOnly,
        kCGNullWindowID,
        [.bestResolution]
    ) else { return nil }
    return pngData(from: image)
}

private func pngData(from cgImage: CGImage) -> Data? {
    let bitmap = NSBitmapImageRep(cgImage: cgImage)
    return bitmap.representation(using: .png, properties: [:])
}
