using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Runs in its own STA process. Delayed clipboard rendering and image codecs cannot block Electron.
public sealed partial class AiyClipboard : Form {
    [DllImport("user32.dll")] static extern bool AddClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] static extern bool RemoveClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
    const int ImageLimit = 24 * 1024 * 1024;
    const int TextLimit = 262144;
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 36 * 1024 * 1024 };
    readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 100 };
    readonly int parent;
    DateTime heartbeat = DateTime.UtcNow;
    bool recording, files, waiting, dirty;
    uint observed;
    HashSet<string> excluded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    AiyCapture.Overlay overlay;
    string captureId;
    int queued;

    public AiyClipboard(int owner) {
        parent = owner;
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        Size = new Size(1, 1);
        Opacity = 0;
        if (!AddClipboardFormatListener(Handle)) throw new InvalidOperationException("native");
        observed = GetClipboardSequenceNumber();
        timer.Tick += Tick;
        timer.Start();
        var reader = new Thread(() => {
            string line;
            while ((line = Console.ReadLine()) != null) {
                if (line.Length > 36 * 1024 * 1024 || Interlocked.Increment(ref queued) > 8) Environment.Exit(2);
                commands.Enqueue(line);
            }
            Environment.Exit(0);
        });
        reader.IsBackground = true;
        reader.Start();
        Emit(new { kind = "ready" });
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x031D && recording) dirty = true;
        base.WndProc(ref message);
    }
    protected override void OnFormClosed(FormClosedEventArgs e) {
        RemoveClipboardFormatListener(Handle);
        timer.Dispose();
        if (overlay != null) overlay.Stop();
        base.OnFormClosed(e);
        Application.ExitThread();
    }
    void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    static string ReadText(IDataObject data, string format) {
        if (!data.GetDataPresent(format, false)) return "";
        string value = data.GetData(format, false) as string ?? "";
        if (value.Length > TextLimit) throw new InvalidOperationException("tooLarge");
        return value;
    }
    static byte[] Png(Image image) {
        if ((long)image.Width * image.Height > 20000000) throw new InvalidOperationException("tooLarge");
        using (var output = new MemoryStream()) {
            image.Save(output, ImageFormat.Png);
            if (output.Length > ImageLimit) throw new InvalidOperationException("tooLarge");
            return output.ToArray();
        }
    }
    static bool IsPrivate(IDataObject data) {
        foreach (string format in new[] { "Clipboard Viewer Ignore", "ExcludeClipboardContentFromMonitorProcessing", "application/x-nspasteboard-concealed" })
            if (data.GetDataPresent(format, false)) return true;
        if (data.GetDataPresent("CanIncludeInClipboardHistory", false)) {
            var stream = data.GetData("CanIncludeInClipboardHistory", false) as MemoryStream;
            // Unrecognized opt-out data is private too.
            if (stream == null || stream.Length < 4 || BitConverter.ToInt32(stream.ToArray(), 0) == 0) return true;
        }
        return false;
    }
    static string ImageReference(IDataObject data, string html) {
        if (data.GetDataPresent(DataFormats.FileDrop, false)) {
            var paths = data.GetData(DataFormats.FileDrop, false) as string[];
            if (paths != null && paths.Length == 1) return paths[0];
        }
        Match match = Regex.Match(html, @"<img\b[^>]*\bsrc\s*=\s*['""](?<src>(?:file|https?):[^'""]+)['""]", RegexOptions.IgnoreCase);
        Uri uri;
        if (match.Success && Uri.TryCreate(System.Net.WebUtility.HtmlDecode(match.Groups["src"].Value), UriKind.Absolute, out uri) && uri.IsFile && !uri.IsUnc)
            return uri.LocalPath;
        if (match.Success) return System.Net.WebUtility.HtmlDecode(match.Groups["src"].Value);
        return "";
    }
    static byte[] ReadImageFile(string reference) {
        // FileDrop/HTML references only, never arbitrary text, network paths, directories or links.
        if (String.IsNullOrEmpty(reference) || Regex.IsMatch(reference, "trash", RegexOptions.IgnoreCase) || !Regex.IsMatch(reference, @"^[A-Za-z]:\\")) return null;
        string extension = Path.GetExtension(reference).ToLowerInvariant();
        if (Array.IndexOf(new[] { ".png", ".jpg", ".jpeg", ".bmp" }, extension) < 0) return null;
        var info = new FileInfo(reference);
        for (DirectoryInfo dir = info.Directory; dir != null; dir = dir.Parent)
            if ((dir.Attributes & FileAttributes.ReparsePoint) != 0) return null;
        if (!info.Exists || info.Length > ImageLimit || (info.Attributes & FileAttributes.ReparsePoint) != 0) return null;
        using (var stream = new FileStream(reference, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            using (var image = Image.FromStream(stream, false, true)) return Png(image);
        }
    }
    void ReadClipboard() {
        uint sequence = GetClipboardSequenceNumber();
        if (sequence == observed) return;
        uint pid;
        GetWindowThreadProcessId(GetClipboardOwner(), out pid);
        string source = "";
        try { using (var process = Process.GetProcessById((int)pid)) source = process.ProcessName; } catch { }
        if (excluded.Contains(source) || excluded.Contains(source + ".exe") || (excluded.Count > 0 && source.Length == 0)) { observed = sequence; return; }
        var data = Clipboard.GetDataObject();
        if (data == null || IsPrivate(data)) { observed = sequence; return; }
        string text = ReadText(data, DataFormats.UnicodeText);
        string html = ReadText(data, DataFormats.Html);
        byte[] image = null;
        // Prefer actual pixels. Some apps offer a dummy Bitmap alongside a valid local image reference.
        string reference = ImageReference(data, html);
        if (data.GetDataPresent("PNG", false)) {
            using (var stream = data.GetData("PNG", false) as MemoryStream) {
                if (stream != null && stream.Length <= ImageLimit)
                    using (var png = Image.FromStream(stream, false, true)) image = Png(png);
            }
        }
        if (image == null && files && reference.Length > 0) {
            try { image = ReadImageFile(reference); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (ArgumentException) { }
        }
        if (image == null && reference.Length == 0 && data.GetDataPresent(DataFormats.Bitmap)) {
            using (var bitmap = data.GetData(DataFormats.Bitmap) as Image) if (bitmap != null) image = Png(bitmap);
        }
        if (GetClipboardSequenceNumber() != sequence) { dirty = true; return; }
        observed = sequence;
        if (image == null && text.Length == 0 && reference.Length == 0) return;
        if (text.Length == 0 && image == null) text = reference;
        waiting = true;
        Emit(new { kind = "clipboard", text = text, html = html, image = image == null ? null : Convert.ToBase64String(image), source = source.Substring(0, Math.Min(80, source.Length)), reference = image == null && reference.Length > 0 });
    }
    void Copy(Dictionary<string, object> command) {
        var data = new DataObject();
        string text = (string)command["text"], html = (string)command["html"];
        if (text.Length > 0) data.SetText(text, TextDataFormat.UnicodeText);
        // Consumers may prefer HTML to pixels. Do not restore expired image URLs over owned PNG data.
        if (html.Length > 0 && command["image"] == null) data.SetData(DataFormats.Html, html);
        Bitmap bitmap = null;
        MemoryStream png = null;
        try {
            if (command["image"] != null) {
                png = new MemoryStream(Convert.FromBase64String((string)command["image"]));
                using (var image = Image.FromStream(png)) bitmap = new Bitmap(image);
                png.Position = 0;
                data.SetData("PNG", false, png);
                data.SetImage(bitmap);
            }
            Clipboard.SetDataObject(data, true, 3, 40);
            observed = GetClipboardSequenceNumber();
            dirty = false;
        } finally { if (bitmap != null) bitmap.Dispose(); if (png != null) png.Dispose(); }
    }
    void Tick(object sender, EventArgs args) {
        ObserveForeground();
        ContinuePaste();
        if ((DateTime.UtcNow - heartbeat).TotalSeconds > 15) { Close(); return; }
        try { using (var process = Process.GetProcessById(parent)) if (process.HasExited) { Close(); return; } }
        catch { Close(); return; }
        string line;
        while (commands.TryDequeue(out line)) {
            Interlocked.Decrement(ref queued);
            string id = "";
            try {
                var command = json.Deserialize<Dictionary<string, object>>(line);
                string kind = (string)command["kind"];
                if (command.ContainsKey("id")) id = (string)command["id"];
                if (kind == "ping") { heartbeat = DateTime.UtcNow; continue; }
                if (kind == "ack") { waiting = false; continue; }
                if (kind == "configure") {
                    recording = (bool)command["recording"];
                    files = (bool)command["files"];
                    excluded.Clear();
                    foreach (object name in (System.Collections.ArrayList)command["excluded"]) excluded.Add((string)name);
                    observed = GetClipboardSequenceNumber(); dirty = false;
                } else if (kind == "copy") Copy(command);
                else if (kind == "remember-target") ObserveForeground();
                else if (kind == "paste") { BeginPaste(command, id); continue; }
                else if (kind == "clear") { Clipboard.Clear(); observed = GetClipboardSequenceNumber(); dirty = false; }
                else if (kind == "capture") {
                    if (overlay != null) throw new InvalidOperationException("busy");
                    string request = id;
                    captureId = request;
                    Thread.CurrentThread.CurrentCulture = System.Globalization.CultureInfo.GetCultureInfo((string)command["locale"]);
                    overlay = new AiyCapture.Overlay((Dictionary<string, object>)command["labels"], (bool)command["keyboard"], Png,
                        (action, image, revision, bounds) => Emit(new { kind = "capture-action", id = request, action = action,
                            image = Convert.ToBase64String(image), revision = revision,
                            partial = overlay != null && overlay.Partial,
                            cursor = overlay != null && overlay.RecordCursor,
                            bounds = new { x = bounds.X, y = bounds.Y, width = bounds.Width, height = bounds.Height } }),
                        () => { overlay = null; captureId = null; Emit(new { kind = "reply", id = request }); });
                    overlay.SetRecordingControl(action => Emit(new { kind = "record-control", id = request, action = action }));
                    overlay.Show();
                    byte[] recovery = command.ContainsKey("recovery") && command["recovery"] is string ? Convert.FromBase64String((string)command["recovery"]) : null;
                    if (!overlay.ConfigureRecovery((string)command["recoveryFile"], recovery, (bool)command["recoveryError"])) overlay.SelectMode((string)command["mode"]);
                    continue;
                } else if (kind == "capture-result") {
                    if (overlay != null && captureId == id) {
                        if (command.ContainsKey("image") && command["image"] is string) overlay.Adopt(Convert.FromBase64String((string)command["image"]));
                        overlay.Result((bool)command["close"], (string)command["error"]);
                    }
                    continue;
                } else if (kind == "capture-record-state") {
                    if (overlay != null && captureId == id) overlay.RecordingState((string)command["phase"], (string)command["message"]);
                    continue;
                } else if (kind == "capture-cancel") {
                    if (overlay != null && captureId == id) overlay.Stop();
                    continue;
                } else if (kind == "capture-focus") {
                    if (overlay != null && captureId == id && overlay.Visible) overlay.Activate();
                    continue;
                }
                if (id.Length > 0) Emit(new { kind = "reply", id = id });
            } catch (Exception exception) {
                string code = exception.Message == "tooLarge" ? "tooLarge" : exception.Message == "pasteTarget" ? "pasteTarget" : "native";
                Emit(new { kind = id.Length > 0 ? "reply" : "error", id = id, error = code });
            }
        }
        if (!recording || waiting || !dirty || overlay != null) return;
        dirty = false;
        try { ReadClipboard(); }
        catch (ExternalException) { dirty = true; }
        catch (Exception exception) { observed = GetClipboardSequenceNumber(); Emit(new { kind = "error", error = exception.Message == "tooLarge" ? "tooLarge" : "native" }); }
    }
    [STAThread] public static void Run(int parent) {
        Console.InputEncoding = new System.Text.UTF8Encoding(false);
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        Application.EnableVisualStyles();
        using (var listener = new AiyClipboard(parent)) Application.Run();
    }

}
