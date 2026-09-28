import { randomUUID } from 'node:crypto';

export interface PetalNativeVisibilityState {
  visible: boolean;
  topmost: boolean;
  minimized: boolean;
  cloaked: boolean;
  desktopOccluded: boolean;
}

/** One bounded request to the existing native helper; no polling while the desktop is idle. */
export class PetalNativeVisibility {
  private pending?: {
    token: string;
    handles: Set<string>;
    resolve(value: Map<string, PetalNativeVisibilityState> | null): void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(private readonly send: (line: string) => boolean) {}
  read(handles: readonly string[]) {
    this.dispose();
    if (!handles.length || handles.length > 256) return Promise.resolve(null);
    return new Promise<Map<string, PetalNativeVisibilityState> | null>((resolve) => {
      const token = randomUUID();
      const timer = setTimeout(() => this.dispose(), 750);
      this.pending = { token, handles: new Set(handles), resolve, timer };
      if (!this.send(`visibility:${token}:${process.pid}:${handles.join(',')}\n`)) this.dispose();
    });
  }
  receive(line: string) {
    if (!line.startsWith('visibility:')) return false;
    const [, token, payload] = line.split(':');
    const pending = this.pending;
    if (!pending || pending.token !== token) return true;
    const states = new Map<string, PetalNativeVisibilityState>();
    for (const item of (payload ?? '').split(',')) {
      const [handle, value] = item.split('@');
      const flags = Number(value);
      if (pending.handles.has(handle) && Number.isInteger(flags) && flags >= 16 && flags <= 63 && flags & 16)
        states.set(handle, {
          visible: Boolean(flags & 1),
          topmost: Boolean(flags & 2),
          minimized: Boolean(flags & 4),
          cloaked: Boolean(flags & 8),
          desktopOccluded: Boolean(flags & 32),
        });
    }
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(states);
    return true;
  }
  dispose() {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
  }
}

export const windowsPetalVisibilitySource = String.raw`
public static class PetalVisibility {
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  private delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int limit);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
  public static string Read(string line) {
    string[] parts = line.Split(':');
    Guid token; uint owner;
    if (parts.Length != 4 || !Guid.TryParse(parts[1], out token) || !uint.TryParse(parts[2], out owner)) return "visibility:invalid:";
    string[] handles = parts[3].Split(',');
    if (handles.Length > 256) return "visibility:" + parts[1] + ":";
    // One Z-order snapshot per batch. WS_VISIBLE alone does not detect the
    // desktop surface covering an otherwise visible, topmost tool window.
    var order = new System.Collections.Generic.Dictionary<IntPtr, int>();
    var desktops = new System.Collections.Generic.List<Tuple<int, Rect>>();
    EnumWindows((window, data) => {
      int index = order.Count;
      if (index >= 4096) return false;
      order[window] = index;
      if (!IsWindowVisible(window)) return true;
      var name = new System.Text.StringBuilder(128);
      GetClassName(window, name, name.Capacity);
      if (name.ToString() != "Progman" && name.ToString() != "WorkerW") return true;
      Rect rect; int cloaked;
      if (GetWindowRect(window, out rect) && DwmGetWindowAttribute(window, 14, out cloaked, 4) == 0 && cloaked == 0)
        desktops.Add(Tuple.Create(index, rect));
      return true;
    }, IntPtr.Zero);
    var result = new System.Collections.Generic.List<string>();
    foreach (string raw in handles) {
      long value; uint process;
      if (!long.TryParse(raw, out value)) continue;
      IntPtr window = new IntPtr(value);
      if (GetWindowThreadProcessId(window, out process) == 0 || process != owner) continue;
      int cloaked;
      if (DwmGetWindowAttribute(window, 14, out cloaked, 4) != 0) continue;
      int flags = 16 | (IsWindowVisible(window) ? 1 : 0) | ((GetWindowLongPtr(window, -20).ToInt64() & 8) != 0 ? 2 : 0)
        | (IsIconic(window) ? 4 : 0) | (cloaked != 0 ? 8 : 0);
      int index; Rect bounds;
      if (order.TryGetValue(window, out index) && GetWindowRect(window, out bounds)) {
        foreach (var desktop in desktops) {
          Rect rect = desktop.Item2;
          if (desktop.Item1 < index && bounds.Left < rect.Right && bounds.Right > rect.Left &&
              bounds.Top < rect.Bottom && bounds.Bottom > rect.Top) { flags |= 32; break; }
        }
      }
      result.Add(raw + "@" + flags.ToString(CultureInfo.InvariantCulture));
    }
    return "visibility:" + parts[1] + ":" + string.Join(",", result.ToArray());
  }
}
`;
