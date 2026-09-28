/** Runs in a hidden helper, leaving Electron's main loop free of native keyboard hooks.
 * Only shortcut signals and the watched release token/physical point leave this process.
 */
import { windowsPetalVisibilitySource } from '@/main/desktop-petals/petal-native-visibility';

export const windowsPetalInputSource = String.raw`
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class PetalInput {
  [StructLayout(LayoutKind.Sequential)]
  private struct CursorPoint { public int X; public int Y; }
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetPhysicalCursorPos(out CursorPoint point);
  private delegate IntPtr KeyboardProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int kind, KeyboardProc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
  private delegate void WinEventProc(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time);
  [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEventProc callback, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int limit);

  private static readonly Stopwatch Clock = Stopwatch.StartNew();
  private static readonly KeyboardProc Callback = OnKeyboard;
  private static readonly TextWriter Output = TextWriter.Synchronized(Console.Out);
  private static readonly object PointerLock = new object();
  private static readonly ApplicationContext Context = new ApplicationContext();
  private static readonly System.Windows.Forms.Timer Pump = new System.Windows.Forms.Timer();
  private static IntPtr Hook;
  private static IntPtr ForegroundHook;
  private static readonly WinEventProc ForegroundCallback = OnForeground;
  private static long ForegroundChanged;
  private static long DesktopStarted = -1;
  private static System.Threading.Timer Pointer;
  private static int Watch;
  private static int Control;
  private static bool Clean;
  private static long Pressed;
  private static long LastTap = -1000;
  private static int Toggle;
  private static int Desktop;
  private static bool DesktopKey;
  private static volatile bool Quit;

  private static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
  private static void OnForeground(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time) {
    ForegroundChanged = Clock.ElapsedMilliseconds;
    var name = new System.Text.StringBuilder(128);
    GetClassName(window, name, name.Capacity);
    if (name.ToString() == "Progman" || name.ToString() == "WorkerW") Interlocked.Exchange(ref Desktop, 1);
  }
  private static bool Modified() {
    return Down(0x10) || Down(0x12) || Down(0x5B) || Down(0x5C) || Down(1) || Down(2);
  }
  private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data) {
    if (code >= 0 && (Marshal.ReadInt32(data, 8) & 0x10) == 0) {
      int key = Marshal.ReadInt32(data);
      int kind = message.ToInt32();
      bool down = kind == 0x100 || kind == 0x104;
      bool up = kind == 0x101 || kind == 0x105;
      bool ctrl = key == 0x11 || key == 0xA2 || key == 0xA3;
      if (key == 0x44) {
        if (down && !DesktopKey && (Down(0x5B) || Down(0x5C)) && !Down(0x11) && !Down(0x12))
          Interlocked.Exchange(ref Desktop, 1);
        DesktopKey = down;
      }
      long now = Clock.ElapsedMilliseconds;
      if (!ctrl && down) { Clean = false; LastTap = -1000; }
      if (ctrl && down && Control == 0) {
        Control = key;
        Pressed = now;
        Clean = !Modified();
      } else if (ctrl && down && key != Control) {
        Clean = false;
        LastTap = -1000;
      }
      if (ctrl && up && key == Control) {
        Control = 0;
        if (Clean && now - Pressed <= 250 && !Modified()) {
          if (now - LastTap <= 400) { Interlocked.Increment(ref Toggle); LastTap = -1000; }
          else LastTap = now;
        } else LastTap = -1000;
        Clean = false;
      }
    }
    return CallNextHookEx(Hook, code, message, data);
  }
  private static void WatchPointer(int id) {
    lock (PointerLock) {
      if (Pointer != null) Pointer.Dispose();
      Watch = id;
      Pointer = id <= 0 ? null : new System.Threading.Timer(delegate {
        lock (PointerLock) {
          if (Watch != id || Down(GetSystemMetrics(23) == 0 ? 1 : 2)) return;
          // Freeze the physical point when release is observed, not when Electron drains stdout.
          CursorPoint point;
          bool sampled = GetPhysicalCursorPos(out point);
          Watch = 0;
          Pointer.Dispose();
          Pointer = null;
          Output.WriteLine(sampled
            ? string.Format(CultureInfo.InvariantCulture, "released:{0}:{1}:{2}", id, point.X, point.Y)
            : string.Format(CultureInfo.InvariantCulture, "unavailable:{0}", id));
          Output.Flush();
        }
      }, null, 0, 16);
    }
  }
  private static void ReadCommands() {
    try {
      string line;
      while ((line = Console.ReadLine()) != null) {
        int id;
        if (int.TryParse(line, out id)) WatchPointer(id);
        else if (line.StartsWith("visibility:")) { Output.WriteLine(PetalVisibility.Read(line)); Output.Flush(); }
        else if (line == "quit") break;
      }
    } finally { Quit = true; }
  }
  public static void Run() {
    Hook = SetWindowsHookEx(13, Callback, GetModuleHandle(null), 0);
    if (Hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    ForegroundHook = SetWinEventHook(3, 3, IntPtr.Zero, ForegroundCallback, 0, 0, 0);
    Pump.Interval = 30;
    Pump.Tick += delegate {
      if (Quit) { Context.ExitThread(); return; }
      int count = Interlocked.Exchange(ref Toggle, 0);
      for (int i = 0; i < count; i++) Output.WriteLine("toggle");
      long now = Clock.ElapsedMilliseconds;
      if (Interlocked.Exchange(ref Desktop, 0) > 0) DesktopStarted = now;
      // Key-down is only a trigger. Wait for key release and a quiet foreground
      // transition before the main process checks the actual HWND/DWM state.
      bool desktop = DesktopStarted >= 0 && ((now - DesktopStarted >= 350 && now - ForegroundChanged >= 150
        && !Down(0x5B) && !Down(0x5C)) || now - DesktopStarted >= 1500);
      if (desktop) DesktopStarted = -1;
      if (desktop) Output.WriteLine("desktop");
      if (count > 0 || desktop) Output.Flush();
    };
    try {
      Pump.Start();
      var input = new Thread(ReadCommands);
      input.IsBackground = true;
      input.Start();
      Output.WriteLine("ready");
      Output.Flush();
      Application.Run(Context);
    } finally {
      Pump.Dispose();
      WatchPointer(0);
      UnhookWindowsHookEx(Hook);
      if (ForegroundHook != IntPtr.Zero) UnhookWinEvent(ForegroundHook);
      Context.Dispose();
    }
  }
}
${windowsPetalVisibilitySource}
`;

export type WindowsPetalRelease = { kind: 'released'; point: { x: number; y: number } } | { kind: 'unavailable' };

/** Ignore other watches; a failed or malformed sample must not invent a release point. */
export function parseWindowsPetalRelease(line: string, id: number): WindowsPetalRelease | null {
  if (line === `unavailable:${id}`) return { kind: 'unavailable' };
  if (line !== `released:${id}` && !line.startsWith(`released:${id}:`)) return null;
  const sample = /^released:[0-9]+:(-?[0-9]+):(-?[0-9]+)$/.exec(line);
  if (!sample) return { kind: 'unavailable' };
  const x = Number(sample[1]),
    y = Number(sample[2]);
  if (![x, y].every((value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647))
    return { kind: 'unavailable' };
  return { kind: 'released', point: { x, y } };
}
