import AppKit
import WebKit

// A throwaway profile (JUSTTYPE_CLEAN=1): signed out, with its own storage
// in memory, its own cookies and offline folder, no shortcut from other
// apps and no saved window size, so nothing of the everyday app is read or
// changed. For the pictures on justtype.io/mac (site-shots.sh).
enum Profile {
    static let clean = ProcessInfo.processInfo.environment["JUSTTYPE_CLEAN"] != nil
    static let store: WKWebsiteDataStore = clean ? .nonPersistent() : .default()
}

// A diagnostic build's log, at ~/Library/Logs/justtype/diag.log: what the
// page and the full screen bar are doing when something goes blank or grey
// on a real screen, where the probes cannot see. Temporary.
enum Diag {
    private static let file: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/justtype", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("diag.log")
    }()
    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func log(_ line: String) {
        let text = "\(clock.string(from: Date())) \(line)\n"
        guard let data = text.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: file)
        }
    }

    // The window's side of things, beside what the page says
    static func native(_ window: NSWindow, _ webView: WKWebView) -> String {
        "key=\(window.isKeyWindow) active=\(NSApp.isActive) occluded=\(!window.occlusionState.contains(.visible)) full=\(window.styleMask.contains(.fullScreen)) webHidden=\(webView.isHiddenOrHasHiddenAncestor) webInWindow=\(webView.window != nil) webFrame=\(NSStringFromRect(webView.frame))"
    }

    // Every shown view of a window but the page's own, top down, with what
    // it paints
    static func views(_ root: NSView?, skipping page: NSView?) -> String {
        var out: [String] = []
        func walk(_ view: NSView, _ depth: Int) {
            guard view !== page, !view.isHidden, depth < 7 else { return }
            let name = String(describing: type(of: view))
            let bg = view.layer?.backgroundColor.flatMap { NSColor(cgColor: $0) }
            let painted = (bg?.alphaComponent ?? 0) > 0.01
            out.append(String(repeating: " ", count: depth) + "\(name)\(NSStringFromRect(view.frame)) a=\(view.alphaValue)\(view.isOpaque ? " opaque" : "")\(painted ? " bg=\(bg!)" : "")\(view.layer?.opacity ?? 1 < 0.99 ? " lo=\(view.layer!.opacity)" : "")")
            for sub in view.subviews { walk(sub, depth + 1) }
        }
        if let root { walk(root, 0) }
        return out.joined(separator: "\n  ")
    }

    // A window's layers, top down: what each paints
    static func layers(_ root: CALayer?) -> String {
        var out: [String] = []
        func walk(_ layer: CALayer, _ depth: Int) {
            guard depth < 9 else { return }
            let bg = layer.backgroundColor.flatMap { NSColor(cgColor: $0) }
            let painted = (bg?.alphaComponent ?? 0) > 0.01
            var line = String(repeating: " ", count: depth) + "\(type(of: layer))\(NSStringFromRect(layer.frame)) o=\(layer.opacity)"
            if layer.isHidden { line += " hidden" }
            if painted { line += " bg=\(bg!)" }
            if let contents = layer.contents { line += " contents=\(type(of: contents))" }
            if let name = layer.name { line += " name=\(name)" }
            out.append(line)
            for sub in layer.sublayers ?? [] { walk(sub, depth + 1) }
        }
        if let root { walk(root, 0) }
        return out.joined(separator: "\n  ")
    }

    // The bar's views that draw something: shown, not see-through, and a
    // background colour or a material
    static func bar(_ root: NSView?) -> String {
        var out: [String] = []
        func walk(_ view: NSView, _ depth: Int) {
            guard !view.isHidden, view.alphaValue > 0.01, depth < 12 else { return }
            let name = String(describing: type(of: view))
            let bg = view.layer?.backgroundColor.flatMap { NSColor(cgColor: $0) }
            let painted = (bg?.alphaComponent ?? 0) > 0.01
            if painted || ["Effect", "Pocket", "Background", "Backdrop", "Glass"].contains(where: { name.contains($0) }) {
                out.append("\(name)\(NSStringFromRect(view.frame)) a=\(view.alphaValue)\(painted ? " bg=\(bg!)" : "")")
            }
            for sub in view.subviews { walk(sub, depth + 1) }
        }
        if let root { walk(root, 0) }
        return out.joined(separator: " | ")
    }

    // In the page: the route, whether it is visible and drawing (frames in
    // the last second), how opaque the view under the header is and what is
    // animating, 0.4 s and 1.5 s after every press and at every change of
    // visibility
    // The page's script errors, from the very start (a module that throws
    // while loading leaves the window empty with nothing else to say why)
    static let errors = """
    (() => {
      const post = (m) => { try { window.webkit.messageHandlers.diag.postMessage(m); } catch (e) {} };
      addEventListener('error', (e) => post({ why: 'error', msg: String(e.message), src: String(e.filename) + ':' + e.lineno + ':' + e.colno, stack: String(e.error && e.error.stack || '').slice(0, 1500) }), true);
      addEventListener('unhandledrejection', (e) => post({ why: 'rejection', msg: String(e.reason && e.reason.message || e.reason), stack: String(e.reason && e.reason.stack || '').slice(0, 1500) }));
      const was = console.error;
      console.error = (...a) => { post({ why: 'console.error', msg: a.map((x) => String(x && x.stack || x)).join(' ').slice(0, 1500) }); was.apply(console, a); };
    })();
    """

    static let script = """
    (() => {
      const post = (m) => { try { window.webkit.messageHandlers.diag.postMessage(m); } catch (e) {} };
      let frames = 0, fps = 0;
      const tick = () => { frames++; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      setInterval(() => { fps = frames; frames = 0; }, 1000);
      const snap = (why) => {
        const main = document.querySelector('.app-main');
        const first = main && main.firstElementChild;
        const cs = first && getComputedStyle(first);
        post({ why, path: location.pathname, vis: document.visibilityState, focus: document.hasFocus(), fps,
          op: cs ? cs.opacity : null, tr: cs ? cs.transform : null, header: !!document.querySelector('.app-header'),
          anims: document.getAnimations().slice(0, 6).map(a => (a.animationName || a.transitionProperty || '?') + ':' + a.playState + ':' + Math.round(a.currentTime || 0)) });
      };
      addEventListener('click', (e) => {
        const what = (e.target && e.target.closest && e.target.closest('button, a') || {}).innerText || '';
        snap('click ' + what.trim().slice(0, 20));
        setTimeout(() => snap('0.4s'), 400);
        setTimeout(() => snap('1.5s'), 1500);
      }, true);
      document.addEventListener('visibilitychange', () => snap('visibility'));
      addEventListener('load', () => setTimeout(() => snap('load'), 1000));
    })();
    """
}
