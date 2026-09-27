import AppKit
import WebKit

// A glass card over the page: the math being written, typeset above it
// (src/components/mathPeek.js), and every hover card (src/hoverCard.js). The
// system's glass holds a small see-through page of its own, with the page's
// stylesheets and fonts from the app's own web build; the page says where,
// and what to show.
@available(macOS 26.0, *)
final class MathPeek: NSObject, WKNavigationDelegate {
    private weak var host: NSView?
    private var glass: NSGlassEffectView?
    // The glass inside a plain view that fades: the glass itself does not
    // fade by its own alpha, it popped in
    private let holder = NSView()
    private var target = NSRect.zero
    private var face: InertWebView?
    private var loaded = false
    private var waiting: String?
    private var visible = false

    init(host: NSView) {
        self.host = host
        super.init()
    }

    // A page of its own, see-through, that shows what the page sends: its
    // stylesheets, its theme's colours (the root's style), and the card's
    // own markup, whose own ground and edge the glass stands in for
    static let page = """
    <!doctype html><html id="tip"><head><meta charset="utf-8"><style>
    html#tip, html#tip body { margin: 0; height: 100%; background: transparent !important; overflow: hidden; }
    html#tip body { -webkit-user-select: none; cursor: default; }
    #face { width: 100%; height: 100%; box-sizing: border-box; white-space: nowrap; transition: opacity 0.15s ease; }
    #face.stale { opacity: 0.4; }
    #face .katex-display { margin: 0; }
    html#tip #face .hover-card-box { background: transparent !important; border-color: transparent !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; width: 100%; max-width: none; box-sizing: border-box; margin: 0; }
    html#tip #face .hover-card-box, html#tip #face .hover-card-box * { white-space: pre !important; }
    </style><script>
    const have = new Set();
    function show(p) {
      for (const href of p.styles) {
        if (have.has(href)) continue;
        have.add(href);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
      if (p.root) document.documentElement.setAttribute('style', p.root);
      document.body.className = p.bodyClass || '';
      const face = document.getElementById('face');
      face.setAttribute('style', p.faceStyle || '');
      face.className = p.stale ? 'stale' : '';
      face.innerHTML = p.html;
    }
    </script></head><body><div id="face"></div></body></html>
    """

    func update(_ args: [String: Any], webView: WKWebView) {
        guard let host, let window = webView.window else { return }
        guard args["on"] as? Bool == true, let rect = args["rect"] as? [String: Any] else {
            hide()
            return
        }
        let zoom = webView.pageZoom
        let frame = NSRect(x: number(rect["x"]) * zoom, y: number(rect["y"]) * zoom,
                           width: number(rect["width"]) * zoom, height: number(rect["height"]) * zoom)
        let glass = self.glass ?? make(in: host, config: webView.configuration)
        let t = GlassTuning.current
        let ground = window.backgroundColor ?? .black
        glass.appearance = GlassLayer.appearance(for: ground)
        glass.style = t.clear ? .clear : .regular
        glass.tintColor = t.tintColor(ground: ground)
        glass.cornerRadius = number(args["radius"]) * zoom
        target = frame
        holder.frame = frame.insetBy(dx: -12, dy: -12)
        // Mid-arrival the grow keeps going; otherwise it follows the page
        if holder.alphaValue > 0.99 || visible { glass.frame = NSRect(x: 12, y: 12, width: frame.width, height: frame.height) }
        face?.pageZoom = zoom

        var payload: [String: Any] = [:]
        for key in ["html", "styles", "root", "bodyClass", "faceStyle", "stale"] { payload[key] = args[key] }
        payload["styles"] = args["styles"] as? [String] ?? []
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "show(\(json))"
        if loaded {
            face?.evaluateJavaScript(script) { [weak self] _, _ in
                if self?.visible == true { self?.appear() }
            }
        } else {
            waiting = script
        }
        visible = true
    }

    private func make(in host: NSView, config: WKWebViewConfiguration) -> NSGlassEffectView {
        let glass = NSGlassEffectView()
        holder.wantsLayer = true
        holder.alphaValue = 0
        let settings = WKWebViewConfiguration()
        if let scheme = config.urlSchemeHandler(forURLScheme: AppScheme.scheme) {
            settings.setURLSchemeHandler(scheme, forURLScheme: AppScheme.scheme)
        }
        let face = InertWebView(frame: .zero, configuration: settings)
        face.setValue(false, forKey: "drawsBackground")
        face.navigationDelegate = self
        glass.contentView = face
        holder.addSubview(glass)
        host.addSubview(holder)
        face.loadHTMLString(MathPeek.page, baseURL: URL(string: "\(AppScheme.scheme)://\(AppScheme.host)/"))
        self.glass = glass
        self.face = face
        return glass
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        guard let script = waiting else { return }
        waiting = nil
        webView.evaluateJavaScript(script) { [weak self] _, _ in
            // The fonts and the math set before the card shows
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                if self?.visible == true { self?.appear() }
            }
        }
    }

    // In: a fade, and the glass grows into place from a little smaller
    private func appear() {
        guard let glass, holder.alphaValue < 1 else { return }
        let end = NSRect(x: 12, y: 12, width: target.width, height: target.height)
        glass.frame = end.insetBy(dx: end.width * 0.04, dy: end.height * 0.08)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.24
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.3, 1)
            holder.animator().alphaValue = 1
            glass.animator().frame = end
        }
    }

    // Out: a quicker fade, shrinking a touch
    private func hide() {
        visible = false
        waiting = nil
        guard let glass, holder.alphaValue > 0 else { return }
        let end = glass.frame
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            holder.animator().alphaValue = 0
            glass.animator().frame = end.insetBy(dx: end.width * 0.03, dy: end.height * 0.06)
        }
    }

    private func number(_ value: Any?) -> CGFloat { CGFloat((value as? NSNumber)?.doubleValue ?? 0) }
}

// A page that is only looked at: every press goes to what is under it
final class InertWebView: WKWebView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
