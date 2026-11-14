# Walkman sound effects

Drop audio files here with these exact names to replace the built-in synthesized sounds.
Any file that's missing keeps using the synth fallback.

| File              | Plays when                     |
| ----------------- | ------------------------------ |
| `key-press.mp3`   | A transport key is pressed     |
| `key-release.mp3` | The key springs back up        |
| `eject.mp3`       | The EJECT button is pressed    |
| `insert.mp3`      | A tape is dropped into the door |
| `flip.mp3`        | FLIP turns the tape over       |
| `fast-forward.mp3` | Loops while FF winds the tape  |
| `rewind.mp3`      | Loops while REW winds the tape |

Using `.wav` or `.ogg` instead? Change the extension in `SFX_FILES` in
`frontend/src/audio/sfx.ts`. Volumes per sound are set there too.

Tips: keep clips short (under half a second) and trim the silence at the start so
they line up with the button press. The two winding sounds are the exception: they
loop for as long as the key is down, so make them a second or two and loop seamlessly. Only add sounds you have the rights to use
(for example CC0 sounds from freesound.org or your own recordings).
