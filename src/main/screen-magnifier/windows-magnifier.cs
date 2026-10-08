using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// A host-owned, windowed Magnification API session. No image buffers cross IPC.
public sealed class AiyScreenMagnifier : Form
{
    [StructLayout(LayoutKind.Sequential)]
    struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)]
    struct Transform { public float A, B, C, D, E, F, G, H, I; }

    [DllImport("Magnification.dll")] static extern bool MagInitialize();
    [DllImport("Magnification.dll")] static extern bool MagUninitialize();
    [DllImport("Magnification.dll")] static extern bool MagSetWindowSource(IntPtr window, Rect source);
    [DllImport("Magnification.dll")] static extern bool MagSetWindowTransform(IntPtr window, ref Transform transform);
    [DllImport("Magnification.dll")] static extern bool MagSetWindowFilterList(IntPtr window, uint mode, int count, IntPtr[] windows);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr window, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool InvalidateRect(IntPtr window, IntPtr rect, bool erase);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out int value, int size);
    [DllImport("wtsapi32.dll")] static extern bool WTSRegisterSessionNotification(IntPtr window, uint flags);
    [DllImport("wtsapi32.dll")] static extern bool WTSUnRegisterSessionNotification(IntPtr window);

    readonly IntPtr owner;
    readonly Process host;
    float scale;
    int widthDip, heightDip;
    sealed class Configuration { public float Scale; public int Width, Height; }
    Configuration pendingConfiguration;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Stopwatch heartbeat = Stopwatch.StartNew();
    IntPtr magnifier;
    long lastHeartbeat;
    int stopping;
    bool ready;
    bool failed;
    bool sessionNotifications;
    int quadrant;

    AiyScreenMagnifier(long ownerHandle, int hostPid, float factor, int width, int height)
    {
        owner = new IntPtr(ownerHandle);
        host = Process.GetProcessById(hostPid);
        scale = factor;
        widthDip = width;
        heightDip = height;
        FormBorderStyle = FormBorderStyle.None;
        AutoScaleMode = AutoScaleMode.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = SystemColors.WindowText;
        Bounds = new Rectangle(-32000, -32000, width, height);
        timer.Interval = 33;
        timer.Tick += delegate { UpdateLens(); };
    }

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams value = base.CreateParams;
            // Layered, transparent to clicks, tool window, no activation, topmost.
            value.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x8000000 | 0x8;
            return value;
        }
    }

    protected override void OnShown(EventArgs args)
    {
        base.OnShown(args);
        sessionNotifications = WTSRegisterSessionNotification(Handle, 0);
        if (!sessionNotifications) { Fail(); return; }
        // WC_MAGNIFIER child. The host is opaque; input always reaches the underlying app.
        if (!SetLayeredWindowAttributes(Handle, 0, 255, 2)) { Fail(); return; }
        // Do not set MS_SHOWMAGNIFIEDCURSOR: an enlarged I-beam obscures the text.
        magnifier = CreateWindowEx(0, "Magnifier", "", 0x40000000 | 0x10000000,
            1, 1, widthDip - 2, heightDip - 2, Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        Transform transform = new Transform { A = scale, E = scale, I = 1 };
        if (magnifier == IntPtr.Zero || !MagSetWindowTransform(magnifier, ref transform) ||
            !MagSetWindowFilterList(magnifier, 0, 1, new IntPtr[] { Handle })) { Fail(); return; }
        Thread input = new Thread(ReadHost);
        input.IsBackground = true;
        input.Start();
        UpdateLens();
        if (!IsDisposed) timer.Start();
    }

    void ReadHost()
    {
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                string[] values = line.Split(':');
                float factor;
                int width, height;
                if (values.Length != 4 || values[0] != "ping" ||
                    !float.TryParse(values[1], NumberStyles.Float, CultureInfo.InvariantCulture, out factor) ||
                    (factor != 1.5f && factor != 2 && factor != 3 && factor != 4) ||
                    !int.TryParse(values[2], out width) || width < 240 || width > 960 ||
                    !int.TryParse(values[3], out height) || height < 120 || height > 480) break;
                Interlocked.Exchange(ref pendingConfiguration,
                    new Configuration { Scale = factor, Width = width, Height = height });
                Interlocked.Exchange(ref lastHeartbeat, heartbeat.ElapsedMilliseconds);
            }
        }
        finally { Interlocked.Exchange(ref stopping, 1); }
    }

    bool OwnerVisible()
    {
        int cloaked;
        return IsWindow(owner) && IsWindowVisible(owner) && !IsIconic(owner) &&
            DwmGetWindowAttribute(owner, 14, out cloaked, 4) == 0 && cloaked == 0;
    }

    void UpdateLens()
    {
        if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0 || host.HasExited || !OwnerVisible() ||
            heartbeat.ElapsedMilliseconds - Interlocked.Read(ref lastHeartbeat) > 3000)
        { Close(); return; }
        Configuration configuration = Interlocked.Exchange(ref pendingConfiguration, null);
        if (configuration != null &&
            (configuration.Scale != scale || configuration.Width != widthDip || configuration.Height != heightDip))
        {
            Transform transform = new Transform { A = configuration.Scale, E = configuration.Scale, I = 1 };
            if (!MagSetWindowTransform(magnifier, ref transform)) { Fail(); return; }
            scale = configuration.Scale;
            widthDip = configuration.Width;
            heightDip = configuration.Height;
        }
        Point pointer;
        if (!GetCursorPos(out pointer)) { Fail(); return; }
        MonitorInfo info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        if (!GetMonitorInfo(MonitorFromPoint(pointer, 2), ref info)) { Fail(); return; }
        // Moving first updates this per-monitor-aware window's DPI synchronously.
        int dpi = (int)GetDpiForWindow(Handle);
        if (dpi <= 0) { Fail(); return; }
        int width = Math.Min(widthDip * dpi / 96, info.Work.Right - info.Work.Left);
        int height = Math.Min(heightDip * dpi / 96, info.Work.Bottom - info.Work.Top);
        Rect ownerRect;
        if (!GetWindowRect(owner, out ownerRect)) { Close(); return; }
        Rectangle bounds = PlaceLens(pointer, info.Work, ownerRect, width, height, 24 * dpi / 96);
        if (!SetWindowPos(Handle, new IntPtr(-1), bounds.X, bounds.Y, bounds.Width, bounds.Height, 0x10))
        { Fail(); return; }
        int nextDpi = (int)GetDpiForWindow(Handle);
        if (nextDpi != dpi && nextDpi > 0)
        {
            width = Math.Min(widthDip * nextDpi / 96, info.Work.Right - info.Work.Left);
            height = Math.Min(heightDip * nextDpi / 96, info.Work.Bottom - info.Work.Top);
            bounds = PlaceLens(pointer, info.Work, ownerRect, width, height, 24 * nextDpi / 96);
            if (!SetWindowPos(Handle, new IntPtr(-1), bounds.X, bounds.Y, width, height, 0x10))
            { Fail(); return; }
        }
        int contentWidth = Math.Max(1, width - 2), contentHeight = Math.Max(1, height - 2);
        if (!SetWindowPos(magnifier, IntPtr.Zero, 1, 1, contentWidth, contentHeight, 0x14))
        { Fail(); return; }
        int sourceWidth = Math.Max(1, (int)Math.Ceiling(contentWidth / scale));
        int sourceHeight = Math.Max(1, (int)Math.Ceiling(contentHeight / scale));
        int x = Clamp(pointer.X - sourceWidth / 2, info.Monitor.Left, info.Monitor.Right - sourceWidth);
        int y = Clamp(pointer.Y - sourceHeight / 2, info.Monitor.Top, info.Monitor.Bottom - sourceHeight);
        Rect source = new Rect { Left = x, Top = y, Right = x + sourceWidth, Bottom = y + sourceHeight };
        if (!MagSetWindowSource(magnifier, source)) { Fail(); return; }
        InvalidateRect(magnifier, IntPtr.Zero, true);
        if (!ready) { ready = true; Console.WriteLine("ready"); Console.Out.Flush(); }
    }

    static int Clamp(int value, int min, int max) { return Math.Max(min, Math.Min(value, max)); }

    Rectangle PlaceLens(Point pointer, Rect area, Rect owner, int width, int height, int gap)
    {
        Rectangle flower = Rectangle.FromLTRB(owner.Left, owner.Top, owner.Right, owner.Bottom);
        Rectangle workArea = Rectangle.FromLTRB(area.Left, area.Top, area.Right, area.Bottom);
        int[] xs = { pointer.X + gap, pointer.X - gap - width };
        int[] ys = { pointer.Y - gap - height, pointer.Y + gap };
        Rectangle best = Rectangle.Empty;
        long bestScore = long.MaxValue;
        // Keep the current side until it no longer fits, avoiding edge jitter.
        for (int offset = 0; offset < 4; offset++)
        {
            int index = (quadrant + offset) % 4;
            int x = xs[index % 2], y = ys[index / 2];
            Rectangle unbounded = new Rectangle(x, y, width, height);
            if (workArea.Contains(unbounded) && !unbounded.IntersectsWith(flower))
            { quadrant = index; return unbounded; }
            Rectangle candidate = new Rectangle(Clamp(x, area.Left, area.Right - width),
                Clamp(y, area.Top, area.Bottom - height), width, height);
            Rectangle overlap = Rectangle.Intersect(candidate, flower);
            long score = (long)Math.Max(0, overlap.Width) * Math.Max(0, overlap.Height);
            // Keep the real pointer target exposed even on cramped displays.
            if (candidate.Contains(pointer.X, pointer.Y)) score += (long)width * height;
            if (score < bestScore) { best = candidate; bestScore = score; }
        }
        return best;
    }

    void Fail() { failed = true; Close(); }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x21) { message.Result = new IntPtr(3); return; } // MA_NOACTIVATE
        if (message.Msg == 0x84) { message.Result = new IntPtr(-1); return; } // HTTRANSPARENT
        if (message.Msg == 0x2B1)
        {
            int change = message.WParam.ToInt32();
            if (change == 2 || change == 4 || change == 6 || change == 7) { Close(); return; }
        }
        base.WndProc(ref message);
    }

    protected override void OnHandleDestroyed(EventArgs args)
    {
        if (sessionNotifications) { WTSUnRegisterSessionNotification(Handle); sessionNotifications = false; }
        base.OnHandleDestroyed(args);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { timer.Dispose(); host.Dispose(); }
        base.Dispose(disposing);
    }

    public static void Run(long owner, int hostPid, float scale, int width, int height)
    {
        if (IntPtr.Size != 8 || SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero || !MagInitialize())
            throw new InvalidOperationException("magnifier-unavailable");
        try
        {
            using (AiyScreenMagnifier lens = new AiyScreenMagnifier(owner, hostPid, scale, width, height))
            {
                Application.Run(lens);
                if (lens.failed) throw new InvalidOperationException("magnifier-failed");
            }
        }
        finally { MagUninitialize(); }
    }
}
