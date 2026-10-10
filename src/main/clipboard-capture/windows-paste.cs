// Shares the clipboard helper's STA. Tracks window identity only; never reads target content.
public sealed partial class AiyClipboard {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int count);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyInput { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyInput key; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputUnion value; }
    IntPtr lastTarget, pasteTarget;
    static readonly int helperPid = CurrentProcessId();
    static int CurrentProcessId() { using (var process = Process.GetCurrentProcess()) return process.Id; }
    uint lastTargetPid, pastePid;
    string pasteId;
    DateTime pasteDeadline;
    bool pasteActivated;
    bool ExternalWindow(IntPtr window, out uint pid) {
        pid = 0;
        if (window == IntPtr.Zero || !IsWindow(window) || !IsWindowVisible(window)) return false;
        GetWindowThreadProcessId(window, out pid);
        if (pid == 0 || pid == parent || pid == helperPid) return false;
        var name = new System.Text.StringBuilder(256);
        GetClassName(window, name, name.Capacity);
        string kind = name.ToString();
        return kind != "Shell_TrayWnd" && kind != "Shell_SecondaryTrayWnd" && kind != "Progman" && kind != "WorkerW";
    }
    void ObserveForeground() {
        if (pasteId != null || overlay != null) return;
        IntPtr window = GetForegroundWindow();
        uint pid;
        if (ExternalWindow(window, out pid)) { lastTarget = window; lastTargetPid = pid; }
    }
    void BeginPaste(Dictionary<string, object> command, string id) {
        uint pid;
        if (pasteId != null) throw new InvalidOperationException("busy");
        Copy(command);
        if (!ExternalWindow(lastTarget, out pid) || pid != lastTargetPid)
            throw new InvalidOperationException("pasteTarget");
        pasteTarget = lastTarget;
        pastePid = pid;
        pasteId = id;
        pasteActivated = false;
        pasteDeadline = DateTime.UtcNow.AddSeconds(2);
    }
    static Input Key(ushort key, bool up) {
        return new Input { type = 1, value = new InputUnion { key = new KeyInput { key = key, flags = up ? 2u : 0u } } };
    }
    void ContinuePaste() {
        if (pasteId == null) return;
        uint pid;
        string error = null;
        if (DateTime.UtcNow >= pasteDeadline || !ExternalWindow(pasteTarget, out pid) || pid != pastePid) error = "pasteTarget";
        else {
            // Wait for the user's shortcut modifiers to be released; do not synthesize their key-up events.
            foreach (int key in new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
                if ((GetAsyncKeyState(key) & 0x8000) != 0) return;
            if (!pasteActivated) {
                if (!SetForegroundWindow(pasteTarget)) error = "pasteTarget";
                else { pasteActivated = true; return; }
            } else if (GetForegroundWindow() != pasteTarget) error = "pasteTarget";
            else {
                var keys = new[] { Key(0x11, false), Key(0x56, false), Key(0x56, true), Key(0x11, true) };
                if (SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(Input))) != keys.Length) error = "pasteTarget";
            }
        }
        string id = pasteId;
        pasteId = null;
        Emit(new { kind = "reply", id = id, error = error });
    }
}
