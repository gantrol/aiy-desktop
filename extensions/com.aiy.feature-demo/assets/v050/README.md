# Runtime image assets

`paper-reference.svg` is an original typographic bibliography card for the cited 2005 paper, not a reproduced page or figure from the publication.

The WebP images are lossless runtime copies of the PNG source images. Keep their original dimensions and alpha values: the smile frames must remain 1024 × 1536 for the GIF presentation and close-ups. Playback and video export use the same imports in `demoMedia.ts` and `demoOutroMedia.ts`.

The PNG sources remain available for authoring. Only imported assets enter the renderer bundle; the extension resource copy excludes this directory. `hand.png` stays PNG because the available WebP encoder changes hidden RGB values under transparent pixels. Its PNG encoding is optimized instead.

Encode WebP with FFmpeg's `libwebp`, `-lossless 1 -compression_level 6 -quality 100 -pix_fmt bgra`. Compare SHA256 hashes of the source and output decoded to raw RGBA before adopting a result, and keep it only if smaller. Update the MIME type and byte sizes in `demoCreationData.ts` and `demoSmileData.ts` when changing frame encodings.

The Store build checks the extracted MSIX with `scripts/verify-store-payload.mjs`: runtime WebP images must be present, replaced authoring PNGs must stay out, and preserved hand/portrait PNGs must remain. Update the asset policy when intentionally changing this inventory. This packaging check reads the ASAR index; it does not replace pixel or provenance verification when editing media. Follow `docs/release/packaging-inputs.md` for reproducible release inputs.
