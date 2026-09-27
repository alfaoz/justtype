import AppKit
import WebKit

// JUSTTYPE_FS=<folder>: enters full screen, writes what is where to
// <folder>/fs.json (every window of the app, the traffic lights on screen and
// how lit they are, the header's inset), clicks the header's my slates or
// writer as the mouse would, checks the page went there, leaves full screen
// and quits.
extension MainWindow {
    func runFullScreenProbe(_ folder: URL) {
        var out: [[String: Any]] = []
        func save() {
            if let json = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
                try? json.write(to: folder.appendingPathComponent("fs.json"))
            }
        }
        let pageState = "JSON.stringify({ path: location.pathname, pad: getComputedStyle(document.querySelector('.app-header')).paddingLeft, inset: getComputedStyle(document.documentElement).getPropertyValue('--mac-inset'), bar: getComputedStyle(document.documentElement).getPropertyValue('--mac-bar'), tabs: getComputedStyle(document.documentElement).getPropertyValue('--mac-tabs') })"
        func record(_ name: String, then: @escaping () -> Void) {
            if let picture = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .bestResolution]),
               let png = NSBitmapImageRep(cgImage: picture).representation(using: .png, properties: [:]) {
                try? png.write(to: folder.appendingPathComponent("\(name.prefix(7)).png"))
            }
            var entry = fullScreenDump()
            entry["step"] = name
            if ProcessInfo.processInfo.environment["JUSTTYPE_FS_TABS"] == nil { entry.removeValue(forKey: "barViews") }
            webView.evaluateJavaScript(pageState) { value, _ in
                entry["page"] = value ?? NSNull()
                out.append(entry)
                save()
                then()
            }
        }
        // JUSTTYPE_FS_TABS: a second tab first, to see the tab bar in full screen
        if ProcessInfo.processInfo.environment["JUSTTYPE_FS_TABS"] != nil {
            MainWindow.open(beside: window)
            window.tabGroup?.selectedWindow = window
            window.makeKeyAndOrderFront(nil)
        }
        window.toggleFullScreen(nil)
        waitFor({ self.window.styleMask.contains(.fullScreen) }) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                record("entered") {
                    // A click on "my slates" as the mouse makes it: posted to the
                    // app's queue, over the header, where the system's bar is
                    let find = "const el = [...document.querySelectorAll('button, a')].find(e => e.closest('.app-header') && e.innerText.trim() === 'my slates' && e.getClientRects().length); if (!el) return [0, 0, document.querySelector('.app-header')?.innerText || 'no header']; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, el.textContent.trim()];"
                    self.webView.callAsyncJavaScript(find, arguments: [:], in: nil, in: .page) { result in
                        guard case .success(let value) = result, let spot = value as? [Any], spot.count == 3,
                              let x = (spot[0] as? NSNumber)?.doubleValue, let y = (spot[1] as? NSNumber)?.doubleValue, x > 0 else {
                            out.append(["clickFailed": "\(result)"]); save(); exit(1)
                        }
                        let zoom = self.webView.pageZoom
                        let inWindow = NSPoint(x: x * zoom, y: self.window.frame.height - y * zoom)
                        let screen = self.window.convertPoint(toScreen: inWindow)
                        let target = NSWindow.windowNumber(at: screen, belowWindowWithWindowNumber: 0)
                        let targetWindow = NSApp.window(withWindowNumber: target)
                        let local = targetWindow?.convertPoint(fromScreen: screen) ?? inWindow
                        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                            if let event = NSEvent.mouseEvent(with: type, location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                              windowNumber: target, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                                NSApp.postEvent(event, atStart: false)
                            }
                        }
                        out.append(["clicked": spot[2], "targetWindow": targetWindow.map { String(describing: type(of: $0)) } ?? "other app"])
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            record("after click, 5 s in") {
                                self.window.toggleFullScreen(nil)
                                self.waitFor({ !self.window.styleMask.contains(.fullScreen) }) {
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                        record("exited") { exit(0) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // JUSTTYPE_TABCLOSE=<folder>: a second tab opened and closed again; what
    // the page and the window say before, while two, and after
    func runTabCloseProbe(_ folder: URL) {
        var out: [[String: Any]] = []
        let js = "JSON.stringify({ tabs: getComputedStyle(document.documentElement).getPropertyValue('--mac-tabs'), bar: getComputedStyle(document.documentElement).getPropertyValue('--mac-bar'), header: (() => { const r = document.querySelector('.app-header, .page-header')?.getBoundingClientRect(); return r ? [r.top, r.height] : null; })(), scrollY, docTop: document.scrollingElement.scrollTop, rootTop: document.querySelector('.app-root')?.scrollTop, bodyTop: document.body.scrollTop, inner: innerHeight })"
        func record(_ step: String, then: @escaping () -> Void) {
            let shown = NSApp.windows.first { $0.isVisible && $0 is AppWindow && ($0.tabGroup?.selectedWindow ?? $0) === $0 } ?? window
            if let picture = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(shown.windowNumber), [.boundsIgnoreFraming, .bestResolution]),
               let png = NSBitmapImageRep(cgImage: picture).representation(using: .png, properties: [:]) {
                try? png.write(to: folder.appendingPathComponent("\(step).png"))
            }
            webView.evaluateJavaScript(js) { value, _ in
                out.append(["step": step, "page": value ?? NSNull(), "contentLayout": NSStringFromRect(self.window.contentLayoutRect), "barVisible": self.window.tabGroup?.isTabBarVisible ?? false,
                            "webFrame": NSStringFromRect(self.webView.frame), "tabs": self.window.tabbedWindows?.count ?? 1])
                if let json = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted]) { try? json.write(to: folder.appendingPathComponent("tabs.json")) }
                then()
            }
        }
        record("one") {
            let other = MainWindow.open(beside: self.window)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                record("two") {
                    // A press on the strip's +, as the mouse makes it
                    let shown = other.window
                    if let strip = shown.contentView?.subviews.first(where: { $0 is TabStripView }),
                       let plus = strip.subviews.first?.subviews.first(where: { ($0 as? NSButton)?.action == NSSelectorFromString("newTab") }) {
                        let point = plus.convert(NSPoint(x: plus.bounds.midX, y: plus.bounds.midY), to: nil)
                        let make = { (type: NSEvent.EventType) in
                            NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: shown.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
                        }
                        if let up = make(.leftMouseUp) { NSApp.postEvent(up, atStart: false) }
                        if let down = make(.leftMouseDown) { shown.sendEvent(down) }
                    } else { out.append(["plus": "not found"]) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        record("plus") {
                    other.window.performClose(nil)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        record("closed") { exit(0) }
                    }
                        }
                    }
                }
            }
        }
    }

    private func waitFor(_ ready: @escaping () -> Bool, then: @escaping () -> Void, tries: Int = 60) {
        if ready() || tries == 0 { return then() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.waitFor(ready, then: then, tries: tries - 1) }
    }

    private func fullScreenDump() -> [String: Any] {
        var out: [String: Any] = [:]
        // The page window's own views that draw, outside the page itself
        var own: [String] = []
        func walk(_ view: NSView, _ depth: Int) {
            guard view !== webView, depth < 14 else { return }
            let name = String(describing: type(of: view))
            let bg = view.layer?.backgroundColor.flatMap { NSColor(cgColor: $0) }
            own.append(String(repeating: " ", count: depth) + "\(name) \(NSStringFromRect(view.frame)) hidden=\(view.isHidden) a=\(view.alphaValue)" + ((bg?.alphaComponent ?? 0) > 0.01 ? " bg=\(bg!)" : "") + (view.layer?.sublayers.map { " sublayers=\($0.count)" } ?? ""))
            for sub in view.subviews { walk(sub, depth + 1) }
        }
        if let frame = window.contentView?.superview { walk(frame, 0) }
        out["pageWindowViews"] = own
        out["windows"] = NSApp.windows.map { w -> [String: Any] in
            ["class": String(describing: type(of: w)), "number": w.windowNumber, "frame": NSStringFromRect(w.frame),
             "visible": w.isVisible, "level": w.level.rawValue, "alpha": w.alphaValue,
             "occludedVisible": w.occlusionState.contains(.visible), "opaque": w.isOpaque,
             "bg": w.backgroundColor.map { "\($0)" } ?? "nil", "ignoresMouse": w.ignoresMouseEvents]
        }
        out["screen"] = NSStringFromRect(window.screen?.frame ?? .zero)
        out["contentLayoutRect"] = NSStringFromRect(window.contentLayoutRect)
        out["webViewInScreen"] = NSStringFromRect(window.convertToScreen(webView.convert(webView.bounds, to: nil)))
        var lights: [String: Any] = [:]
        for (key, kind) in [("close", NSWindow.ButtonType.closeButton), ("mini", .miniaturizeButton), ("zoom", .zoomButton)] {
            guard let b = window.standardWindowButton(kind), let w = b.window else { continue }
            var chain: [String] = []
            var v: NSView? = b
            while let view = v { chain.append("\(type(of: view)) hidden=\(view.isHidden) alpha=\(view.alphaValue)"); v = view.superview }
            lights[key] = ["inWindow": String(describing: type(of: w)), "windowNumber": w.windowNumber,
                           "screenRect": NSStringFromRect(w.convertToScreen(b.convert(b.bounds, to: nil))),
                           "hidden": b.isHidden, "enabled": b.isEnabled, "chain": chain]
        }
        out["lights"] = lights
        // The bar's views, in the window that holds the lights
        if let bar = window.standardWindowButton(.closeButton)?.window, let frame = bar.contentView?.superview {
            var views: [String] = []
            func walk(_ view: NSView, _ depth: Int) {
                guard depth < 9 else { return }
                let layer = view.layer
                let bg = layer?.backgroundColor.map { "\($0)" } ?? "-"
                views.append(String(repeating: "  ", count: depth) + "\(type(of: view)) \(NSStringFromRect(view.frame)) hidden=\(view.isHidden) alpha=\(view.alphaValue) opaque=\(view.isOpaque) layerOpacity=\(layer?.opacity ?? -1) bg=\(bg)")
                for sub in view.subviews { walk(sub, depth + 1) }
            }
            walk(frame, 0)
            out["barViews"] = views
        }
        // Which window a press would reach: over the logo, over the words on
        // the right, and on the close light
        if let screen = window.screen?.frame {
            let top = screen.maxY
            let points = ["logo": NSPoint(x: screen.minX + 200, y: top - 26), "words": NSPoint(x: screen.maxX - 150, y: top - 26),
                          "belowHeader": NSPoint(x: screen.midX, y: top - 120)]
            var hits: [String: Any] = [:]
            for (key, point) in points {
                let number = NSWindow.windowNumber(at: point, belowWindowWithWindowNumber: 0)
                hits[key] = ["number": number, "class": NSApp.window(withWindowNumber: number).map { String(describing: type(of: $0)) } ?? "other app"]
            }
            out["hits"] = hits
        }
        return out
    }

    // What the bar's window draws, as AppKit renders it (materials may come
    // out empty); the page's own snapshot beside it
    private func snapBar(_ url: URL) {
        guard let bar = window.standardWindowButton(.closeButton)?.window, let frame = bar.contentView?.superview else { return }
        guard let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds) else { return }
        frame.cacheDisplay(in: frame.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }
}
