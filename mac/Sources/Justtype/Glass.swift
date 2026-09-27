import AppKit
import WebKit

// The page's glass on macOS 26, drawn by the system (src/macGlass.js says
// what is where). The buttons, the two layouts and the writer's pill are the
// system's glass controls over the page, their words set in the page's font;
// a press presses the page's element under them, which keeps its place,
// see-through. The slate cards' glass lies behind the page, under their
// words, and stops at the bottom of the bar they slide under.
@available(macOS 26.0, *)
final class GlassLayer: NSObject {
    private weak var webView: WKWebView?
    private let over = PassThroughView()
    private let under = FlippedView()
    private let cards = FlippedView()
    // The command palette's glass: a picture of the window as it was when the
    // palette opened, and the system's glass over it where the palette's box
    // is; the page shows only the box's words, over both
    private let backdrop = NSImageView()
    private let panels = FlippedView()
    private var panel: NSGlassEffectView?
    // The page under the glass blurred (GlassTuning frost), clipped to the box
    private let frostClip = FlippedView()
    private let frostView = NSImageView()
    private var shot: CGImage?
    private var frosted: (amount: Double, image: NSImage)?
    private var panelFrame = NSRect.zero
    private var tuningWatch: NSObjectProtocol?
    private var views: [String: NSView] = [:]
    // Glass cards over the page by name: the math preview, the hover card
    private var tips: [String: MathPeek] = [:]
    // What the writer's pill opens in a narrow window (PillPanel.swift)
    private var pillPanel: PillPanel!
    private var pillId: String?
    private var pillLast: ([String: Any], NSRect, CGFloat)?

    init(webView: WKWebView, container: NSView) {
        self.webView = webView
        super.init()
        over.frame = webView.bounds
        over.autoresizingMask = [.width, .height]
        webView.addSubview(over)
        under.frame = webView.frame
        under.autoresizingMask = [.width, .height]
        container.addSubview(under, positioned: .below, relativeTo: webView)
        cards.wantsLayer = true
        cards.layer?.masksToBounds = true
        cards.frame = under.bounds
        under.addSubview(cards)
        // A speck of glass under the close light from the start, under the
        // page and over it, so the window holds the system's glass before
        // the page draws: the first glass in the window (my slates' cards,
        // opened for the first time) is when WebKit stopped putting the page
        // on screen. The light, the window's or full screen's own, covers it.
        for host in [under, over] {
            let warm = NSGlassEffectView(frame: NSRect(x: 25, y: 25, width: 2, height: 2))
            warm.style = .regular
            host.addSubview(warm)
        }
        frostClip.wantsLayer = true
        frostClip.layer?.masksToBounds = true
        frostView.imageScaling = .scaleAxesIndependently
        frostClip.addSubview(frostView)
        tuningWatch = NotificationCenter.default.addObserver(forName: GlassTuning.changed, object: nil, queue: .main) { [weak self] _ in
            self?.tune()
        }
        webView.evaluateJavaScript(GlassTuning.current.css)
        pillPanel = PillPanel(host: over, webView: webView)
        pillPanel.pill = { [weak self] in self?.pillId.flatMap { self?.views[$0] } }
        // The pill's lines turn to a cross while the panel is open
        pillPanel.onOpen = { [weak self] _ in
            guard let self, let id = self.pillId, let (state, frame, zoom) = self.pillLast else { return }
            self.button(id, state, frame, zoom)
        }
    }

    // The page's calls for the pill's panel: `pill` its items (and open or
    // toggle), `pillUpdates` what its tray holds
    func pill(_ method: String, _ args: [String: Any]) {
        if method == "pillUpdates" { pillPanel.updates(args) } else { pillPanel.set(args) }
    }

    // The palette glass as the settings say (GlassTuning.swift)
    // The glass as light or dark as the theme's ground (the window itself
    // keeps the dark appearance)
    static func appearance(for ground: NSColor) -> NSAppearance? {
        guard let rgb = ground.usingColorSpace(.sRGB) else { return nil }
        let light = 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent > 0.5
        return NSAppearance(named: light ? .aqua : .darkAqua)
    }

    private func tune() {
        let t = GlassTuning.current
        webView?.evaluateJavaScript(t.css)
        guard let glass = panel, let window = webView?.window else { return }
        glass.appearance = GlassLayer.appearance(for: window.backgroundColor ?? .black)
        glass.style = t.clear ? .clear : .regular
        glass.tintColor = t.tintColor(ground: window.backgroundColor ?? .black)
        glass.cornerRadius = t.radius
        placeFrost()
    }

    private func placeFrost() {
        let t = GlassTuning.current
        guard t.frost > 0.05, let shot, panel != nil else { frostClip.removeFromSuperview(); return }
        if frosted?.amount != t.frost {
            let input = CIImage(cgImage: shot)
            let scale = Double(shot.width) / max(1, backdrop.frame.width)
            let output = input.clampedToExtent().applyingGaussianBlur(sigma: t.frost * scale).cropped(to: input.extent)
            if let cg = CIContext().createCGImage(output, from: input.extent) {
                frosted = (t.frost, NSImage(cgImage: cg, size: backdrop.frame.size))
            }
        }
        frostView.image = frosted?.image
        frostClip.frame = panelFrame
        frostClip.layer?.cornerRadius = t.radius
        frostView.frame = backdrop.frame.offsetBy(dx: -panelFrame.minX, dy: -panelFrame.minY)
        if frostClip.superview == nil, let glass = panel { panels.addSubview(frostClip, positioned: .below, relativeTo: glass) }
    }

    // On: the window pictured now (its own pixels, the page before the palette
    // shows), laid under the page, and the glass at `rect` (page points) over
    // it; a later call with a rect only moves the glass. Off: both gone.
    func backdrop(_ args: [String: Any]) {
        guard let webView, let window = webView.window else { return }
        guard args["on"] as? Bool == true else {
            panel?.removeFromSuperview()
            panel = nil
            frostClip.removeFromSuperview()
            // The picture stays until the page has drawn itself again
            if args["keepPicture"] as? Bool == true { return }
            shot = nil
            frosted = nil
            backdrop.removeFromSuperview()
            backdrop.image = nil
            panels.removeFromSuperview()
            return
        }
        if backdrop.superview == nil {
            // The settings again with every palette: a page loaded since the
            // window opened has lost them, and its own fallbacks (a dim, a
            // smaller corner) showed around the glass
            webView.evaluateJavaScript(GlassTuning.current.css)
            guard let shot = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .bestResolution]) else { return }
            self.shot = shot
            backdrop.image = NSImage(cgImage: shot, size: window.frame.size)
            backdrop.imageScaling = .scaleAxesIndependently
            // The picture is of the whole window, placed where the window is
            backdrop.frame = under.convert(NSRect(origin: .zero, size: window.frame.size), from: nil)
            under.addSubview(backdrop)
            panels.frame = under.bounds
            under.addSubview(panels)
        }
        guard let rect = args["rect"] as? [String: Any] else { return }
        let zoom = webView.pageZoom
        let frame = NSRect(x: number(rect["x"]) * zoom, y: number(rect["y"]) * zoom,
                           width: number(rect["width"]) * zoom, height: number(rect["height"]) * zoom)
        let glass = panel ?? {
            // As the settings say (GlassTuning.swift)
            let t = GlassTuning.current
            let made = NSGlassEffectView()
            made.appearance = GlassLayer.appearance(for: window.backgroundColor ?? .black)
            made.style = t.clear ? .clear : .regular
            made.tintColor = t.tintColor(ground: window.backgroundColor ?? .black)
            made.alphaValue = 0
            panels.addSubview(made)
            panel = made
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                made.animator().alphaValue = 1
            }
            return made
        }()
        // The box's own corner; the palette's, as the settings tune it (it sends none)
        let corner = number(rect["radius"])
        glass.cornerRadius = (corner > 0 ? corner : GlassTuning.current.radius) * zoom
        glass.frame = frame
        panelFrame = frame
        placeFrost()
    }

    // A glass card over the page: the math being written, a hover card
    // (MathPeek.swift)
    func peek(_ args: [String: Any]) {
        guard let webView else { return }
        let id = args["id"] as? String ?? "math"
        let tip = tips[id] ?? MathPeek(host: over)
        tips[id] = tip
        tip.update(args, webView: webView)
    }

    func update(_ changes: [String: Any]) {
        guard let webView else { return }
        let zoom = webView.pageZoom
        for (id, value) in changes {
            guard let state = value as? [String: Any] else {
                views.removeValue(forKey: id)?.removeFromSuperview()
                // The pill gone (a wider window, another page): its panel with it
                if id == pillId { pillPanel.close(); pillId = nil }
                continue
            }
            let frame = NSRect(x: number(state["x"]) * zoom, y: number(state["y"]) * zoom,
                               width: number(state["width"]) * zoom, height: number(state["height"]) * zoom)
            switch state["kind"] as? String {
            case "card": card(id, state, frame, zoom)
            case "toggle": toggle(id, state, frame)
            default: button(id, state, frame, zoom)
            }
        }
    }

    // A slate card's glass, behind its words
    private func card(_ id: String, _ state: [String: Any], _ frame: NSRect, _ zoom: CGFloat) {
        let glass = views[id] as? NSGlassEffectView ?? {
            let made = NSGlassEffectView()
            made.style = .regular
            cards.addSubview(made)
            views[id] = made
            return made
        }()
        let clipTop = number(state["clipTop"]) * zoom
        if cards.frame.minY != clipTop || cards.frame.size != NSSize(width: under.bounds.width, height: max(0, under.bounds.height - clipTop)) {
            cards.frame = NSRect(x: 0, y: clipTop, width: under.bounds.width, height: max(0, under.bounds.height - clipTop))
        }
        glass.cornerRadius = number(state["radius"]) * zoom
        glass.frame = frame.offsetBy(dx: 0, dy: -clipTop)
        glass.alphaValue = number(state["alpha"])
    }

    // A button, or the writer's pill: the system's glass button with the
    // page's words in the page's font
    private func button(_ id: String, _ state: [String: Any], _ frame: NSRect, _ zoom: CGFloat) {
        let button = views[id] as? GlassButton ?? {
            let made = GlassButton(title: "", target: self, action: #selector(pressed(_:)))
            made.id = id
            made.bezelStyle = .glass
            made.borderShape = .capsule
            over.addSubview(made)
            views[id] = made
            return made
        }()
        let kind = state["kind"] as? String ?? "button"
        let text = cssColor(state["text"]) ?? .labelColor
        let ground = cssColor(state["bg"]) ?? .windowBackgroundColor
        var titleColor = text
        switch kind {
        case "primary":
            button.tintProminence = .primary
            button.bezelColor = text
            titleColor = ground
        case "danger":
            button.tintProminence = .primary
            button.bezelColor = .systemRed
            titleColor = .white
        default:
            button.tintProminence = .automatic
            button.bezelColor = nil
        }
        let height = frame.height
        button.controlSize = height >= 44 ? .extraLarge : height >= 34 ? .large : height >= 24 ? .regular : .small
        let font = pageFont(state, zoom)
        // The pill says what the page is saying now in its colour, else the count
        if kind == "pill", let tone = cssColor(state["tone"]) { titleColor = tone }
        let title = NSMutableAttributedString(string: state["label"] as? String ?? "", attributes: [.font: font, .foregroundColor: titleColor])
        button.frame = frame
        if kind == "pill" {
            pillId = id
            pillLast = (state, frame, zoom)
            pillPanel.colors(state)
            pillPanel.anchor(frame)
            button.attributedTitle = pillTitle(state["label"] as? String ?? "", font: font, color: titleColor, lines: text, in: button)
        } else {
            button.attributedTitle = title
        }
        button.alphaValue = number(state["alpha"])
        button.isEnabled = !(state["disabled"] as? Bool ?? false)
    }

    // The two layouts: a glass capsule, the chosen one lit inside it
    private func toggle(_ id: String, _ state: [String: Any], _ frame: NSRect) {
        let toggle = views[id] as? GlassToggle ?? {
            let made = GlassToggle(symbols: ["list.bullet", "square.grid.2x2"])
            made.onPick = { [weak self] index in self?.press(id, index: index) }
            over.addSubview(made)
            views[id] = made
            return made
        }()
        toggle.frame = frame
        toggle.alphaValue = number(state["alpha"])
        toggle.select(Int(number(state["selected"])), tint: cssColor(state["text"]) ?? .labelColor)
    }

    @objc private func pressed(_ sender: GlassButton) { press(sender.id, index: nil) }

    // The pill's one line, as the phone's: its words, then the three lines a
    // little apart (a cross while its panel is open), centred as one. Never
    // cut off: too long for the room the page made, the words shrink, to
    // three quarters at most
    private func pillTitle(_ words: String, font: NSFont, color: NSColor, lines: NSColor, in button: NSButton) -> NSAttributedString {
        let symbol = NSImage(systemSymbolName: pillPanel.isOpen ? "xmark" : "line.3.horizontal", accessibilityDescription: pillPanel.isOpen ? "close" : "menu")?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 13, weight: .medium).applying(.init(paletteColors: [lines])))
        let centred = NSMutableParagraphStyle()
        centred.alignment = .center
        func line(_ size: CGFloat) -> NSAttributedString {
            let font = NSFont(descriptor: font.fontDescriptor, size: size) ?? font
            let out = NSMutableAttributedString(string: words, attributes: [.font: font, .foregroundColor: color])
            if !words.isEmpty { out.append(NSAttributedString(string: "\u{2002}", attributes: [.font: font])) }
            if let symbol {
                let mark = NSTextAttachment()
                mark.image = symbol
                mark.bounds = NSRect(x: 0, y: ((font.capHeight - symbol.size.height) / 2).rounded(),
                                     width: symbol.size.width, height: symbol.size.height)
                out.append(NSAttributedString(attachment: mark))
            }
            out.addAttribute(.paragraphStyle, value: centred, range: NSRange(location: 0, length: out.length))
            return out
        }
        let full = line(font.pointSize)
        let room = button.cell?.titleRect(forBounds: button.bounds).width ?? button.bounds.width - 32
        let width = full.size().width
        guard room > 0, width > room else { return full }
        return line(max(font.pointSize * 0.75, (font.pointSize * room / width * 2).rounded(.down) / 2))
    }

    private func press(_ id: String, index: Int?) {
        let quoted = (try? JSONSerialization.data(withJSONObject: [id])).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        webView?.evaluateJavaScript("window.__jtGlass && window.__jtGlass.press(\(quoted)[0], \(index.map(String.init) ?? "undefined"))")
    }

    // The page's font for a control ("IBM Plex Mono", monospace at 14px,
    // weight 500), from the fonts the app carries
    private func pageFont(_ state: [String: Any], _ zoom: CGFloat) -> NSFont {
        let size = max(9, number(state["size"]) * zoom)
        let family = (state["font"] as? String ?? "").split(separator: ",").first
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"'")) } ?? ""
        let weight = Int(number(state["weight"]))
        let managerWeight = weight >= 700 ? 9 : weight >= 600 ? 8 : weight >= 500 ? 6 : 5
        return NSFontManager.shared.font(withFamily: family, traits: [], weight: managerWeight, size: size)
            ?? NSFont.monospacedSystemFont(ofSize: size, weight: weight >= 500 ? .medium : .regular)
    }

    private func number(_ value: Any?) -> CGFloat { CGFloat((value as? NSNumber)?.doubleValue ?? 0) }

    // "rgb(12, 12, 12)" or "rgba(12, 12, 12, 0.5)"
    private func cssColor(_ value: Any?) -> NSColor? { NSColor(css: value) }
}

extension NSColor {
    // A colour as the page's computed style gives it: "rgb(r, g, b)" or "rgba(r, g, b, a)"
    convenience init?(css value: Any?) {
        guard let css = value as? String else { return nil }
        let parts = css.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        self.init(srgbRed: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts.count >= 4 ? parts[3] : 1)
    }
}

@available(macOS 26.0, *)
final class GlassButton: NSButton {
    var id = ""
}

// Two symbols in one glass capsule; the chosen one sits in a lit pill that
// glides when the choice changes
@available(macOS 26.0, *)
final class GlassToggle: NSView {
    var onPick: ((Int) -> Void)?
    private let glass = NSGlassEffectView()
    private let lens = NSView()
    private var icons: [NSButton] = []
    private var selected = -1

    init(symbols: [String]) {
        super.init(frame: .zero)
        glass.style = .regular
        addSubview(glass)
        let content = NSView()
        lens.wantsLayer = true
        content.addSubview(lens)
        for (index, symbol) in symbols.enumerated() {
            let icon = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: nil) ?? NSImage(),
                                target: self, action: #selector(picked(_:)))
            icon.isBordered = false
            icon.tag = index
            content.addSubview(icon)
            icons.append(icon)
        }
        glass.contentView = content
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    override func layout() {
        super.layout()
        glass.frame = bounds
        glass.cornerRadius = bounds.height / 2
        let width = bounds.width / CGFloat(max(1, icons.count))
        for (index, icon) in icons.enumerated() {
            icon.frame = NSRect(x: CGFloat(index) * width, y: 0, width: width, height: bounds.height)
        }
        lens.frame = lensFrame(selected)
        lens.layer?.cornerRadius = lens.frame.height / 2
    }

    func select(_ index: Int, tint: NSColor) {
        for icon in icons { icon.contentTintColor = tint.withAlphaComponent(icon.tag == index ? 1 : 0.55) }
        lens.layer?.backgroundColor = tint.withAlphaComponent(0.16).cgColor
        guard index != selected else { return }
        let first = selected < 0
        selected = index
        if first { needsLayout = true; return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.32
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.3, 1.3, 0.5, 1)
            context.allowsImplicitAnimation = true
            lens.animator().frame = lensFrame(index)
        }
    }

    private func lensFrame(_ index: Int) -> NSRect {
        guard index >= 0, !icons.isEmpty else { return .zero }
        let width = bounds.width / CGFloat(icons.count)
        return NSRect(x: CGFloat(index) * width, y: 0, width: width, height: bounds.height).insetBy(dx: 3, dy: 3)
    }

    @objc private func picked(_ sender: NSButton) { onPick?(sender.tag) }
}

// Views laid over or under the page in its own top-down coordinates
final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

// Over the page, but only its glass takes the pointer: everywhere else a
// press goes through to the page
final class PassThroughView: NSView {
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}
