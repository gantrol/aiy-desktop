namespace AiyCapture {
    using System;
    using System.Collections.Generic;
    using System.Drawing;
    using System.Drawing.Imaging;
    using System.Globalization;
    using System.Runtime.InteropServices;
    using System.Windows.Forms;

    // Physical pixels throughout. Only the selected crop crosses the helper boundary.
    public sealed partial class Overlay : Form {
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
        readonly Bitmap frame;
        readonly IntPtr previous;
        readonly Dictionary<string, object> labels;
        readonly Func<Image, byte[]> encode;
        readonly Action<string, byte[], int, Rectangle> perform;
        readonly Action completed;
        readonly FlowLayoutPanel toolbar;
        readonly Label status;
        readonly List<Button> actions = new List<Button>();
        readonly Dictionary<string, Action> toolActions = new Dictionary<string, Action>();
        readonly ContextMenuStrip more = new ContextMenuStrip();
        readonly Button copy;
        readonly int inset, handleSize;
        Point origin;
        Rectangle selection, original;
        string drag = "";
        bool busy, finishing, restoreFocus = true;
        int revision;
        byte[] crop;
        Bitmap edited;

        string Label(string key) { return (string)labels[key]; }
        bool Selected { get { return selection.Width >= 2 && selection.Height >= 2; } }
        public Overlay(Dictionary<string, object> messages, bool keyboard, Func<Image, byte[]> encoder,
            Action<string, byte[], int, Rectangle> action, Action closed) {
            labels = messages; encode = encoder; perform = action; completed = closed;
            previous = GetForegroundWindow();
            var bounds = Screen.FromPoint(Cursor.Position).Bounds;
            if ((long)bounds.Width * bounds.Height > 20000000) throw new InvalidOperationException("tooLarge");
            frame = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
            try { using (var graphics = Graphics.FromImage(frame)) graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size); }
            catch { frame.Dispose(); throw; }
            Text = Label("title"); AccessibleName = Text;
            AutoScaleMode = AutoScaleMode.None; FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual; Bounds = bounds;
            TopMost = true; ShowInTaskbar = false; KeyPreview = true; DoubleBuffered = true;
            Font = SystemFonts.MessageBoxFont;
            using (var graphics = CreateGraphics()) inset = Math.Max(8, (int)Math.Ceiling(8 * graphics.DpiX / 96));
            handleSize = inset;
            Cursor = Cursors.Cross;
            toolbar = new FlowLayoutPanel {
                AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                WrapContents = true, BackColor = SystemColors.Control,
                Padding = new Padding(inset / 2), MaximumSize = new Size(ClientSize.Width - inset * 2, 0),
                AccessibleName = Text, TabStop = false
            };
            copy = AddButton("copy", () => Submit("copy"));
            copy.Text = Label("copy"); copy.TextImageRelation = TextImageRelation.ImageBeforeText; copy.Width = inset * 10;
            AddButton("pin", () => Submit("pin"));
            AddButton("annotate", () => Submit("annotate"));
            AddButton("edit", () => Submit("edit"));
            AddButton("export", () => Submit("export"));
            AddButton("clear", ClearSelection);
            AddButton("more", () => ShowMore());
            AddButton("cancel", Close);
            status = new Label {
                AutoSize = true, BackColor = SystemColors.Control, ForeColor = SystemColors.ControlText,
                Padding = new Padding(inset / 2), MaximumSize = new Size(ClientSize.Width - inset * 2, 0),
                AccessibleRole = AccessibleRole.StaticText
            };
            Controls.Add(toolbar); Controls.Add(status);
            BuildSelectionTools();
            ReorderTools();
            if (keyboard) selection = new Rectangle(ClientSize.Width / 4, ClientSize.Height / 4, ClientSize.Width / 2, ClientSize.Height / 2);
            UpdateSelection();
        }
        Button AddButton(string key, Action click) {
            var button = new Button {
                Text = "", AccessibleName = Label(key), Tag = key, Image = ToolIcon(key),
                AutoSize = false, Size = new Size(inset * 4, inset * 4),
                FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = true,
                Margin = new Padding(1), Padding = Padding.Empty
            };
            button.FlatAppearance.BorderSize = 0;
            Hint(button, key);
            toolActions[key] = click;
            button.Click += (sender, args) => click();
            toolbar.Controls.Add(button); actions.Add(button);
            return button;
        }
        void PlaceTools() {
            toolbar.PerformLayout();
            int x = Selected ? selection.Right - toolbar.Width : inset;
            int below = Selected ? selection.Bottom + inset : inset + status.Height + inset;
            int y = below + toolbar.Height + inset <= ClientSize.Height
                ? below : selection.Top - toolbar.Height - inset;
            x = Math.Max(inset, Math.Min(x, ClientSize.Width - toolbar.Width - inset));
            y = Math.Max(inset, Math.Min(y, ClientSize.Height - toolbar.Height - inset));
            toolbar.Location = new Point(x, y);
            status.Location = Selected ? new Point(Math.Max(inset, Math.Min(selection.Left, ClientSize.Width - status.Width - inset)), Math.Max(inset, selection.Top - status.Height - inset / 2)) : new Point(inset, inset);
        }
        void UpdateSelection() {
            crop = null;
            status.Text = Selected
                ? Label("dimensions").Replace("{width}", (edited == null ? selection.Width : edited.Width).ToString("N0", CultureInfo.CurrentCulture))
                    .Replace("{height}", (edited == null ? selection.Height : edited.Height).ToString("N0", CultureInfo.CurrentCulture))
                : Label("singleScreen");
            foreach (var button in actions) button.Visible = Selected ? PrimaryTool((string)button.Tag) : PersistentTool((string)button.Tag);
            SyncDimensions();
            toolbar.Visible = drag.Length == 0;
            status.Visible = drag.Length == 0;
            PlaceTools(); Invalidate();
        }
        Point Clamp(Point point) {
            return new Point(Math.Max(0, Math.Min(ClientSize.Width, point.X)), Math.Max(0, Math.Min(ClientSize.Height, point.Y)));
        }
        Rectangle Corner(int x, int y) { return new Rectangle(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize); }
        string Hit(Point point) {
            if (!Selected) return "new";
            if (Corner(selection.Left, selection.Top).Contains(point)) return "nw";
            if (Corner(selection.Right, selection.Top).Contains(point)) return "ne";
            if (Corner(selection.Left, selection.Bottom).Contains(point)) return "sw";
            if (Corner(selection.Right, selection.Bottom).Contains(point)) return "se";
            if (Math.Abs(point.X - selection.Left) <= handleSize / 2 && point.Y >= selection.Top && point.Y <= selection.Bottom) return "w";
            if (Math.Abs(point.X - selection.Right) <= handleSize / 2 && point.Y >= selection.Top && point.Y <= selection.Bottom) return "e";
            if (Math.Abs(point.Y - selection.Top) <= handleSize / 2 && point.X >= selection.Left && point.X <= selection.Right) return "n";
            if (Math.Abs(point.Y - selection.Bottom) <= handleSize / 2 && point.X >= selection.Left && point.X <= selection.Right) return "s";
            return selection.Contains(point) ? "move" : "new";
        }
        protected override void OnPaint(PaintEventArgs e) {
            e.Graphics.DrawImageUnscaled(frame, 0, 0);
            using (var shade = new SolidBrush(Color.FromArgb(110, Color.Black))) e.Graphics.FillRectangle(shade, ClientRectangle);
            if (!Selected) { PaintMagnifier(e.Graphics); return; }
            e.Graphics.DrawImage(frame, selection, selection, GraphicsUnit.Pixel);
            if (edited != null) {
                using (var background = new SolidBrush(SystemColors.Control)) e.Graphics.FillRectangle(background, selection);
                double scale = Math.Min((double)selection.Width / edited.Width, (double)selection.Height / edited.Height);
                int width = (int)(edited.Width * scale), height = (int)(edited.Height * scale);
                e.Graphics.DrawImage(edited, new Rectangle(selection.X + (selection.Width - width) / 2, selection.Y + (selection.Height - height) / 2, width, height));
            }
            e.Graphics.DrawRectangle(Pens.Black, selection.X, selection.Y, selection.Width - 1, selection.Height - 1);
            if (selection.Width > 2 && selection.Height > 2)
                e.Graphics.DrawRectangle(Pens.White, selection.X + 1, selection.Y + 1, selection.Width - 3, selection.Height - 3);
            foreach (int x in new[] { selection.Left, selection.Right })
                foreach (int y in new[] { selection.Top, selection.Bottom }) {
                    var corner = Corner(x, y); e.Graphics.FillRectangle(Brushes.White, corner); e.Graphics.DrawRectangle(Pens.Black, corner);
                }
            PaintMagnifier(e.Graphics);
        }
        protected override void OnMouseDown(MouseEventArgs e) {
            if (busy) return;
            if (e.Button == MouseButtons.Right) { Escape(); return; }
            if (e.Button != MouseButtons.Left || edited != null) return;
            if (pickMode.Length > 0) { PickWindow(e.Location); pickMode = ""; revision++; UpdateSelection(); return; }
            ActiveControl = null;
            origin = Clamp(e.Location); original = selection; drag = Hit(origin);
            Capture = true; toolbar.Visible = false; status.Visible = false;
        }
        protected override void OnMouseMove(MouseEventArgs e) {
            if (busy) return;
            samplePoint = new Point(Math.Max(0, Math.Min(frame.Width - 1, e.X)), Math.Max(0, Math.Min(frame.Height - 1, e.Y)));
            if (pickMode.Length > 0) { PickWindow(e.Location); UpdateSelection(); return; }
            if (drag.Length == 0) {
                string hit = Hit(e.Location);
                Cursor = hit == "move" ? Cursors.SizeAll : hit == "nw" || hit == "se" ? Cursors.SizeNWSE
                    : hit == "ne" || hit == "sw" ? Cursors.SizeNESW : hit == "w" || hit == "e" ? Cursors.SizeWE
                    : hit == "n" || hit == "s" ? Cursors.SizeNS : Cursors.Cross;
                if (magnifier) Invalidate();
                return;
            }
            var point = Clamp(e.Location);
            if (drag == "move") {
                selection.Location = new Point(Math.Max(0, Math.Min(ClientSize.Width - original.Width, original.X + point.X - origin.X)),
                    Math.Max(0, Math.Min(ClientSize.Height - original.Height, original.Y + point.Y - origin.Y)));
            } else {
                var anchor = drag == "new" ? origin : new Point(drag.EndsWith("w") ? original.Right : original.Left,
                    drag.StartsWith("n") ? original.Bottom : original.Top);
                selection = Rectangle.FromLTRB(Math.Min(anchor.X, point.X), Math.Min(anchor.Y, point.Y),
                    Math.Max(anchor.X, point.X), Math.Max(anchor.Y, point.Y));
                if (drag == "w" || drag == "e") { selection.Y = original.Y; selection.Height = original.Height; }
                if (drag == "n" || drag == "s") { selection.X = original.X; selection.Width = original.Width; }
                if (ratioLock.Checked || (ModifierKeys & Keys.Shift) != 0) ApplyRatio();
            }
            crop = null; Invalidate();
        }
        protected override void OnMouseUp(MouseEventArgs e) {
            if (drag.Length == 0 || e.Button != MouseButtons.Left) return;
            OnMouseMove(e); drag = ""; Capture = false; revision++; UpdateSelection();
            BeginAcquisition();
        }
        protected override void OnMouseCaptureChanged(EventArgs e) {
            base.OnMouseCaptureChanged(e);
            if (!Capture && drag.Length > 0) { selection = original; drag = ""; UpdateSelection(); }
        }
        void ClearSelection() {
            if (busy) return;
            if (edited != null) { edited.Dispose(); edited = null; }
            partial = false;
            ownsRecovery = false;
            selection = Rectangle.Empty; drag = ""; Capture = false; revision++;
            ActiveControl = null; UpdateSelection();
        }
        void Escape() {
            if (busy) return;
            if (more.Visible) { more.Close(); return; }
            if (drag.Length > 0) { selection = original; drag = ""; Capture = false; UpdateSelection(); }
            else if (Selected) ClearSelection();
            else Close();
        }
        protected override void OnShown(EventArgs e) { base.OnShown(e); ActiveControl = null; Focus(); }
        protected override bool ProcessCmdKey(ref Message message, Keys keys) {
            var key = keys & Keys.KeyCode;
            if (key == Keys.Escape) { Escape(); return true; }
            if (busy) return true;
            if (ActiveControl is NumericUpDown || ActiveControl is CheckBox) return base.ProcessCmdKey(ref message, keys);
            if (keys == (Keys.Control | Keys.C)) { Submit("copy"); return true; }
            if (keys == (Keys.Control | Keys.T)) { Submit("pin"); return true; }
            if (keys == (Keys.Control | Keys.S)) { Submit("export"); return true; }
            if (keys == Keys.Space) { Submit("annotate"); return true; }
            if (keys == Keys.R) { ClearSelection(); return true; }
            if (keys == Keys.M) { magnifier = !magnifier; Invalidate(); return true; }
            if (keys == Keys.C) { try { Clipboard.SetText(ColorText()); status.Text = Label("color") + " " + ColorText(); } catch { status.Text = Label("native"); } return true; }
            if (key == Keys.Enter && !(ActiveControl is Button)) { Submit("copy"); return true; }
            bool arrow = key == Keys.Left || key == Keys.Right || key == Keys.Up || key == Keys.Down;
            if (edited != null && arrow) return true;
            if (!arrow || ActiveControl is Button) return base.ProcessCmdKey(ref message, keys);
            if (!Selected) selection = new Rectangle(ClientSize.Width / 4, ClientSize.Height / 4, ClientSize.Width / 2, ClientSize.Height / 2);
            int dx = key == Keys.Left ? -1 : key == Keys.Right ? 1 : 0, dy = key == Keys.Up ? -1 : key == Keys.Down ? 1 : 0;
            if ((keys & Keys.Shift) != 0)
                selection.Size = new Size(Math.Max(2, Math.Min(ClientSize.Width - selection.X, selection.Width + dx)),
                    Math.Max(2, Math.Min(ClientSize.Height - selection.Y, selection.Height + dy)));
            else selection.Location = new Point(Math.Max(0, Math.Min(ClientSize.Width - selection.Width, selection.X + dx)),
                Math.Max(0, Math.Min(ClientSize.Height - selection.Height, selection.Y + dy)));
            revision++; UpdateSelection(); return true;
        }
        void Submit(string action) {
            if (busy || !Selected) return;
            if (acquisitionMode.Length > 0) { BeginAcquisition(); return; }
            try {
                lastSelection = new Rectangle(selection.X + Left, selection.Y + Top, selection.Width, selection.Height);
                if (action != "record" && crop == null) using (var image = frame.Clone(selection, PixelFormat.Format32bppArgb)) crop = encode(image);
                busy = true;
                SyncDimensions();
                foreach (var button in actions) button.Enabled = false;
                status.Text = Label("working"); PlaceTools();
                // Let the host's save dialog or existing image editor receive focus.
                if (action != "copy") Hide();
                perform(action, action == "record" ? new byte[] { 0 } : crop, revision, lastSelection);
            } catch (Exception exception) { Result(false, Label(exception.Message == "tooLarge" ? "tooLarge" : "native")); }
        }
        public void Adopt(byte[] bytes) {
            using (var stream = new System.IO.MemoryStream(bytes)) using (var image = Image.FromStream(stream)) {
                if (edited != null) edited.Dispose();
                edited = new Bitmap(image);
            }
            crop = bytes; revision++; Invalidate();
        }
        public async void Result(bool close, string error) {
            if (close && ownsRecovery && recovery != null) {
                try { await recovery.Clear(); }
                catch { close = false; error = Label("scrollNotSaved"); }
                if (IsDisposed || Disposing) return;
            }
            if (close) { finishing = true; restoreFocus = Visible; Close(); return; }
            if (acquisition != null) { acquisition.Dispose(); acquisition = null; }
            busy = false;
            SyncDimensions();
            foreach (var button in actions) button.Enabled = true;
            status.Text = error.Length > 0 ? error : Label("dimensions")
                .Replace("{width}", (edited == null ? selection.Width : edited.Width).ToString("N0", CultureInfo.CurrentCulture))
                .Replace("{height}", (edited == null ? selection.Height : edited.Height).ToString("N0", CultureInfo.CurrentCulture));
            if (partial && error.Length == 0) status.Text += " · " + Label("scrollPartial");
            Show(); Activate(); PlaceTools(); copy.Focus();
        }
        public void Stop() { finishing = true; restoreFocus = false; Close(); }
        protected override void OnFormClosing(FormClosingEventArgs e) {
            if (busy && !finishing) e.Cancel = true;
            base.OnFormClosing(e);
        }
        protected override void OnFormClosed(FormClosedEventArgs e) {
            bool ownedFocus = GetForegroundWindow() == Handle;
            if (acquisition != null) acquisition.Dispose();
            frame.Dispose(); if (edited != null) edited.Dispose(); crop = null;
            hints.Dispose(); more.Dispose();
            foreach (var button in actions) if (button.Image != null) button.Image.Dispose();
            if (ratioLock.Image != null) ratioLock.Image.Dispose();
            if (restoreFocus && ownedFocus && IsWindow(previous)) SetForegroundWindow(previous);
            completed(); base.OnFormClosed(e);
        }
    }
}
