import CoreGraphics
import Darwin
import Foundation

// Read public aggregate session state; no event tap, input injection, or permission request.
let source = CGEventSourceStateID.combinedSessionState
let otherModifiers: CGEventFlags = [.maskShift, .maskAlternate, .maskCommand, .maskSecondaryFn]
var detector = ControlTapDetector()
var pointerWatch = 0

func emit(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func poll() {
    let leftMouse = CGEventSource.buttonState(source, button: .left)
    let sample = ControlTapSample(
        // This clock includes sleep, so waking cannot join taps across a suspended session.
        time: Double(clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)) / 1_000_000_000,
        leftControl: CGEventSource.keyState(source, key: 59),
        rightControl: CGEventSource.keyState(source, key: 62),
        otherModifier: !CGEventSource.flagsState(source).intersection(otherModifiers).isEmpty,
        mouseDown: leftMouse || CGEventSource.buttonState(source, button: .right)
            || CGEventSource.buttonState(source, button: .center),
        keyDownCount: CGEventSource.counterForEventType(source, eventType: .keyDown),
        flagsChangedCount: CGEventSource.counterForEventType(source, eventType: .flagsChanged),
        leftMouseDownCount: CGEventSource.counterForEventType(source, eventType: .leftMouseDown),
        rightMouseDownCount: CGEventSource.counterForEventType(source, eventType: .rightMouseDown),
        otherMouseDownCount: CGEventSource.counterForEventType(source, eventType: .otherMouseDown)
    )
    if detector.update(sample) { emit("toggle") }
    if pointerWatch > 0 && !leftMouse {
        let released = pointerWatch
        pointerWatch = 0
        emit("released:\(released)")
    }
}

// Commands and samples run on one queue, so a cancelled watch cannot emit stale releases.
DispatchQueue.global(qos: .utility).async {
    while let line = readLine() {
        if line == "quit" { break }
        if let id = Int(line) {
            DispatchQueue.main.async { pointerWatch = max(0, id) }
        }
    }
    // EOF also stops the helper when the parent terminates unexpectedly.
    DispatchQueue.main.async { exit(0) }
}
poll()
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now() + .milliseconds(16), repeating: .milliseconds(16), leeway: .milliseconds(1))
timer.setEventHandler { poll() }
timer.resume()
emit("ready")
dispatchMain()
