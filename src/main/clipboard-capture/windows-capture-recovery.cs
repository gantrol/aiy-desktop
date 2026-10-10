namespace AiyCapture {
    using System;
    using System.Collections.Generic;
    using System.Drawing;
    using System.IO;
    using System.Threading.Tasks;

    // One bounded checkpoint in flight. Encoding and disk access run outside the UI thread.
    internal sealed class ScrollRecovery {
        readonly string file;
        readonly Func<Image, byte[]> encode;
        Task pending = Task.FromResult(true);
        volatile bool failed;
        DateTime nextAttempt;
        public bool Failed { get { return failed; } }
        public ScrollRecovery(string file, Func<Image, byte[]> encode) { this.file = file; this.encode = encode; }
        public bool Save(List<Bitmap> strips) {
            if (!pending.IsCompleted || DateTime.UtcNow < nextAttempt) return false;
            nextAttempt = DateTime.UtcNow.AddSeconds(1);
            var copies = new List<Bitmap>();
            try { foreach (var strip in strips) copies.Add(new Bitmap(strip)); }
            catch { foreach (var image in copies) image.Dispose(); failed = true; return false; }
            pending = Task.Run(async () => {
                try {
                    int height = 0; foreach (var image in copies) height += image.Height;
                    byte[] bytes;
                    using (var result = new Bitmap(copies[0].Width, height)) {
                        using (var graphics = Graphics.FromImage(result)) {
                            int y = 0;
                            foreach (var image in copies) { graphics.DrawImageUnscaled(image, 0, y); y += image.Height; }
                        }
                        bytes = encode(result);
                    }
                    var temporary = file + ".pending";
                    using (var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 65536, true)) {
                        await output.WriteAsync(bytes, 0, bytes.Length); await output.FlushAsync();
                    }
                    if (File.Exists(file)) File.Replace(temporary, file, null);
                    else File.Move(temporary, file);
                    failed = false;
                } catch { failed = true; }
                finally { foreach (var image in copies) image.Dispose(); }
            });
            return true;
        }
        public async Task Clear() {
            await pending;
            await Task.Run(() => { File.Delete(file); File.Delete(file + ".pending"); });
        }
        public async Task SaveFinal(List<Bitmap> strips) {
            await pending;
            nextAttempt = DateTime.MinValue;
            Save(strips);
            await pending;
        }
    }

    public sealed partial class Overlay {
        ScrollRecovery recovery;
        bool ownsRecovery;
        public bool ConfigureRecovery(string file, byte[] bytes, bool failed) {
            recovery = new ScrollRecovery(file, encode);
            if (failed) { status.Text = Label("scrollRecoveryFailed"); PlaceTools(); }
            if (bytes == null) return false;
            try {
                Adopt(bytes);
                double scale = Math.Min(0.7 * ClientSize.Width / edited.Width, 0.7 * ClientSize.Height / edited.Height);
                var size = new Size(Math.Max(2, (int)(edited.Width * scale)), Math.Max(2, (int)(edited.Height * scale)));
                selection = new Rectangle((ClientSize.Width - size.Width) / 2, (ClientSize.Height - size.Height) / 2, size.Width, size.Height);
                partial = true; ownsRecovery = true;
                UpdateSelection(); crop = bytes;
                Result(false, Label("scrollRecovered"));
                return true;
            } catch { status.Text = Label("scrollRecoveryFailed"); PlaceTools(); return false; }
        }
    }
}
