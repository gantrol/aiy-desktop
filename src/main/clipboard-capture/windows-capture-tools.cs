namespace AiyCapture {
    using System;
    using System.Drawing;
    using System.Drawing.Drawing2D;
    using System.Runtime.InteropServices;
    using System.Windows.Forms;

    public sealed partial class Overlay {
        [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left, Top, Right, Bottom; }
        delegate bool WindowCallback(IntPtr window, IntPtr value);
        [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr value);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
        [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window, ref Point point);
        [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr window, Point point, uint flags);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
        static Rectangle lastSelection;
        NumericUpDown pixelWidth, pixelHeight;
        CheckBox ratioLock;
        FlowLayoutPanel dimensionPanel;
        bool syncing, magnifier;
        double ratio = 1;
        Point samplePoint;
        string pickMode = "";
        string acquisitionMode = "";
        public void SelectMode(string mode) {
            if (mode == "scroll" || mode == "record") acquisitionMode = mode;
            else if (toolActions.ContainsKey(mode)) toolActions[mode]();
        }
        void BeginAcquisition() {
            if (!Selected || acquisitionMode.Length == 0) return;
            var mode = acquisitionMode; acquisitionMode = "";
            BeginInvoke((Action)(() => toolActions[mode]()));
        }

        bool PersistentTool(string key) { return key == "cancel" || key == "more"; }
        bool PrimaryTool(string key) { return key == "annotate" || key == "pin" || key == "export" || key == "more" || key == "cancel" || key == "copy"; }
        void ShowMore() {
            more.Items.Clear();
            foreach (var key in new[] { "screen", "window", "control", "previous", "clear", "magnifier", "color", "size", "edit", "scroll", "record" }) {
                var name = key;
                var item = more.Items.Add(Label(name));
                item.Enabled = !busy && ((name != "clear" && name != "size" && name != "edit" && name != "scroll" && name != "record") || Selected) && (edited == null || name == "edit" || name == "clear" || name == "magnifier" || name == "color");
                item.Click += (sender, args) => toolActions[name]();
            }
            var anchor = actions.Find(button => (string)button.Tag == "more");
            more.Show(anchor, new Point(0, anchor.Height));
        }
        void BuildSelectionTools() {
            toolActions["scroll"] = StartScroll;
            toolActions["record"] = StartRecording;
            AddButton("screen", () => { pickMode = ""; selection = ClientRectangle; revision++; UpdateSelection(); });
            AddButton("window", () => { pickMode = "window"; ActiveControl = null; });
            AddButton("control", () => { pickMode = "control"; ActiveControl = null; });
            AddButton("previous", () => {
                if (lastSelection.IsEmpty) return;
                selection = Rectangle.Intersect(ClientRectangle, new Rectangle(lastSelection.X - Left, lastSelection.Y - Top, lastSelection.Width, lastSelection.Height));
                revision++; UpdateSelection();
            });
            AddButton("magnifier", () => { magnifier = !magnifier; ActiveControl = null; Invalidate(); });
            AddButton("color", () => {
                try { Clipboard.SetText(ColorText()); status.Text = Label("color") + " " + ColorText(); }
                catch { status.Text = Label("native"); }
            });
            dimensionPanel = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Visible = false, Margin = Padding.Empty };
            AddButton("size", () => { dimensionPanel.Visible = !dimensionPanel.Visible; PlaceTools(); });
            toolbar.Controls.Add(dimensionPanel);
            pixelWidth = DimensionControl("width", ClientSize.Width);
            pixelHeight = DimensionControl("height", ClientSize.Height);
            ratioLock = new CheckBox { Text = "", Image = ToolIcon("ratio"), AccessibleName = Label("ratio"), Appearance = Appearance.Button,
                Size = new Size(inset * 4, inset * 4), Margin = new Padding(1), FlatStyle = FlatStyle.Flat };
            Hint(ratioLock, "ratio");
            ratioLock.CheckedChanged += (sender, args) => { if (Selected) ratio = (double)selection.Width / selection.Height; };
            dimensionPanel.Controls.Add(ratioLock);
            pixelWidth.ValueChanged += (sender, args) => ChangeDimension(true);
            pixelHeight.ValueChanged += (sender, args) => ChangeDimension(false);
        }
        NumericUpDown DimensionControl(string key, int maximum) {
            dimensionPanel.Controls.Add(new Label { Text = Label(key), AutoSize = true, Margin = new Padding(inset) });
            var control = new NumericUpDown { Minimum = 2, Maximum = Math.Max(2, maximum), Value = 2, Width = inset * 10,
                AccessibleName = Label(key), ThousandsSeparator = true, Margin = new Padding(inset / 2) };
            dimensionPanel.Controls.Add(control);
            return control;
        }
        void ChangeDimension(bool width) {
            if (syncing || busy || !Selected) return;
            int w = (int)pixelWidth.Value, h = (int)pixelHeight.Value;
            if (ratioLock.Checked) { if (width) h = Math.Max(2, (int)Math.Round(w / ratio)); else w = Math.Max(2, (int)Math.Round(h * ratio)); }
            selection.Size = new Size(Math.Min(ClientSize.Width - selection.X, w), Math.Min(ClientSize.Height - selection.Y, h));
            revision++; UpdateSelection();
        }
        void ApplyRatio() {
            double value = ratioLock.Checked ? ratio : 1;
            int w = selection.Width, h = Math.Max(2, (int)Math.Round(w / value));
            if (h > ClientSize.Height - selection.Y) { h = ClientSize.Height - selection.Y; w = Math.Max(2, (int)Math.Round(h * value)); }
            selection.Size = new Size(Math.Min(ClientSize.Width - selection.X, w), h);
        }
        void SyncDimensions() {
            syncing = true;
            pixelWidth.Enabled = pixelHeight.Enabled = ratioLock.Enabled = Selected && !busy;
            pixelWidth.Value = Math.Max(2, Math.Min(pixelWidth.Maximum, selection.Width));
            pixelHeight.Value = Math.Max(2, Math.Min(pixelHeight.Maximum, selection.Height));
            syncing = false;
        }
        string ColorText() { var color = frame.GetPixel(samplePoint.X, samplePoint.Y); return String.Format("#{0:X2}{1:X2}{2:X2}", color.R, color.G, color.B); }
        void PaintMagnifier(Graphics graphics) {
            if (!magnifier || busy) return;
            int size = inset * 14;
            int x = Math.Max(0, Math.Min(ClientSize.Width - size - 2, samplePoint.X + inset * 3));
            int y = Math.Max(0, Math.Min(ClientSize.Height - size - inset * 5, samplePoint.Y + inset * 3));
            var source = new Rectangle(Math.Max(0, Math.Min(frame.Width - 15, samplePoint.X - 7)), Math.Max(0, Math.Min(frame.Height - 15, samplePoint.Y - 7)), 15, 15);
            var state = graphics.Save();
            graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            graphics.PixelOffsetMode = PixelOffsetMode.Half;
            graphics.DrawImage(frame, new Rectangle(x, y, size, size), source, GraphicsUnit.Pixel);
            graphics.DrawRectangle(Pens.Black, x, y, size, size);
            int cx = x + (samplePoint.X - source.X) * size / 15, cy = y + (samplePoint.Y - source.Y) * size / 15;
            graphics.DrawRectangle(Pens.Red, cx, cy, Math.Max(1, size / 15), Math.Max(1, size / 15));
            string text = ColorText() + "  " + (samplePoint.X + Left) + ", " + (samplePoint.Y + Top);
            graphics.FillRectangle(SystemBrushes.Control, x, y + size, size, inset * 4);
            graphics.DrawString(text, Font, SystemBrushes.ControlText, new RectangleF(x + 2, y + size + 2, size - 4, inset * 4));
            graphics.Restore(state);
        }
        void PickWindow(Point point) {
            var screenPoint = new Point(point.X + Left, point.Y + Top);
            IntPtr found = IntPtr.Zero;
            EnumWindows((window, value) => {
                if (window == Handle || !IsWindowVisible(window)) return true;
                int cloaked;
                if (DwmGetWindowAttribute(window, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
                NativeRect rect;
                if (!GetWindowRect(window, out rect) || !Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom).Contains(screenPoint)) return true;
                found = window; return false;
            }, IntPtr.Zero);
            if (found == IntPtr.Zero) return;
            if (pickMode == "control") {
                for (int depth = 0; depth < 16; depth++) {
                    var local = screenPoint;
                    if (!ScreenToClient(found, ref local)) break;
                    var child = ChildWindowFromPointEx(found, local, 7);
                    if (child == IntPtr.Zero || child == found) break;
                    found = child;
                }
            }
            NativeRect bounds;
            if (GetWindowRect(found, out bounds)) selection = Rectangle.Intersect(ClientRectangle,
                Rectangle.FromLTRB(bounds.Left - Left, bounds.Top - Top, bounds.Right - Left, bounds.Bottom - Top));
        }
    }
}
