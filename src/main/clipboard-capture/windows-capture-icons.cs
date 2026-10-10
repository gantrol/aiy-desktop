namespace AiyCapture {
    using System;
    using System.Drawing;
    using System.Drawing.Drawing2D;
    using System.Windows.Forms;
    public sealed partial class Overlay {
        readonly ToolTip hints = new ToolTip { InitialDelay = 300, ReshowDelay = 100, AutoPopDelay = 5000, ShowAlways = true };
        string Shortcut(string key) {
            switch (key) {
                case "copy": return "Ctrl+C / Enter";
                case "pin": return "Ctrl+T";
                case "annotate": return "Space";
                case "export": return "Ctrl+S";
                case "cancel": return "Esc";
                case "clear": return "R";
                case "magnifier": return "M";
                case "color": return "C";
                default: return "";
            }
        }
        void Hint(Control control, string key) {
            string shortcut = Shortcut(key);
            string text = Label(key) + (shortcut.Length == 0 ? "" : "  " + shortcut);
            hints.SetToolTip(control, text);
            control.Enter += (sender, args) => hints.Show(text, control, control.Width / 2, control.Height + 4, 3000);
            control.Leave += (sender, args) => hints.Hide(control);
        }
        static void Stroke(Graphics g, Pen pen, params float[] xy) {
            var points = new PointF[xy.Length / 2];
            for (int i = 0; i < points.Length; i++) points[i] = new PointF(xy[i * 2], xy[i * 2 + 1]);
            g.DrawLines(pen, points);
        }
        Bitmap ToolIcon(string key) {
            int size = Math.Max(18, inset * 5 / 2);
            var image = new Bitmap(size, size);
            using (var g = Graphics.FromImage(image)) using (var pen = new Pen(SystemColors.ControlText, 1.7f)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.ScaleTransform(size / 24f, size / 24f);
                pen.StartCap = pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
                switch (key) {
                    case "copy": Stroke(g, pen, 4,12,10,18,21,6); break;
                    case "cancel": Stroke(g, pen, 6,6,18,18); Stroke(g, pen, 18,6,6,18); break;
                    case "pin": g.DrawRectangle(pen, 3,4,18,13); Stroke(g, pen, 8,21,16,21); Stroke(g, pen, 12,17,12,21); g.DrawRectangle(pen, 13,9,7,7); break;
                    case "more": for (int x = 5; x <= 19; x += 7) g.DrawEllipse(pen, x - 1,11,2,2); break;
                    case "annotate":
                    case "edit": Stroke(g, pen, 4,16,16,4,20,8,8,20,3,21,4,16,8,20); Stroke(g, pen, 14,6,18,10); break;
                    case "export": Stroke(g, pen, 4,4,17,4,20,7,20,20,4,20,4,4); Stroke(g, pen, 8,4,8,10,16,10,16,4); g.DrawRectangle(pen, 8,15,8,5); break;
                    case "screen": g.DrawRectangle(pen, 3,4,18,13); Stroke(g, pen, 12,17,12,21); Stroke(g, pen, 8,21,16,21); break;
                    case "window": g.DrawRectangle(pen, 3,4,18,16); Stroke(g, pen, 3,8,21,8); break;
                    case "control": g.DrawRectangle(pen, 3,4,18,16); g.DrawRectangle(pen, 8,11,8,5); break;
                    case "magnifier": g.DrawEllipse(pen, 4,3,12,12); Stroke(g, pen, 14,14,21,21); break;
                    case "color": Stroke(g, pen, 4,16,15,5,19,9,8,20,3,21,4,16); Stroke(g, pen, 12,5,19,12); break;
                    case "ratio": g.DrawEllipse(pen, 4,9,10,7); g.DrawEllipse(pen, 10,7,10,7); break;
                    case "size": g.DrawRectangle(pen, 4,7,16,10); Stroke(g, pen, 8,7,8,11); Stroke(g, pen, 12,7,12,13); Stroke(g, pen, 16,7,16,11); break;
                    case "previous": g.DrawArc(pen, 5,5,15,15,200,300); Stroke(g, pen, 3,4,3,10,9,10); Stroke(g, pen, 12,8,12,13,16,13); break;
                    case "clear": Stroke(g, pen, 8,3,3,3,3,8); Stroke(g, pen, 16,3,21,3,21,8); Stroke(g, pen, 3,16,3,21,8,21); Stroke(g, pen, 16,21,21,21,21,16); break;
                    default: g.DrawRectangle(pen, 4,4,16,16); break;
                }
            }
            return image;
        }
        void ReorderTools() {
            var order = new[] { "annotate", "pin", "export", "more", "cancel", "copy" };
            for (int i = 0; i < order.Length; i++) {
                var button = actions.Find(item => (string)item.Tag == order[i]);
                if (button != null) toolbar.Controls.SetChildIndex(button, i);
            }
        }
    }
}
