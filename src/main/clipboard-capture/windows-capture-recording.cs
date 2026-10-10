namespace AiyCapture {
    using System;
    using System.Drawing;
    using System.Windows.Forms;

    public sealed partial class Overlay {
        Action<string> recordingControl;
        bool recordCursor = true;
        public bool RecordCursor { get { return recordCursor; } }
        public void SetRecordingControl(Action<string> control) { recordingControl = control; }
        void StartRecording() {
            if (!Selected || busy || edited != null) return;
            var region = new Rectangle(Left + selection.Left, Top + selection.Top, selection.Width, selection.Height);
            var bounds = ScrollCapture.ControlsBounds(region);
            if (bounds.IsEmpty) { status.Text = Label("scrollControls"); PlaceTools(); return; }
            var panel = new RecordingControls(bounds, region, Label, (action, cursor) => {
                recordCursor = cursor;
                if (action == "start") Submit("record");
                else if (!busy) { acquisition.Dispose(); acquisition = null; Show(); Activate(); }
                else if (recordingControl != null) recordingControl(action);
            });
            acquisition = panel; Hide(); panel.Show();
        }
        public void RecordingState(string phase, string message) {
            var panel = acquisition as RecordingControls;
            if (panel != null) panel.SetState(phase, Label(message));
        }
    }

    internal sealed class RecordingControls : Form {
        readonly Func<string, string> label;
        readonly Action<string, bool> control;
        readonly Label state;
        readonly CheckBox cursor;
        readonly Button primary, preview, cancel;
        readonly Timer clock = new Timer { Interval = 1000 };
        readonly Rectangle region;
        Rectangle safeBounds;
        DateTime started;
        string phase = "setup";
        public RecordingControls(Rectangle bounds, Rectangle region, Func<string, string> label, Action<string, bool> control) {
            this.label = label; this.control = control;
            this.region = region; safeBounds = bounds;
            Text = label("record"); AccessibleName = Text; TopMost = true; ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow; StartPosition = FormStartPosition.Manual; Bounds = bounds;
            state = new Label { Dock = DockStyle.Top, Height = 24, AutoEllipsis = true, Text = region.Width + " × " + region.Height + " · MP4" };
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 32, WrapContents = false };
            cursor = new CheckBox { Text = label("recordCursor"), Checked = true, AutoSize = true };
            primary = new Button { Text = label("recordStart"), AutoSize = true };
            preview = new Button { Text = label("recordPreviewAction"), AutoSize = true, Visible = false };
            cancel = new Button { Text = label("cancel"), AutoSize = true };
            primary.Click += (sender, args) => { var action = phase == "setup" ? "start" : phase == "recording" ? "stop" : "save"; if (action == "start") { primary.Enabled = false; cursor.Enabled = false; } control(action, cursor.Checked); };
            preview.Click += (sender, args) => control("preview", cursor.Checked);
            cancel.Click += (sender, args) => control("cancel", cursor.Checked);
            buttons.Controls.Add(cursor); buttons.Controls.Add(primary); buttons.Controls.Add(preview); buttons.Controls.Add(cancel);
            Controls.Add(state); Controls.Add(buttons);
            clock.Tick += (sender, args) => state.Text = label("recording") + " · " + (DateTime.UtcNow - started).ToString(@"mm\:ss");
        }
        protected override void OnLocationChanged(EventArgs e) {
            base.OnLocationChanged(e);
            if (safeBounds.IsEmpty) return;
            if (region.IntersectsWith(Bounds)) Bounds = safeBounds;
            else safeBounds = Bounds;
        }
        public void SetState(string value, string message) {
            phase = value; state.Text = message; cursor.Visible = false; primary.Enabled = true;
            primary.Text = label(value == "recording" ? "stop" : "export");
            preview.Visible = value == "ready";
            cancel.Text = label("recordDiscard");
            if (value == "recording" && !clock.Enabled) { started = DateTime.UtcNow; clock.Start(); }
            if (value != "recording") clock.Stop();
        }
        protected override void OnFormClosing(FormClosingEventArgs e) {
            if (!Disposing) { e.Cancel = true; if (phase == "recording") control("stop", cursor.Checked); else if (phase == "setup") control("cancel", cursor.Checked); }
            base.OnFormClosing(e);
        }
        protected override void Dispose(bool disposing) { if (disposing) clock.Dispose(); base.Dispose(disposing); }
    }
}
