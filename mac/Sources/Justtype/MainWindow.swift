import AppKit
import WebKit

// A window: the web app's desktop layout in the system's WebKit. The page's
// header is the window's title bar (the traffic lights sit in its row, its
// empty parts move the window), the window takes the theme's colour, the
// app's own pages open as tabs beside it and everything else in the browser,
// file pickers and downloads go through the Mac's own panels, and closing
// the last window only hides it so nothing reloads.
final class MainWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    let window: AppWindow
    let webView: AppWebView
    private let bridge = NativeBridge()
    private var titleWatch: NSKeyValueObservation?
    private var layoutWatch: NSKeyValueObservation?
    private var closing = false
    private var fullScreenBar: FullScreenBar?
    private var closeAfterFullScreen = false
    private var glass: AnyObject?
    private var selfTestRan = false

    // The system's glass for the page's controls and cards (Glass.swift).
    // With it the page is see-through over the cards' glass, and on macOS 26
    // WebKit could stop putting my slates on screen after its entrance
    // animation; the Mac's page arrives without one (src/index.css).
    static let glass = true

    // Every open window and tab, the first one the app opened first
    private(set) static var all: [MainWindow] = []
    private static let scheme = AppScheme(webRoot: Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true))

    // The window the menus act on
    static var current: MainWindow? {
        all.first { $0.window.isKeyWindow } ?? all.first { $0.window.isMainWindow } ?? all.first
    }

    // A new window, or a tab beside `host`'s
    @discardableResult
    static func open(_ url: URL = AppScheme.start, beside host: NSWindow? = nil) -> MainWindow {
        let made = MainWindow(url: url, first: all.isEmpty)
        all.append(made)
        if let host { host.addTabbedWindow(made.window, ordered: .above) }
        made.show()
        return made
    }

    private init(url: URL, first: Bool) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(MainWindow.scheme, forURLScheme: AppScheme.scheme)
        config.websiteDataStore = Profile.store
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        config.applicationNameForUserAgent = "justtype-mac/\(version)"
        let content = config.userContentController
        content.addUserScript(WKUserScript(source: NativeBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: MainWindow.chromeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Diag.errors, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Diag.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        if ProcessInfo.processInfo.environment["JUSTTYPE_SELFTEST"] == "1" || ProcessInfo.processInfo.environment["JUSTTYPE_SHOTS"] != nil {
            content.addUserScript(WKUserScript(source: MainWindow.selfTestWatch, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = AppWebView(frame: .zero, configuration: config)
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        // WebKit pauses a page it thinks is covered, and its idea of covered
        // goes stale (a window in front, another Space): the page stays paused
        // on screen, my slates stuck on the first frame of its fade until a
        // switch of apps wakes it. The page pauses only when the window is
        // really gone (hidden, minimized, closed).
        if webView.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")) {
            webView.setValue(false, forKey: "windowOcclusionDetectionEnabled")
        }

        // A toolbar, even an empty one, is what gives the window the system's
        // title bar height and corner radius; the page draws under all of it
        window = AppWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()

        content.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        content.add(self, name: "chrome")
        content.add(self, name: "diag")
        bridge.window = window
        bridge.webView = webView
        window.page = webView

        let toolbar = NSToolbar(identifier: "justtype.window")
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        window.toolbarStyle = .unified
        window.titlebarSeparatorStyle = .none
        window.title = "justtype"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(srgbRed: 5 / 255, green: 5 / 255, blue: 5 / 255, alpha: 1)
        window.appearance = NSAppearance(named: .darkAqua)
        window.minSize = NSSize(width: 480, height: 360)
        window.isReleasedWhenClosed = false
        window.delegate = self
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760))
        window.contentView = container
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        if #available(macOS 26.0, *), MainWindow.glass {
            let layer = GlassLayer(webView: webView, container: container)
            glass = layer
            bridge.onGlass = { [weak layer] changes in layer?.update(changes) }
            bridge.onBackdrop = { [weak layer] args in layer?.backdrop(args) }
            bridge.onPeek = { [weak layer] args in layer?.peek(args) }
            bridge.onPill = { [weak layer] method, args in layer?.pill(method, args) }
        }
        window.collectionBehavior = [.fullScreenPrimary]
        window.tabbingIdentifier = "justtype"
        window.tabbingMode = .automatic
        if first && Profile.clean {
            window.center()
        } else if first {
            if !window.setFrameUsingName("justtype.main") { window.center() }
            window.setFrameAutosaveName("justtype.main")
        }

        webView.navigationDelegate = self
        webView.uiDelegate = self
        titleWatch = webView.observe(\.title) { [weak self] view, _ in
            if let title = view.title, !title.isEmpty { self?.window.title = title; MainWindow.refreshTabStrips() }
        }
        // The tab bar coming and going moves the top of the page
        // Again once the tab bar has finished moving
        layoutWatch = window.observe(\.contentLayoutRect) { [weak self] _, _ in
            self?.placeHeader()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self?.placeHeader() }
        }
        webView.load(URLRequest(url: url))
    }

    func show() {
        window.makeKeyAndOrderFront(nil)
    }

    func reload() { webView.reload() }

    // One of the page's commands, from the menu bar (App.jsx window.__jtMenu).
    // Before the page has loaded (the app opened by a shortcut, a service or
    // a file) the command waits for it, and the page is given a few seconds
    // to put its handler in place.
    private var pageLoaded = false
    private var waiting: [(String, String)] = []

    func run(_ action: String, payload: String) {
        if !window.isVisible { show() }
        guard pageLoaded else { waiting.append((action, payload)); return }
        webView.callAsyncJavaScript("""
        for (let i = 0; i < 50 && !window.__jtMenu; i++) await new Promise((r) => setTimeout(r, 100));
        if (window.__jtMenu) window.__jtMenu(action, payload || undefined);
        """, arguments: ["action": action, "payload": payload], in: nil, in: .page) { _ in }
    }

    func zoom(by step: CGFloat) {
        webView.pageZoom = step == 0 ? 1 : min(3, max(0.5, webView.pageZoom + step))
        placeHeader()
    }

    // The writer's unsaved text into the device's queue (window.__jtFlush in
    // src/App.jsx), then `done`, whatever happens, within two seconds
    func flush(_ done: @escaping () -> Void) {
        var finished = false
        let finish = { if !finished { finished = true; done() } }
        webView.callAsyncJavaScript("if (window.__jtFlush) { await window.__jtFlush(); } return 1;",
                                    arguments: [:], in: nil, in: .page) { _ in finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: finish)
    }

    // The last window hides, so its page, state and text stay as they were;
    // a tab closes for good once its text is in the queue
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closing { return true }
        // Out of full screen first, so its Space goes with it
        if window.inFullScreen {
            closeAfterFullScreen = true
            window.toggleFullScreen(nil)
            return false
        }
        if MainWindow.all.count == 1 {
            flush { }
            window.orderOut(nil)
            return false
        }
        flush { [weak self] in
            guard let self else { return }
            self.closing = true
            self.window.close()
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        guard closing else { return }
        titleWatch = nil
        layoutWatch = nil
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        MainWindow.all.removeAll { $0 === self }
    }

    func windowDidResize(_ notification: Notification) { placeHeader() }

    func windowDidChangeOcclusionState(_ notification: Notification) {
        Diag.log("window occlusion changed || \(Diag.native(window, webView))")
    }

    func windowDidBecomeKey(_ notification: Notification) {
        Diag.log("window became key || \(Diag.native(window, webView))")
        placeHeader()
    }

    // The header row through the move in and out of full screen, and the
    // system's bar kept out of sight from the moment it exists: an accessory
    // in the title bar, painted into AppKit's picture of the move where it
    // paints its grey band, and told when AppKit moves it into
    // NSToolbarFullScreenWindow (FullScreenBar.swift)
    private let barWatch = BarWatch()
    private var frameBeforeFullScreen: NSRect?

    func windowWillEnterFullScreen(_ notification: Notification) {
        frameBeforeFullScreen = window.frame
        if let screen = window.screen { barWatch.prepare(window, bar: barHeight, width: screen.frame.width) }
        if barWatch.parent == nil { window.addTitlebarAccessoryViewController(barWatch) }
        if fullScreenBar == nil { fullScreenBar = FullScreenBar(window: window, over: webView, bar: barHeight) }
    }

    func windowWillExitFullScreen(_ notification: Notification) {
        barWatch.clear()
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        placeHeader()
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        fullScreenBar?.detach()
        fullScreenBar = nil
        barWatch.removeFromParent()
        placeHeader()
        if closeAfterFullScreen {
            closeAfterFullScreen = false
            window.performClose(nil)
        }
    }


    // MARK: the header is the title bar

    // The title bar's height, the traffic lights' right edge and the tab
    // bar's height, handed to the page as CSS variables (src/index.css,
    // html[data-mac]) in its own pixels, so the header stands exactly in the
    // bar at any zoom. In full screen the lights stay beside the logo, in
    // the system's bar over the header (FullScreenBar).
    private var barHeight: CGFloat = 52
    private var lastTabs: CGFloat = 0
    private var lastInset: CGFloat?
    private var placed = ""

    // Measured in the window on screen (a tab behind another reports its
    // buttons elsewhere) and handed to every tab in its group
    private func placeHeader() {
        guard window.isVisible, let content = window.contentView,
              let close = window.standardWindowButton(.closeButton),
              let zoomButton = window.standardWindowButton(.zoomButton) else { return }
        let full = window.styleMask.contains(.fullScreen)
        let height = content.bounds.height
        let top = max(0, height - window.contentLayoutRect.maxY)
        var inset: CGFloat?
        if !full {
            // Measured from the lights, which move while the tab bar comes
            // and goes: a height the bar cannot have is a measure taken mid
            // move, and the last one stands until it settles
            let lights = close.convert(close.bounds, to: nil)
            let measured = ((height - lights.midY) * 2).rounded()
            if measured >= 28, measured <= max(28, top) { barHeight = measured }
            inset = (zoomButton.convert(zoomButton.bounds, to: nil).maxX + 20).rounded()
        } else {
            // The lights of full screen (FullScreenBar) stand where the
            // window's do, so the header keeps its place through the move
            inset = lastInset ?? fullScreenBar.map { ($0.lightsEdge + 20).rounded() }
        }
        // In full screen the tab bar sits under the header row, in the
        // system's bar
        var tabs = max(0, (full ? (fullScreenBar?.height ?? barHeight) : top) - barHeight)
        // In full screen the tabs are this app's own (TabStripView), in the
        // band under the header the system's would take
        let group = window.tabbedWindows ?? [window]
        if full {
            if fullScreenBar == nil { fullScreenBar = FullScreenBar(window: window, over: webView, bar: barHeight) }
            if group.count > 1 && tabs == 0 { tabs = 36 }
            if group.count < 2 { tabs = 0 }
        } else {
            if fullScreenBar != nil {
                fullScreenBar?.detach()
                fullScreenBar = nil
            }
            // In a window too the tabs are this app's glass strip, in the
            // band the system keeps for its own tab bar, whose view is hidden
            if group.count > 1 { hideSystemTabBar() }
        }
        placeTabStrip(tabs, group: group)
        for tab in MainWindow.all where tab === self || group.contains(tab.window) {
            tab.apply(bar: barHeight, tabs: tabs, inset: inset)
        }
    }

    private var tabStrip: TabStripView?

    private func placeTabStrip(_ height: CGFloat, group: [NSWindow]) {
        guard height > 0, let content = window.contentView else {
            tabStrip?.removeFromSuperview()
            tabStrip = nil
            return
        }
        let strip = tabStrip ?? {
            let made = TabStripView(frame: .zero)
            made.autoresizingMask = [.width, .minYMargin]
            made.onNew = { [weak self] in
                guard let self else { return }
                MainWindow.open(beside: self.window)
            }
            content.addSubview(made, positioned: .above, relativeTo: webView)
            tabStrip = made
            return made
        }()
        strip.frame = NSRect(x: 0, y: content.bounds.height - barHeight - height, width: content.bounds.width, height: height)
        let selected = window.tabGroup?.selectedWindow ?? window
        let key = window.tabGroup.map { ObjectIdentifier($0) }
        strip.update(windows: group, selected: selected, from: key.flatMap { MainWindow.lensAt[$0] })
        if let key, let index = group.firstIndex(where: { $0 === selected }) { MainWindow.lensAt[key] = index }
    }

    // The system's tab bar view, out of sight for good (AppKit shows it again
    // when tabs change); its band stays, and the glass strip stands in it
    private var tabBarWatches: [NSKeyValueObservation] = []
    private var hiddenTabBars: [NSView] = []
    private func hideSystemTabBar() {
        guard let frame = window.contentView?.superview else { return }
        var found: [NSView] = []
        func walk(_ view: NSView) {
            if String(describing: type(of: view)).contains("TabBar") { found.append(view); return }
            view.subviews.forEach(walk)
        }
        walk(frame)
        for bar in found where !hiddenTabBars.contains(where: { $0 === bar }) {
            hiddenTabBars.append(bar)
            bar.isHidden = true
            tabBarWatches.append(bar.observe(\.isHidden) { bar, _ in if !bar.isHidden { bar.isHidden = true } })
        }
    }

    // Which tab the glass stood under last, per tab group
    private static var lensAt: [ObjectIdentifier: Int] = [:]

    // A tab's name changed: the strips that show it
    static func refreshTabStrips() {
        for main in all where main.tabStrip != nil { main.placeHeader() }
    }

    private func apply(bar: CGFloat, tabs: CGFloat, inset: CGFloat?) {
        barHeight = bar
        lastTabs = tabs
        lastInset = inset
        webView.dragBand = bar
        let scale = webView.pageZoom
        let css = { (points: CGFloat) in String(format: "%.2fpx", points / scale) }
        let values = "\(css(bar))|\(css(tabs))|\(inset.map(css) ?? "")"
        guard values != placed else { return }
        placed = values
        let insetJS = inset.map { "s.setProperty('--mac-inset', '\(css($0))')" } ?? "s.removeProperty('--mac-inset')"
        webView.evaluateJavaScript("""
        (() => { const s = document.documentElement.style;
          s.setProperty('--mac-bar', '\(css(bar))'); s.setProperty('--mac-tabs', '\(css(tabs))'); \(insetJS); })()
        """)
    }

    // What the page tells the window: its background (the theme), and
    // whether the pointer is over the header's own ground, where a press
    // moves the window instead of reaching the page
    static let chromeScript = """
    (() => {
      const post = (m) => window.webkit.messageHandlers.chrome.postMessage(m);
      let last = '';
      // The theme's ground, not the body's: with the system's glass the body
      // is see-through (html[data-mac-glass]), and the window would stay black
      const probe = document.createElement('i');
      probe.style.cssText = 'display:none;background-color:var(--theme-bg)';
      const send = () => {
        if (!probe.isConnected) document.documentElement.appendChild(probe);
        const theme = getComputedStyle(probe).backgroundColor;
        const bg = theme && !theme.endsWith(', 0)') ? theme : getComputedStyle(document.body).backgroundColor;
        if (bg && bg !== last) { last = bg; post({ bg }); }
      };
      const watch = new MutationObserver(send);
      watch.observe(document.documentElement, { attributes: true });
      watch.observe(document.body, { attributes: true });
      watch.observe(document.head, { childList: true, subtree: true, characterData: true });
      send();
      const header = '.app-header, .page-header';
      const press = 'a, button, input, select, textarea, label, summary, [role], [tabindex], [contenteditable]';
      let ground = false;
      addEventListener('pointermove', (e) => {
        const t = e.target instanceof Element ? e.target : null;
        const next = !!t && !!t.closest(header) && !t.closest(press);
        if (next !== ground) { ground = next; post({ ground }); }
      }, { capture: true, passive: true });
    })();
    """

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if message.name == "diag" {
            let page = body.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " ")
                .replacingOccurrences(of: "\n", with: " ")
            Diag.log("page \(page) || \(Diag.native(window, webView))")
            return
        }
        if let ground = body["ground"] as? Bool { webView.overGround = ground; return }
        guard let bg = body["bg"] as? String, let color = MainWindow.color(bg) else { return }
        window.backgroundColor = color
        webView.underPageBackgroundColor = color
        let rgb = color.usingColorSpace(.sRGB) ?? color
        let luminance = 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
        window.appearance = NSAppearance(named: luminance < 0.5 ? .darkAqua : .aqua)
    }

    // "rgb(12, 12, 12)" or "rgba(12, 12, 12, 1)"
    private static func color(_ css: String) -> NSColor? {
        let numbers = css.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
            .compactMap { Double($0) }
        guard numbers.count >= 3 else { return nil }
        let alpha = numbers.count >= 4 ? numbers[3] : 1
        guard alpha > 0 else { return nil }
        return NSColor(srgbRed: numbers[0] / 255, green: numbers[1] / 255, blue: numbers[2] / 255, alpha: 1)
    }

    // MARK: links, windows, panels, downloads

    // A page of the app itself, at its own address or justtype.io's, as the
    // address the app opens it at. The server's own paths are not pages, and
    // /verify is about what the website serves, so both go to the browser.
    static func appPage(_ url: URL) -> URL? {
        let own = url.scheme == AppScheme.scheme && url.host == AppScheme.host
        let site = ["https", "http"].contains(url.scheme ?? "") && ["justtype.io", "www.justtype.io"].contains(url.host ?? "")
        guard own || site else { return nil }
        let path = url.path.isEmpty ? "/" : url.path
        let server = ["/api/", "/oauth/", "/auth/", "/collab/", "/.well-known/", "/assets/"]
        if server.contains(where: { path.hasPrefix($0) }) || path == "/verify" || !(path as NSString).pathExtension.isEmpty { return nil }
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = AppScheme.scheme
        parts.host = AppScheme.host
        parts.port = nil
        return parts.url
    }

    // A page on the app's own origin, as the public site's address
    private static func outside(_ url: URL) -> URL {
        guard url.scheme == AppScheme.scheme, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.scheme = "https"
        return parts.url ?? url
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download) }
        guard let url = action.request.url else { return decisionHandler(.allow) }
        // A new window: createWebViewWith decides where it opens
        guard let frame = action.targetFrame else { return decisionHandler(.allow) }
        // Frames inside the page (Turnstile's check) load where they are
        if !frame.isMainFrame || ["about", "blob", "data"].contains(url.scheme ?? "") { return decisionHandler(.allow) }
        if let page = MainWindow.appPage(url) {
            if url.scheme == AppScheme.scheme { return decisionHandler(.allow) }
            // A justtype.io link stays in the app
            decisionHandler(.cancel)
            webView.load(URLRequest(url: page))
            return
        }
        NSWorkspace.shared.open(MainWindow.outside(url))
        decisionHandler(.cancel)
    }

    // The page's process went away (memory, a crash in WebKit): load it again
    // rather than leave an empty window; the writer's text is in the queue
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NSLog("justtype: the page's process ended, reloading")
        webView.reload()
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // A new window: the app's own pages (a shared slate, terms, what's new)
    // open as a tab beside this one, anything else in the browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if let page = MainWindow.appPage(url) {
            MainWindow.open(page, beside: window)
        } else {
            NSWorkspace.shared.open(MainWindow.outside(url))
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { answer in completionHandler(answer == .OK ? panel.urls : nil) }
    }

    // The page's alert() and confirm(), in justtype's own panel as a sheet
    private var sheet: JustPanel?

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let panel = JustPanel()
        sheet = panel
        panel.sheet(on: window, page: webView, title: message, detail: nil, actions: [.space, .main("ok") { [weak self] in
            panel.end()
            self?.sheet = nil
            completionHandler()
        }])
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let panel = JustPanel()
        sheet = panel
        let answer = { [weak self] (yes: Bool) in
            panel.end()
            self?.sheet = nil
            completionHandler(yes)
        }
        panel.sheet(on: window, page: webView, title: message, detail: nil,
                    actions: [.space, .cancel("cancel") { answer(false) }, .main("ok") { answer(true) }])
    }

    // Exports land in Downloads, shown in Finder when done
    private var downloads: [ObjectIdentifier: URL] = [:]

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        var target = folder.appendingPathComponent(suggestedFilename)
        let base = target.deletingPathExtension().lastPathComponent, ext = target.pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: target.path) {
            target = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        downloads[ObjectIdentifier(download)] = target
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        let queued = waiting
        waiting.removeAll()
        for (action, payload) in queued { run(action, payload: payload) }
        placed = ""
        apply(bar: barHeight, tabs: lastTabs, inset: lastInset)
        placeHeader()
        if let folder = ProcessInfo.processInfo.environment["JUSTTYPE_TABCLOSE"], !selfTestRan, MainWindow.all.first === self {
            selfTestRan = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.runTabCloseProbe(URL(fileURLWithPath: folder)) }
            return
        }
        if let fs = ProcessInfo.processInfo.environment["JUSTTYPE_FS"], !selfTestRan, MainWindow.all.first === self {
            selfTestRan = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.runFullScreenProbe(URL(fileURLWithPath: fs)) }
            return
        }
        if let shots = ProcessInfo.processInfo.environment["JUSTTYPE_SHOTS"], !selfTestRan, MainWindow.all.first === self {
            selfTestRan = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.runShots(URL(fileURLWithPath: shots)) }
            return
        }
        guard ProcessInfo.processInfo.environment["JUSTTYPE_SELFTEST"] == "1", !selfTestRan, MainWindow.all.first === self else { return }
        selfTestRan = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.runSelfTest() }
    }

    // MARK: self-test (JUSTTYPE_SELFTEST=1): checks the relay, the bridge,
    // the header in the title bar and that the app rendered, prints the
    // result and quits

    // Snapshots for checking the design (JUSTTYPE_SHOTS=<folder>): the plan
    // in <folder>/plan.json is a list of { name, route?, js?, type?, click?,
    // width?, height?, wait?, activate?, tab? }; each step sizes the window, goes to the
    // route, runs the script, presses the page's control with the words in
    // `click` as the mouse would (through the window), waits, saves
    // <name>.png of the page and adds what the page says to report.json
    // (errors, what is on screen), then the app quits
    private func runShots(_ folder: URL) {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("plan.json")),
              let plan = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { NSApp.terminate(nil); return }
        var report: [[String: Any]] = []
        func finish() {
            if let json = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                try? json.write(to: folder.appendingPathComponent("report.json"))
            }
            NSApp.terminate(nil)
        }
        func step(_ i: Int) {
            guard i < plan.count else { return finish() }
            let shot = plan[i]
            if shot["front"] as? Bool == true { window.orderFrontRegardless() }
            // `activate`: the app in front and the window key, as someone
            // using it sees it (coloured lights, the caret, focus)
            if shot["activate"] as? Bool == true {
                NSApp.activate(ignoringOtherApps: true)
                (window.tabGroup?.selectedWindow ?? window).makeKeyAndOrderFront(nil)
            }
            if shot["hide"] as? Bool == true { window.orderOut(nil) }
            if let width = shot["width"] as? Double, let height = shot["height"] as? Double {
                window.setContentSize(NSSize(width: width, height: height))
            }
            // `tab`: a new tab beside this one, as the menu opens it; the
            // step's route and script go to it
            let target = shot["tab"] as? Bool == true ? MainWindow.open(beside: window) : (MainWindow.all.first { $0.window === window.tabGroup?.selectedWindow } ?? self)
            var js = ""
            if let route = shot["route"] as? String,
               let quoted = String(data: try! JSONSerialization.data(withJSONObject: [route]), encoding: .utf8) {
                js += "history.pushState({}, '', \(quoted)[0]); dispatchEvent(new PopStateEvent('popstate'));"
            }
            if let extra = shot["js"] as? String { js += extra }
            // `type`: a text file beside the plan, typed where the caret is
            if let file = shot["type"] as? String,
               var text = try? String(contentsOf: folder.appendingPathComponent(file), encoding: .utf8) {
                while text.hasSuffix("\n") { text.removeLast() }
                if let quoted = String(data: try! JSONSerialization.data(withJSONObject: [text]), encoding: .utf8) {
                    js += "const box = document.querySelector('.cm-content') || document.querySelector('textarea'); box.focus(); document.execCommand('insertText', false, \(quoted)[0]);"
                }
            }
            target.webView.evaluateJavaScript("(() => { \(js) })(); 0") { _, _ in
                self.click(shot["click"] as? String) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + (shot["wait"] as? Double ?? 2)) {
                        // `probe`: a script whose answer goes in the report too,
                        // asked of the tab on show
                        let probe = shot["probe"] as? String ?? "null"
                        let showing = MainWindow.all.first { $0.window === self.window.tabGroup?.selectedWindow } ?? self
                        showing.webView.evaluateJavaScript("[\(MainWindow.stateProbe), (() => { try { return JSON.stringify(\(probe)); } catch (e) { return String(e); } })()]") { value, error in
                            let parts = value as? [Any] ?? []
                            let decode = { (index: Int) -> Any in
                                (parts.count > index ? parts[index] as? String : nil).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8), options: .fragmentsAllowed) } ?? NSNull()
                            }
                            report.append(["name": shot["name"] as? String ?? String(i), "page": error.map { "\($0)" } ?? decode(0), "probe": decode(1),
                                           "window": ["occludedVisible": self.window.occlusionState.contains(.visible), "visible": self.window.isVisible,
                                                      "key": self.window.isKeyWindow, "appActive": NSApp.isActive, "frame": NSStringFromRect(self.window.frame)]])
                            // The window as the screen shows it, native glass included
                            // (the tab on show, when there are tabs)
                            let shown = self.window.tabGroup?.selectedWindow ?? self.window
                            if let picture = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(shown.windowNumber), [.boundsIgnoreFraming, .bestResolution]),
                               let png = NSBitmapImageRep(cgImage: picture).representation(using: .png, properties: [:]) {
                                try? png.write(to: folder.appendingPathComponent("\(shot["name"] as? String ?? String(i))-window.png"))
                            }
                            showing.webView.takeSnapshot(with: nil) { image, _ in
                                if let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                                    try? png.write(to: folder.appendingPathComponent("\(shot["name"] as? String ?? String(i)).png"))
                                }
                                step(i + 1)
                            }
                        }
                    }
                }
            }
        }
        step(0)
    }

    // A press on the page's button or link that says `words` (else on the
    // innermost thing that says them, a row's title), sent through the
    // window as the mouse would
    private func click(_ words: String?, then done: @escaping () -> Void) {
        guard let words else { return done() }
        let find = "const shown = (e) => e.textContent.trim() === words && e.getClientRects().length; const el = [...document.querySelectorAll('button, a')].find(shown) || [...document.querySelectorAll('body *')].filter(shown).pop(); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];"
        webView.callAsyncJavaScript(find, arguments: ["words": words], in: nil, in: .page) { result in
            guard case .success(let value) = result, let spot = value as? [Double], spot.count == 2 else { return done() }
            let zoom = self.webView.pageZoom
            // The web view counts down from its top, as the page does
            let y = spot[1] * zoom
            let local = NSPoint(x: spot[0] * zoom, y: self.webView.isFlipped ? y : self.webView.bounds.height - y)
            let point = self.webView.convert(local, to: nil)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                if let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                  windowNumber: self.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                    self.window.sendEvent(event)
                }
            }
            done()
        }
    }

    // What is on the page: its route, whether anything rendered, the words
    // on screen, and every error since it loaded (selfTestWatch)
    static let stateProbe = """
    JSON.stringify({
      path: location.pathname,
      rootChildren: document.getElementById('root')?.childElementCount || 0,
      header: !!document.querySelector('.app-header'),
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
      errors: window.__errors || [],
      glass: document.documentElement.hasAttribute('data-mac-glass'),
    })
    """

    // Every call the page makes, from its first script on
    static let selfTestWatch = """
    window.__errors = [];
    addEventListener('error', (e) => __errors.push(String(e.message || e.error)));
    addEventListener('unhandledrejection', (e) => __errors.push('rejected: ' + String(e.reason && e.reason.message || e.reason)));
    const ce = console.error;
    console.error = function () { __errors.push('console: ' + [...arguments].map(a => String(a && a.stack || a)).join(' ').slice(0, 600)); return ce.apply(this, arguments); };
    window.__calls = [];
    const f = window.fetch;
    window.fetch = function (u) {
      const url = String(u && u.url || u);
      return f.apply(this, arguments).then(r => { __calls.push(url + ' ' + r.status); return r; },
        e => { __calls.push(url + ' failed'); throw e; });
    };
    """

    private func runSelfTest() {
        let lights = window.standardWindowButton(.closeButton).map { $0.convert($0.bounds, to: nil) } ?? .zero
        let height = window.contentView?.bounds.height ?? 0
        let native: [String: Any] = [
            "barHeight": barHeight, "lightsMidFromTop": height - lights.midY,
            "layoutTop": height - window.contentLayoutRect.maxY,
        ]
        let js = """
        const out = {};
        const t0 = performance.now();
        const health = await fetch('/api/health'); out.health = health.status;
        out.healthMs = Math.round(performance.now() - t0);
        const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'selftest-nobody', password: 'x', turnstile_token: 'selftest-not-a-real-token' }) });
        out.loginStatus = login.status; out.loginBody = (await login.text()).slice(0, 120);
        const me = await fetch('/api/auth/me', { credentials: 'include' }); out.meStatus = me.status;
        out.bridge = !!window.justtypeMac && window.justtypeMac.isPluginAvailable('ShellStore') && !window.justtypeMac.isPluginAvailable('ShellMenu');
        await window.justtypeMac.nativePromise('ShellStore', 'put', { store: 'lists', key: 'selftest', value: '{"userId":"selftest","ok":1}' });
        const got = await window.justtypeMac.nativePromise('ShellStore', 'get', { store: 'lists', key: 'selftest' });
        out.storeRoundTrip = got && got.value === '{"userId":"selftest","ok":1}';
        await window.justtypeMac.nativePromise('ShellStore', 'remove', { store: 'lists', key: 'selftest' });
        const gone = await window.justtypeMac.nativePromise('ShellStore', 'get', { store: 'lists', key: 'selftest' });
        out.storeRemove = gone && gone.value === null;
        out.rendered = (document.getElementById('root')?.childElementCount || 0) > 0;
        out.appRoute = (await fetch('/slates')).headers.get('content-type');
        out.title = document.title;
        out.offlineShown = [...document.querySelectorAll('button, span')].some(e => e.textContent.trim() === 'offline');
        out.callsOffOrigin = (window.__calls || []).filter(c => !c.startsWith('/') && !c.startsWith('capacitor:'));
        const header = document.querySelector('.app-header');
        const box = header && header.getBoundingClientRect();
        out.header = box && { top: box.top, height: Math.round(box.height), paddingLeft: getComputedStyle(header).paddingLeft };
        out.topElementIsHeader = !!document.elementFromPoint(innerWidth / 2, 4)?.closest('.app-header');
        out.pageHeight = innerHeight;
        out.macGlass = document.documentElement.hasAttribute('data-mac-glass');
        const go = async (path, ms) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); await new Promise(r => setTimeout(r, ms)); };
        await go('/slates', 2500);
        out.slatesRendered = !!document.querySelector('.slates-bar, .slate-item');
        await go('/', 1500);
        await go('/slates', 1500);
        await go('/', 1500);
        out.afterToggling = (document.getElementById('root')?.childElementCount || 0) > 0 && !!document.querySelector('.app-header');
        out.errors = window.__errors;
        return JSON.stringify(out);
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                let page = (value as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
                self.selfTestHeader(page.merging(native) { a, _ in a })
            case .failure(let error):
                print("SELFTEST FAILED \(error)"); fflush(stdout); NSApp.terminate(nil)
            }
        }
    }

    // A press on the header's login word, sent through the window as the
    // mouse would, has to reach the page (the toolbar sits over it); then
    // the terms, as a link would open them, have to come up as a tab
    private func selfTestHeader(_ results: [String: Any]) {
        var out = results
        let find = "const b = [...document.querySelectorAll('.app-header button')].find(e => /login/.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];"
        webView.callAsyncJavaScript(find, arguments: [:], in: nil, in: .page) { result in
            guard case .success(let value) = result, let spot = value as? [Double], spot.count == 2 else {
                out["headerLogin"] = "not found"; return self.selfTestTabs(out)
            }
            let zoom = self.webView.pageZoom
            let point = NSPoint(x: spot[0] * zoom, y: self.webView.bounds.height - spot[1] * zoom)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                if let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                  windowNumber: self.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                    self.window.sendEvent(event)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                self.webView.evaluateJavaScript("!!document.querySelector('input[type=password]')") { opened, _ in
                    out["headerLoginOpensSignIn"] = opened as? Bool ?? false
                    self.selfTestTabs(out)
                }
            }
        }
    }

    private func selfTestTabs(_ results: [String: Any]) {
        var out = results
        webView.evaluateJavaScript("document.querySelector('a[href=\"/terms\"]') ? 1 : 0") { _, _ in
            let tab = MainWindow.open(URL(string: "\(AppScheme.scheme)://\(AppScheme.host)/terms")!, beside: self.window)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                out["tabs"] = self.window.tabbedWindows?.count ?? 1
                out["layoutTopWithTabs"] = self.window.contentView!.bounds.height - self.window.contentLayoutRect.maxY
                tab.webView.evaluateJavaScript("[location.pathname, document.querySelector('.page-header') ? Math.round(document.querySelector('.page-header').getBoundingClientRect().height) : null, getComputedStyle(document.documentElement).getPropertyValue('--mac-tabs')]") { value, _ in
                    out["tabPage"] = value ?? NSNull()
                    self.webView.evaluateJavaScript("[getComputedStyle(document.documentElement).getPropertyValue('--mac-tabs'), Math.round(document.querySelector('.app-header').getBoundingClientRect().height)]") { first, _ in
                    out["firstWindowWithTabs"] = first ?? NSNull()
                    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data()
                    print("SELFTEST \(String(decoding: data, as: UTF8.self))")
                    fflush(stdout)
                    NSApp.terminate(nil)
                    }
                }
            }
        }
    }
}

// The web view, with what a title bar does: a press on the header's own
// ground moves the window, a double click there does what the system's
// setting says, and the right-click menu has no browser items
final class AppWebView: WKWebView {
    // How far down from the top the title bar reaches, in points
    var dragBand: CGFloat = 52
    // The page's word on what the pointer is over (MainWindow.chromeScript)
    var overGround = false

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let fromTop = isFlipped ? point.y : bounds.height - point.y
        guard overGround, fromTop <= dragBand, let window, !((window as? AppWindow)?.inFullScreen ?? false) else {
            return super.mouseDown(with: event)
        }
        if event.clickCount == 2 {
            switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
            case "Minimize": window.performMiniaturize(nil)
            case "None": break
            default: window.performZoom(nil)
            }
        } else {
            window.performDrag(with: event)
        }
    }

    private static let browserItems: Set<String> = [
        "WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
        "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierOpenImageInNewWindow",
        "WKMenuItemIdentifierOpenFrameInNewWindow", "WKMenuItemIdentifierOpenMediaInNewWindow",
        "WKMenuItemIdentifierDownloadLinkedFile", "WKMenuItemIdentifierDownloadImage", "WKMenuItemIdentifierDownloadMedia",
    ]

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        for item in menu.items where AppWebView.browserItems.contains(item.identifier?.rawValue ?? "") {
            menu.removeItem(item)
        }
        // No separator left at either end or twice in a row
        var previousWasSeparator = true
        for item in menu.items {
            if item.isSeparatorItem && previousWasSeparator { menu.removeItem(item) } else { previousWasSeparator = item.isSeparatorItem }
        }
        if let last = menu.items.last, last.isSeparatorItem { menu.removeItem(last) }
        super.willOpenMenu(menu, with: event)
    }
}

// The page draws under the title bar, but the bar's own views (the empty
// toolbar that gives the window its shape) sit over it and would take its
// presses. Presses in the bar, other than on the traffic lights, go to the
// page, which tells its own controls from its ground (AppWebView.mouseDown).
final class AppWindow: NSWindow {
    weak var page: AppWebView?
    private var pageHasMouse = false

    var inFullScreen: Bool { styleMask.contains(.fullScreen) }
    private var stripHit: NSView?

    // A snapshot run (JUSTTYPE_SHOTS) takes no typing: it runs beside
    // whoever is at the keyboard
    private static let shots = ["JUSTTYPE_SHOTS", "JUSTTYPE_FS", "JUSTTYPE_TABCLOSE"].contains { ProcessInfo.processInfo.environment[$0] != nil }

    override func sendEvent(_ event: NSEvent) {
        if AppWindow.shots, [.keyDown, .keyUp, .flagsChanged].contains(event.type) { return }
        guard let page else { return super.sendEvent(event) }
        // The tab strip stands in the band the title bar covers, which would
        // take its presses: they go to the strip's own buttons and tabs
        if event.type == .leftMouseDown, let content = contentView,
           let hit = content.hitTest(content.convert(event.locationInWindow, from: nil)),
           sequence(first: hit, next: { $0.superview }).contains(where: { $0 is TabStripView }) {
            // A button is pressed here and clicked on release inside it (its
            // own tracking does not run from here); a tab takes the press
            if let button = sequence(first: hit, next: { $0.superview }).first(where: { $0 is NSButton }) as? NSButton {
                stripHit = button
                button.highlight(true)
            } else {
                stripHit = hit
                hit.mouseDown(with: event)
            }
            return
        }
        if event.type == .leftMouseUp, let hit = stripHit {
            stripHit = nil
            if let button = hit as? NSButton {
                button.highlight(false)
                if button.bounds.contains(button.convert(event.locationInWindow, from: nil)) { button.performClick(nil) }
            } else {
                hit.mouseUp(with: event)
            }
            return
        }
        switch event.type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            pageHasMouse = inBar(event, page) && !onWindowButton(event)
            guard pageHasMouse else { break }
            if !isKeyWindow { makeKeyAndOrderFront(nil) }
            if firstResponder !== page { makeFirstResponder(page) }
            switch event.type {
            case .leftMouseDown: page.mouseDown(with: event)
            case .rightMouseDown: page.rightMouseDown(with: event)
            default: page.otherMouseDown(with: event)
            }
            return
        case .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            guard pageHasMouse else { break }
            switch event.type {
            case .leftMouseDragged: page.mouseDragged(with: event)
            case .rightMouseDragged: page.rightMouseDragged(with: event)
            default: page.otherMouseDragged(with: event)
            }
            return
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            guard pageHasMouse else { break }
            pageHasMouse = false
            switch event.type {
            case .leftMouseUp: page.mouseUp(with: event)
            case .rightMouseUp: page.rightMouseUp(with: event)
            default: page.otherMouseUp(with: event)
            }
            return
        default: break
        }
        super.sendEvent(event)
    }

    private func inBar(_ event: NSEvent, _ page: AppWebView) -> Bool {
        let fromTop = frame.height - event.locationInWindow.y
        return fromTop >= 0 && fromTop <= page.dragBand
    }

    private func onWindowButton(_ event: NSEvent) -> Bool {
        // The lights this window draws itself in full screen (FullScreenBar)
        if let hit = contentView?.hitTest(contentView!.convert(event.locationInWindow, from: nil)),
           hit is LightsView || hit.superview is LightsView || hit is TabStripView || hit.superview is TabStripView || hit.superview is TabItemView { return true }
        return [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].contains { kind in
            guard let button = standardWindowButton(kind), !button.isHidden else { return false }
            return button.convert(button.bounds, to: nil).insetBy(dx: -4, dy: -4).contains(event.locationInWindow)
        }
    }
}
