import AppKit

// Full screen, the system's own (its own Space, the menu bar in the band at
// the top), with the traffic lights kept beside the logo the way Chrome keeps
// them, instead of hidden until the pointer reaches the top. The system puts
// the lights, with the toolbar, in a window of its own laid over the page's
// header row, and on macOS 26 that window paints a grey band over the header
// no view of it accounts for. So that window is kept out of sight and out of
// the way of the pointer (the toolbar stays, which is what keeps the menu bar
// behaving), and the lights are the system's own buttons in this window
// instead, where they are in a window: 13 points apart, the row's height.
final class FullScreenBar {
    private weak var window: AppWindow?
    private let lights = LightsView()

    // From the start of the move into full screen to the end of the move out,
    // so the lights never blink: until the system's own leave the window,
    // these sit exactly on them
    init?(window: AppWindow, over page: NSView, bar height: CGFloat) {
        guard let content = window.contentView else { return nil }
        self.window = window
        lights.build(for: window, row: height)
        lights.frame = NSRect(x: 0, y: content.bounds.height - height, width: lights.width, height: height)
        lights.autoresizingMask = [.minYMargin]
        content.addSubview(lights, positioned: .above, relativeTo: page)
        Diag.log("fullscreen lights attached at \(NSStringFromRect(lights.frame))")
    }

    // The system's bar out of sight and out of the pointer's way, and kept so
    // for as long as it lives (it goes away with full screen): AppKit shows it
    // again during the move in and out, which was the flash of grey
    static func keepHidden(_ bar: NSWindow) -> [NSKeyValueObservation] {
        bar.alphaValue = 0
        bar.ignoresMouseEvents = true
        return [
            bar.observe(\.alphaValue) { bar, _ in
                if bar.alphaValue != 0 { Diag.log("fullscreen bar shown again by the system, hidden"); bar.alphaValue = 0 }
            },
            bar.observe(\.ignoresMouseEvents) { bar, _ in
                if !bar.ignoresMouseEvents { bar.ignoresMouseEvents = true }
            },
        ]
    }

    func detach() {
        lights.removeFromSuperview()
    }

    // The lights' right edge, from the window's left
    var lightsEdge: CGFloat { lights.frame.minX + lights.width - LightsView.margin }

    // How tall the system's bar is, once it holds the system's lights: the
    // header row, and the tab bar under it when the window has tabs
    var height: CGFloat? {
        guard let window, let bar = window.standardWindowButton(.closeButton)?.window, bar !== window else { return nil }
        return bar.frame.height
    }
}

// The three lights, the system's own buttons (NSWindow.standardWindowButton
// (_:for:)), as they sit in a window: 20 points in, centred in the row, 23
// points apart. Hovering any of them shows all three glyphs, as in a title bar.
final class LightsView: NSView {
    static let margin: CGFloat = 20
    private static let left: CGFloat = 19, step: CGFloat = 23, size: CGFloat = 14
    private var inside = false {
        didSet { subviews.forEach { $0.needsDisplay = true } }
    }
    var width: CGFloat { LightsView.left + LightsView.step * 2 + LightsView.size + LightsView.margin }

    override var isFlipped: Bool { true }

    func build(for window: NSWindow, row: CGFloat) {
        subviews.forEach { $0.removeFromSuperview() }
        let kinds: [(NSWindow.ButtonType, Selector)] = [
            (.closeButton, #selector(NSWindow.performClose(_:))),
            (.miniaturizeButton, #selector(NSWindow.performMiniaturize(_:))),
            (.zoomButton, #selector(NSWindow.toggleFullScreen(_:))),
        ]
        for (index, (kind, action)) in kinds.enumerated() {
            guard let button = NSWindow.standardWindowButton(kind, for: window.styleMask) else { continue }
            button.target = window
            button.action = action
            // Full screen has nothing to minimize into, as in Chrome and Safari
            button.isEnabled = kind != .miniaturizeButton
            button.frame = NSRect(x: LightsView.left + CGFloat(index) * LightsView.step, y: ((row - LightsView.size) / 2).rounded(),
                                  width: LightsView.size, height: LightsView.size)
            addSubview(button)
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    override func mouseEntered(with event: NSEvent) { inside = true }
    override func mouseExited(with event: NSEvent) { inside = false }

    // AppKit asks a title bar's lights' container whether the pointer is over
    // the group, to show all three glyphs at once
    @objc func _mouseInGroup(_ button: NSButton) -> Bool { inside }
}

// The header row through the move in and out of full screen. AppKit draws
// the move from two pictures of the window, before and after, and paints the
// after picture's title bar row a flat grey (the toolbar's ground), over the
// page's header; what it does paint there is the title bar's accessories, as
// Chrome's tab strip rides through. So this accessory is the header row as
// it stands when the move begins, a picture of this window's own top: the
// lights and the logo at the left, the words at the right edge of the size to
// come, the header's own ground between. It rides into the bar window
// (NSToolbarFullScreenWindow), which is hidden as it arrives.
final class BarWatch: NSTitlebarAccessoryViewController {
    private var band: BandView { view as! BandView }

    override func loadView() {
        view = BandView(frame: NSRect(x: 0, y: 0, width: 0, height: 0))
        layoutAttribute = .leading
    }

    // Nothing: on the way out of full screen AppKit paints no grey band, and
    // in a window's title bar this accessory sits after the lights, so a
    // picture there would show a second set beside them
    func clear() {
        band.picture = nil
        band.ground = .clear
        band.frame = .zero
        band.needsDisplay = true
    }

    // The window's top `bar` points as they are on screen now, laid out for a
    // window `width` wide
    func prepare(_ window: NSWindow, bar: CGFloat, width: CGFloat) {
        let scale = window.backingScaleFactor
        let shot = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .bestResolution])
        let old = window.frame.width
        if let shot, shot.width > 0, let header = shot.cropping(to: CGRect(x: 0, y: 0, width: CGFloat(shot.width), height: bar * scale)) {
            band.picture = NSImage(cgImage: header, size: NSSize(width: old, height: bar))
            band.ground = BandView.color(of: header, at: CGPoint(x: old * scale / 2, y: bar * scale / 2)) ?? window.backgroundColor
        } else {
            band.picture = nil
            band.ground = window.backgroundColor
        }
        band.oldWidth = old
        band.frame = NSRect(x: 0, y: 0, width: width, height: bar)
        band.needsDisplay = true
    }
}

final class BandView: NSView {
    var picture: NSImage?
    var ground: NSColor = .black
    var oldWidth: CGFloat = 0
    private var watches: [NSKeyValueObservation] = []

    override func draw(_ dirtyRect: NSRect) {
        ground.setFill()
        bounds.fill()
        guard let picture, oldWidth > 0 else { return }
        let new = bounds.width, height = bounds.height
        // The words at the right, the logo and lights at the left
        let right = min(480, oldWidth / 2)
        let leftWidth = min(oldWidth - right, new - right)
        picture.draw(in: NSRect(x: 0, y: 0, width: leftWidth, height: height),
                     from: NSRect(x: 0, y: 0, width: leftWidth, height: height), operation: .sourceOver, fraction: 1)
        picture.draw(in: NSRect(x: new - right, y: 0, width: right, height: height),
                     from: NSRect(x: oldWidth - right, y: 0, width: right, height: height), operation: .sourceOver, fraction: 1)
    }

    static func color(of image: CGImage, at point: CGPoint) -> NSColor? {
        guard let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return nil }
        let x = Int(point.x), y = Int(point.y)
        guard x >= 0, y >= 0, x < image.width, y < image.height else { return nil }
        let offset = y * image.bytesPerRow + x * (image.bitsPerPixel / 8)
        let little = image.byteOrderInfo == .order32Little
        let (r, g, b) = little ? (bytes[offset + 2], bytes[offset + 1], bytes[offset]) : (bytes[offset], bytes[offset + 1], bytes[offset + 2])
        return NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
    }

    override func viewWillMove(toWindow window: NSWindow?) {
        super.viewWillMove(toWindow: window)
        Diag.log("bar watch moving to \(window.map { String(describing: type(of: $0)) } ?? "nothing")")
        guard let window, window.isKind(of: NSClassFromString("NSToolbarFullScreenWindow") ?? NSNull.self) else {
            watches.removeAll()
            return
        }
        watches = FullScreenBar.keepHidden(window)
    }
}

// The window's tabs in full screen, drawn here: the system draws them inside
// its full screen bar, which stays hidden for its grey (FullScreenBar). One
// glass capsule, as the layouts' toggle is: a tab per window of the group,
// named by what it holds, a lit pill gliding under the one on screen;
// hovering a tab shows its close, and + opens a new one beside.
final class TabStripView: NSView {
    var onNew: (() -> Void)?
    private var tabs: [TabItemView] = []
    private let content = NSView()
    // The glass lens under the tab on screen, gliding to the next one
    private let lens: NSView = {
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.style = .regular
            return glass
        }
        let plain = NSView()
        plain.wantsLayer = true
        plain.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.16).cgColor
        return plain
    }()
    private let plus = NSButton()
    private var selectedIndex = -1

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        content.addSubview(lens)
        plus.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "new tab")
        // A round glass button, as the system's own
        if #available(macOS 26.0, *) {
            plus.bezelStyle = .glass
            plus.borderShape = .circle
            plus.controlSize = .regular
        } else {
            plus.isBordered = false
        }
        plus.contentTintColor = .labelColor
        plus.target = self
        plus.action = #selector(newTab)
        content.addSubview(plus)
        // The bar itself is plain: the glass is the active tab's alone
        addSubview(content)
    }

    required init?(coder: NSCoder) { fatalError() }

    func update(windows: [NSWindow], selected: NSWindow?, from previous: Int? = nil) {
        while tabs.count > windows.count { tabs.removeLast().removeFromSuperview() }
        while tabs.count < windows.count {
            let made = TabItemView()
            content.addSubview(made)
            tabs.append(made)
        }
        for (index, (tab, window)) in zip(tabs, windows).enumerated() {
            tab.window_ = window
            tab.title = window.title
            // ⌘1 to ⌘8 pick that tab, ⌘9 the last (AppMenu)
            tab.shortcut = index < 8 ? "⌘\(index + 1)" : index == windows.count - 1 ? "⌘9" : ""
            tab.selected = window === selected
        }
        let index = windows.firstIndex { $0 === selected } ?? 0
        needsLayout = true
        layoutSubtreeIfNeeded()
        selectedIndex = index
        lens.frame = lensFrame(index)
        roundLens()
    }

    // Slim, as the system's tabs are
    private var capsule: NSRect { bounds.insetBy(dx: 8, dy: max(3, (bounds.height - 26) / 2)) }
    private let plusWidth: CGFloat = 34

    private func tabFrame(_ index: Int) -> NSRect {
        let area = NSRect(origin: .zero, size: capsule.size)
        let width = max(0, (area.width - plusWidth) / CGFloat(max(1, tabs.count)))
        return NSRect(x: CGFloat(index) * width, y: 0, width: width, height: area.height)
    }

    private func lensFrame(_ index: Int) -> NSRect {
        guard index >= 0, index < tabs.count else { return .zero }
        return tabFrame(index).insetBy(dx: 2, dy: 0)
    }

    override func layout() {
        super.layout()
        let box = capsule
        content.frame = box
        for (index, tab) in tabs.enumerated() { tab.frame = tabFrame(index) }
        let round = box.height
        plus.frame = NSRect(x: box.width - round, y: 0, width: round, height: round)
        if selectedIndex >= 0 { lens.frame = lensFrame(selectedIndex) }
        roundLens()
    }

    private func roundLens() {
        if #available(macOS 26.0, *), let glass = lens as? NSGlassEffectView { glass.cornerRadius = lens.frame.height / 2 }
        else { lens.layer?.cornerRadius = lens.frame.height / 2 }
    }

    @objc private func newTab() { onNew?() }
}

final class TabItemView: NSView {
    weak var window_: NSWindow?
    var title = "" { didSet { label.stringValue = title } }
    var shortcut = "" { didSet { key.stringValue = shortcut } }
    var selected = false { didSet { restyle() } }
    private var hovering = false { didSet { restyle() } }
    private let label = NSTextField(labelWithString: "")
    private let key = NSTextField(labelWithString: "")
    private let close = NSButton()

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        key.font = .justtype(11, medium: true)
        key.alignment = .right
        addSubview(key)
        label.font = .justtype(11, medium: true)
        label.alignment = .center
        label.lineBreakMode = .byTruncatingTail
        addSubview(label)
        close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "close tab")
        close.isBordered = false
        close.contentTintColor = .secondaryLabelColor
        close.imageScaling = .scaleProportionallyDown
        close.target = self
        close.action = #selector(closeTab)
        close.isHidden = true
        addSubview(close)
        restyle()
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        layer?.cornerRadius = (bounds.height - 2) / 2
        close.frame = NSRect(x: 12, y: (bounds.height - 14) / 2, width: 14, height: 14)
        label.frame = NSRect(x: 34, y: (bounds.height - 15) / 2, width: max(0, bounds.width - 68), height: 15)
        key.frame = NSRect(x: bounds.width - 44, y: (bounds.height - 15) / 2, width: 32, height: 15)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }

    override func mouseUp(with event: NSEvent) {
        guard let target = window_, bounds.contains(convert(event.locationInWindow, from: nil)) else { return }
        target.tabGroup?.selectedWindow = target
        target.makeKeyAndOrderFront(nil)
    }
    override func mouseDown(with event: NSEvent) {}

    @objc private func closeTab() { window_?.performClose(nil) }

    // The lit pill is the strip's; a tab only shows its hover, as a faint one
    private func restyle() {
        layer?.backgroundColor = (hovering && !selected ? NSColor.white.withAlphaComponent(0.06) : .clear).cgColor
        label.textColor = selected ? .labelColor : .secondaryLabelColor
        key.textColor = selected ? .labelColor : .tertiaryLabelColor
        close.isHidden = !hovering
    }
}
