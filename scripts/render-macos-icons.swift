import AppKit

guard CommandLine.arguments.count == 4,
      let artwork = NSImage(contentsOfFile: CommandLine.arguments[1]) else {
    fatalError("Expected artwork, macOS icon output, and startup icon output paths")
}

func render(size: Int, inset: CGFloat, radius: CGFloat, output: String) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Unable to allocate the application icon")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill(using: .copy)
    let frame = NSRect(x: inset, y: inset, width: CGFloat(size) - inset * 2, height: CGFloat(size) - inset * 2)
    NSBezierPath(roundedRect: frame, xRadius: radius, yRadius: radius).addClip()
    artwork.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Unable to encode the application icon")
    }
    try png.write(to: URL(fileURLWithPath: output), options: .atomic)
}

// Keep the current artwork intact inside the macOS tile, with transparent outer padding.
try render(size: 1024, inset: 102, radius: 180, output: CommandLine.arguments[2])
try render(size: 64, inset: 0, radius: 0, output: CommandLine.arguments[3])
