# justtype for the Mac

The web app's desktop layout in a native window: AppKit and the system's
WebKit, with no bundled browser engine. About 5.5 MB on disk and about
90 MB of memory with the page open.

- `sh build.sh` builds the web for the Mac (`../repo`, `VITE_OUT_DIR=dist-mac`),
  the app, and the icon (from `../ios/.../JT_ICON.icon`), and signs it.
  Add `--run` to open it, `--selftest` to check the relay, the bridge and
  the page and print the result, and `--no-web` to reuse the last web build.
- The page lives at `capacitor://justtype.io` (the iOS app's origin), served
  from the web build inside the app, so it opens offline. `/api/*` is relayed
  to https://justtype.io over the app's own URLSession, which keeps the
  session cookie (`AppScheme.swift`).
- `window.justtypeMac` answers the same native calls as the iOS shell
  (`NativeBridge.swift`): `ShellStore` (offline copies as files under
  Application Support/justtype/offline) and `ShellMenu.signIn` (Google through
  the system sheet). It claims nothing else, so the web keeps its own paths
  for the rest. `src/shell.js` has `inMac`, `inApp` and `nativeHost`.
- Closing the window hides it; quitting first asks the page to put unsaved
  text in the device's queue (`window.__jtFlush`).

## Full screen, as Chrome does it

The system's own full screen (`collectionBehavior = .fullScreenPrimary`),
with the traffic lights kept beside the logo and no grey bar, at rest or
while the window moves in and out (`FullScreenBar.swift`).

- **At rest.** AppKit moves the title bar, the lights and the toolbar into a
  window of its own, `NSToolbarFullScreenWindow`, over the header row. On
  macOS 26 that window paints a grey band no view of it accounts for, so the
  whole window is hidden (alpha 0, ignores the mouse) and kept hidden with
  key-value observing, because AppKit shows it again several times per move.
  The lights are the system's own buttons (`NSWindow.standardWindowButton`)
  in the page's window instead (`LightsView`), from the start of the move in
  to the end of the move out, so they never blink. The header's inset stays
  the same through the move, so the logo does not slide.
- **Catching the bar as it arrives.** An empty title bar accessory
  (`BarWatch`) goes into the title bar at the start of the move; AppKit
  carries its view into `NSToolbarFullScreenWindow`, and its
  `viewWillMove(toWindow:)` hides that window before it is ever drawn.
  Chrome catches the same window the same way.
- **The grey flash during the move.** AppKit animates the move with an
  overlay window (`_NSFullScreenTransitionOverlayWindow`) holding two
  pictures of the window, before and after. It paints the after picture's
  top 52 points flat grey, over the page's header, whatever the window
  shows. The one thing it does paint there is the title bar's accessories,
  which is how Chrome's tab strip rides through. So when a move begins,
  `BarWatch.prepare` takes a picture of the app's own window
  (`CGWindowListCreateImage`, about 6 ms, no permission needed for your own
  window), cuts out the header row with the lights and the logo, and draws
  it in the accessory for the size to come: the left part at the left, the
  words at the new right edge, the header's own colour between.
- **Closing in full screen** leaves full screen first, then closes.

How it was found: a probe instance (`JUSTTYPE_FS=<folder>`) enters and
leaves full screen while `screencapture -v -V 12` records the display;
`ffmpeg` splits the video into frames and the header row's average colour
per frame shows exactly when grey appears. Logging the app's windows during
the move found the overlay window, and saving its layers' images showed
the grey band inside the after picture.

## The blank page (my slates, first open)

On macOS 26 WebKit can stop putting frames on screen while the page runs
fine underneath (tauri-apps/wry#1848). The log (`Diagnostics.swift`, at
`~/Library/Logs/justtype/diag.log`) showed the page on /slates, visible, at
60 fps and fully opaque while the window showed nothing. Three things
together stopped it:

- WebKit's occlusion detection is off (`_setWindowOcclusionDetectionEnabled`),
  so a stale idea of "covered" never pauses the page.
- On the Mac, my slates and account arrive without their entrance slide and
  fade (`src/index.css`, `html[data-mac]`), the documented trigger.
- The window holds system glass from launch: a two-point `NSGlassEffectView`
  under the close light, under the page and over it (`Glass.swift`). The
  blank came only the first time glass entered the window (my slates'
  cards, opened for the first time); with glass already there it never
  starts. It sits under the light because in full screen the corner is not
  rounded and a speck there showed.

Not yet: the slate key in the keychain with Touch ID, updates (Sparkle),
the Developer ID signature and notarization for a DMG.
