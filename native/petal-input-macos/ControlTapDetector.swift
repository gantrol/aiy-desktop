/// Aggregate input state only: no text, key events, or non-Control key codes.
struct ControlTapSample {
    let time: Double
    let leftControl: Bool
    let rightControl: Bool
    let otherModifier: Bool
    let mouseDown: Bool
    let keyDownCount: UInt32
    let flagsChangedCount: UInt32
    let leftMouseDownCount: UInt32
    let rightMouseDownCount: UInt32
    let otherMouseDownCount: UInt32

    var controlDown: Bool { leftControl || rightControl }
}

/// Matches Windows' two clean taps: each held at most 250 ms, releases within 400 ms.
/// Delayed or ambiguous samples discard the gesture rather than toggle accidentally.
struct ControlTapDetector {
    private var previous: ControlTapSample?
    private var pressedAt: Double?
    private var lastTapAt: Double?

    mutating func update(_ sample: ControlTapSample) -> Bool {
        guard let old = previous else {
            previous = sample
            return false // A Control key already held at startup is not a tap.
        }
        previous = sample
        let elapsed = sample.time - old.time
        let controlEdges = UInt32(old.leftControl != sample.leftControl ? 1 : 0)
            + UInt32(old.rightControl != sample.rightControl ? 1 : 0)
        let flagsEdges = sample.flagsChangedCount &- old.flagsChangedCount
        let interrupted = elapsed < 0 || elapsed > 0.15
            || sample.otherModifier || sample.mouseDown
            || (sample.leftControl && sample.rightControl)
            || sample.keyDownCount != old.keyDownCount
            || sample.leftMouseDownCount != old.leftMouseDownCount
            || sample.rightMouseDownCount != old.rightMouseDownCount
            || sample.otherMouseDownCount != old.otherMouseDownCount
            // Additional modifier edges catch combinations wholly between samples.
            || flagsEdges != controlEdges
            // Switching sides without observing both keys up is ambiguous.
            || (old.controlDown && sample.controlDown && controlEdges != 0)
        if interrupted {
            pressedAt = nil
            lastTapAt = nil
            return false
        }

        if let lastTapAt, sample.time - lastTapAt > 0.4 {
            self.lastTapAt = nil
        }
        if !old.controlDown && sample.controlDown {
            pressedAt = sample.time
        } else if old.controlDown && !sample.controlDown {
            defer { pressedAt = nil }
            guard let pressedAt, sample.time - pressedAt <= 0.25 else {
                lastTapAt = nil
                return false
            }
            if let lastTapAt, sample.time - lastTapAt <= 0.4 {
                self.lastTapAt = nil
                return true
            }
            lastTapAt = sample.time
        } else if let pressedAt, sample.time - pressedAt > 0.25 {
            self.pressedAt = nil
            lastTapAt = nil
        }
        return false
    }
}
