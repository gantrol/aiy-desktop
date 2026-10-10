namespace AiyCapture {
    using System;
    using System.Collections.Generic;
    using System.Drawing;
    using System.Drawing.Imaging;
    using System.Runtime.InteropServices;
    using System.Windows.Forms;

    public sealed partial class Overlay {
        Form acquisition;
        bool partial;
        public bool Partial { get { return partial; } }
        void StartScroll() {
            if (!Selected || busy || edited != null) return;
            var bounds = new Rectangle(Left + selection.X, Top + selection.Y, selection.Width, selection.Height);
            Rectangle controls = ScrollCapture.ControlsBounds(bounds);
            if (controls.IsEmpty) { status.Text = Label("scrollControls"); PlaceTools(); return; }
            var initial = frame.Clone(selection, PixelFormat.Format32bppArgb);
            ownsRecovery = true;
            var panel = new ScrollCapture(bounds, controls, initial, recovery, Label, (image, incomplete) => {
                if (IsDisposed || Disposing) { if (image != null) image.Dispose(); return; }
                if (image != null) { Adopt(encode(image)); partial = incomplete; revision++; image.Dispose(); }
                acquisition = null;
                Show(); Activate(); Result(false, recovery != null && recovery.Failed ? Label("scrollNotSaved") : incomplete ? Label("scrollPartial") : "");
            });
            acquisition = panel;
            Hide(); panel.Show();
            if (IsWindow(previous)) SetForegroundWindow(previous);
        }
    }

    // Keeps only the confirmed strips and one settling frame. Only downward scroll is appended.
    internal sealed class ScrollCapture : Form {
        readonly Rectangle region;
        readonly Func<string, string> label;
        readonly Action<Bitmap, bool> complete;
        readonly List<Bitmap> strips = new List<Bitmap>();
        readonly Timer timer = new Timer { Interval = 250 };
        readonly Label state;
        readonly PictureBox preview;
        readonly ScrollRecovery recovery;
        uint[] previous, candidate;
        int totalHeight;
        int checkpointHeight;
        bool incomplete, completed, finishing;
        public static Rectangle ControlsBounds(Rectangle region) {
            var size = new Size(340, 92);
            foreach (var display in Screen.AllScreens) {
                var area = display.WorkingArea;
                foreach (var point in new[] { new Point(region.Left, region.Bottom + 8), new Point(region.Left, region.Top - size.Height - 8), new Point(region.Right + 8, region.Top), new Point(region.Left - size.Width - 8, region.Top), area.Location }) {
                    var bounds = new Rectangle(point, size);
                    if (area.Contains(bounds) && !region.IntersectsWith(bounds)) return bounds;
                }
            }
            return Rectangle.Empty;
        }
        public ScrollCapture(Rectangle region, Rectangle bounds, Bitmap initial, ScrollRecovery recovery, Func<string, string> label, Action<Bitmap, bool> complete) {
            this.region = region; this.label = label; this.complete = complete;
            this.recovery = recovery;
            strips.Add(initial); totalHeight = initial.Height; previous = Rows(initial);
            Text = label("scroll"); AccessibleName = Text; TopMost = true; ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow; StartPosition = FormStartPosition.Manual; Bounds = bounds;
            state = new Label { Dock = DockStyle.Top, Height = 24, AutoEllipsis = true, Text = label("scrolling") };
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 32, WrapContents = false };
            Controls.Add(state);
            var stop = new Button { Text = label("stop"), AutoSize = true, AccessibleName = label("stop") };
            var cancel = new Button { Text = label("cancel"), AutoSize = true, AccessibleName = label("cancel") };
            var export = new Button { Text = label("export"), AutoSize = true, AccessibleName = label("export") };
            export.Click += (sender, args) => Export();
            stop.Click += (sender, args) => Finish(true);
            cancel.Click += (sender, args) => Finish(false);
            buttons.Controls.Add(stop); buttons.Controls.Add(export); buttons.Controls.Add(cancel); Controls.Add(buttons);
            preview = new PictureBox { Dock = DockStyle.Left, Width = 52, SizeMode = PictureBoxSizeMode.Zoom, AccessibleName = label("scroll") };
            Controls.Add(preview); UpdatePreview();
            timer.Tick += (sender, args) => Sample(); timer.Start();
        }
        static uint[] Rows(Bitmap image) {
            var data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try {
                var bytes = new byte[Math.Abs(data.Stride) * image.Height];
                Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
                var rows = new uint[image.Height];
                for (int y = 0; y < image.Height; y++) {
                    uint hash = 2166136261;
                    for (int sample = 0; sample < 32; sample++) {
                        int x = (sample + 1) * image.Width / 33;
                        int index = y * Math.Abs(data.Stride) + x * 4;
                        for (int c = 0; c < 3; c++) hash = unchecked((hash ^ bytes[index + c]) * 16777619);
                    }
                    rows[y] = hash;
                }
                return rows;
            } finally { image.UnlockBits(data); }
        }
        static bool Same(uint[] left, uint[] right) {
            if (left == null || right == null || left.Length != right.Length) return false;
            for (int i = 0; i < left.Length; i++) if (left[i] != right[i]) return false;
            return true;
        }
        static int ScrollDistance(uint[] before, uint[] after) {
            int height = before.Length;
            for (int offset = 1; offset < height - 32; offset++) {
                int overlap = height - offset, matches = 0;
                var detail = new HashSet<uint>();
                for (int sample = 1; sample <= 12; sample++) {
                    int y = sample * overlap / 13;
                    if (before[y + offset] == after[y]) { matches++; detail.Add(after[y]); }
                }
                if (matches >= 11 && detail.Count >= 3) return offset;
            }
            return -1;
        }
        void Sample() {
            if (recovery != null) {
                if ((checkpointHeight != totalHeight || recovery.Failed) && recovery.Save(strips)) checkpointHeight = totalHeight;
                if (recovery.Failed) state.Text = label("scrollNotSaved");
            }
            if (region.IntersectsWith(Bounds)) { state.Text = label("scrollControls"); return; }
            try {
                using (var image = new Bitmap(region.Width, region.Height, PixelFormat.Format32bppArgb)) {
                    using (var graphics = Graphics.FromImage(image)) graphics.CopyFromScreen(region.Location, Point.Empty, region.Size);
                    var rows = Rows(image);
                    if (Same(previous, rows)) { candidate = null; return; }
                    if (!Same(candidate, rows)) { candidate = rows; return; }
                    int distance = ScrollDistance(previous, rows);
                    if (distance < 0) { incomplete = true; state.Text = label("scrollMismatch"); return; }
                    if (totalHeight + distance > 16384 || (long)region.Width * (totalHeight + distance) > 20000000) {
                        incomplete = true; state.Text = label("scrollLimit"); timer.Stop(); return;
                    }
                    strips.Add(image.Clone(new Rectangle(0, image.Height - distance, image.Width, distance), PixelFormat.Format32bppArgb));
                    totalHeight += distance; previous = rows; candidate = null;
                    UpdatePreview();
                    state.Text = totalHeight.ToString("N0") + " px";
                }
            } catch { incomplete = true; state.Text = label("native"); timer.Stop(); }
        }
        Bitmap Compose() {
            var result = new Bitmap(region.Width, totalHeight, PixelFormat.Format32bppArgb);
            using (var graphics = Graphics.FromImage(result)) {
                int y = 0;
                foreach (var strip in strips) { graphics.DrawImageUnscaled(strip, 0, y); y += strip.Height; }
            }
            return result;
        }
        void UpdatePreview() {
            var thumbnail = new Bitmap(48, 52);
            double scale = Math.Min(48.0 / region.Width, 52.0 / totalHeight);
            using (var graphics = Graphics.FromImage(thumbnail)) {
                graphics.Clear(SystemColors.Control); int y = 0;
                foreach (var strip in strips) {
                    graphics.DrawImage(strip, new RectangleF((float)((48 - region.Width * scale) / 2), (float)(y * scale), (float)(region.Width * scale), (float)(strip.Height * scale)));
                    y += strip.Height;
                }
            }
            var old = preview.Image; preview.Image = thumbnail; if (old != null) old.Dispose();
        }
        async void Export() {
            timer.Stop();
            using (var dialog = new SaveFileDialog { Filter = "PNG|*.png", FileName = "Capture.png", AddExtension = true }) {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                Enabled = false;
                try { using (var image = Compose()) await System.Threading.Tasks.Task.Run(() => image.Save(dialog.FileName, ImageFormat.Png)); state.Text = label("captureHistoryFailed"); }
                catch { state.Text = label("storage"); }
                finally { if (!IsDisposed) Enabled = true; }
            }
        }
        async void Finish(bool keep) {
            if (completed || finishing) return;
            timer.Stop(); finishing = true; Enabled = false;
            Bitmap result = null;
            try {
                if (keep) {
                    if (recovery != null) await recovery.SaveFinal(strips);
                    if (IsDisposed || Disposing) return;
                    result = Compose();
                } else if (recovery != null) {
                    await recovery.Clear();
                    if (IsDisposed || Disposing) return;
                }
                Hide(); complete(result, incomplete); result = null; completed = true; Close();
            } catch { if (result != null) result.Dispose(); if (!IsDisposed) { state.Text = label(keep ? "tooLarge" : "storage"); Show(); Activate(); } }
            finally { finishing = false; if (!IsDisposed) Enabled = true; }
        }
        protected override void OnFormClosing(FormClosingEventArgs e) {
            // Closing the controls keeps already acquired pixels, including partial captures.
            if (!completed && !Disposing) { e.Cancel = true; Finish(true); return; }
            base.OnFormClosing(e);
        }
        protected override void Dispose(bool disposing) {
            if (disposing) { timer.Dispose(); if (preview != null && preview.Image != null) { preview.Image.Dispose(); preview.Image = null; } foreach (var strip in strips) strip.Dispose(); strips.Clear(); }
            base.Dispose(disposing);
        }
    }
}
