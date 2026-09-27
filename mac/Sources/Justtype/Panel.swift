import AppKit
import WebKit

// justtype's own window for what the app has to say or ask (the update
// window, the yes-or-no sheets, the page's alerts): the icon, a line in the
// page's type, a quieter one under it, and a row of the system's glass
// capsules along the bottom: the one that goes on lit in the theme's ink
// (like "+ new slate"), a destructive one lit red, each brightening under
// the pointer. Its ground and ink are the open theme's. It floats on its own
// (show) or hangs from a window as a sheet (sheet).
final class JustPanel: NSObject, NSWindowDelegate {
    enum Action {
        case other(String, () -> Void)
        case cancel(String, () -> Void)
        case main(String, () -> Void)
        case danger(String, () -> Void)
        case space
    }

    let window: NSPanel
    var onClose: (() -> Void)?
    private let titleField = NSTextField(labelWithString: "")
    private let detailField = NSTextField(wrappingLabelWithString: "")
    private let row = NSStackView()
    private var handlers: [() -> Void] = []
    private var ink = NSColor.labelColor
    private var muted = NSColor.secondaryLabelColor
    private var ground = NSColor.windowBackgroundColor
    private var light = false

    override init() {
        window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 540, height: 170),
                         styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        super.init()
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.delegate = self
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.widthAnchor.constraint(equalToConstant: 64).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 64).isActive = true
        titleField.font = NSFont.justtype(15, medium: true)
        detailField.font = NSFont.justtype(12.5, medium: false)
        let words = NSStackView(views: [titleField, detailField])
        words.orientation = .vertical
        words.alignment = .leading
        words.spacing = 6
        let top = NSStackView(views: [icon, words])
        top.orientation = .horizontal
        top.alignment = .centerY
        top.spacing = 18
        row.orientation = .horizontal
        row.spacing = 10
        row.alignment = .centerY
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 34).isActive = true

        let body = NSStackView(views: [top, row])
        body.orientation = .vertical
        body.alignment = .leading
        body.spacing = 22
        body.edgeInsets = NSEdgeInsets(top: 38, left: 24, bottom: 22, right: 24)
        body.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(body)
        NSLayoutConstraint.activate([
            body.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            body.topAnchor.constraint(equalTo: content.topAnchor),
            body.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            body.widthAnchor.constraint(equalToConstant: 540),
            row.widthAnchor.constraint(equalTo: body.widthAnchor, constant: -48),
            words.widthAnchor.constraint(lessThanOrEqualToConstant: 540 - 48 - 64 - 18),
        ])
        detailField.preferredMaxLayoutWidth = 540 - 48 - 64 - 18
        window.contentView = content
    }

    func show(title: String, detail: String?, closable: Bool, actions: [Action]) {
        titleField.stringValue = title
        detailField.stringValue = detail ?? ""
        detailField.isHidden = detail == nil
        if closable { window.styleMask.insert(.closable) } else { window.styleMask.remove(.closable) }
        window.standardWindowButton(.closeButton)?.isHidden = !closable
        theme(MainWindow.current?.webView) { [weak self] in
            self?.fill(actions)
            self?.front()
        }
    }

    // As a sheet on `parent`, the way the Mac's alerts hang from a window
    private weak var parent: NSWindow?
    func sheet(on parent: NSWindow, page: WKWebView?, title: String, detail: String?, actions: [Action]) {
        titleField.stringValue = title
        detailField.stringValue = detail ?? ""
        detailField.isHidden = detail?.isEmpty ?? true
        window.styleMask.remove(.closable)
        window.standardWindowButton(.closeButton)?.isHidden = true
        theme(page) { [weak self] in
            guard let self else { return }
            self.fill(actions)
            self.fit()
            self.parent = parent
            parent.beginSheet(self.window)
        }
    }

    func end() {
        if let parent, window.sheetParent === parent { parent.endSheet(window) } else { window.orderOut(nil) }
        parent = nil
    }

    private func fill(_ actions: [Action]) {
        handlers = []
        row.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for action in actions {
            switch action {
            case .space:
                let space = NSView()
                space.setContentHuggingPriority(.fittingSizeCompression, for: .horizontal)
                row.addArrangedSubview(space)
            case .other(let words, let run):
                row.addArrangedSubview(button(words, run, kind: .other))
            case .cancel(let words, let run):
                row.addArrangedSubview(button(words, run, kind: .cancel))
            case .main(let words, let run):
                row.addArrangedSubview(button(words, run, kind: .main))
            case .danger(let words, let run):
                row.addArrangedSubview(button(words, run, kind: .danger))
            }
        }
        row.isHidden = actions.isEmpty
    }

    func detail(_ text: String) {
        detailField.stringValue = text
        detailField.isHidden = false
        fit()
    }

    func front() {
        fit()
        if !window.isVisible {
            if let main = MainWindow.current?.window, main.isVisible {
                let over = main.frame
                window.setFrameOrigin(NSPoint(x: over.midX - window.frame.width / 2, y: over.midY - window.frame.height / 2 + over.height / 6))
            } else {
                window.center()
            }
        }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        // Again once the capsules have their size in the window
        DispatchQueue.main.async { [weak self] in self?.fit() }
    }

    // The window around what it holds, grown or shrunk from its top edge
    private func fit() {
        guard let content = window.contentView else { return }
        content.layoutSubtreeIfNeeded()
        let size = content.fittingSize
        guard size.height > 0, size != content.frame.size else { return }
        var frame = window.frameRect(forContentRect: NSRect(origin: .zero, size: size))
        frame.origin = NSPoint(x: window.frame.minX, y: window.frame.maxY - frame.height)
        window.setFrame(frame, display: true)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        let later = onClose
        onClose = nil
        later?()
        return true
    }

    private enum Kind { case other, cancel, main, danger }

    private func button(_ words: String, _ run: @escaping () -> Void, kind: Kind) -> NSButton {
        let main = kind == .main || kind == .danger
        handlers.append(run)
        let made = UpdateButton(title: words, target: self, action: #selector(pressed(_:)))
        made.tag = handlers.count - 1
        made.controlSize = .large
        // No system-blue ring on whichever capsule comes first; Return still
        // presses the lit one
        made.focusRingType = .none
        let lit = kind == .danger ? NSColor.systemRed : ink
        let title = NSAttributedString(string: words, attributes: [.font: NSFont.justtype(13, medium: main), .foregroundColor: kind == .danger ? .white : main ? ground : ink])
        if #available(macOS 26.0, *) {
            made.bezelStyle = .glass
            made.borderShape = .capsule
            made.tintProminence = main ? .primary : .automatic
            let rest: NSColor? = main ? lit : nil
            let over: NSColor = main ? lit.blended(withFraction: 0.35, of: light ? .black : .white) ?? lit : ink.withAlphaComponent(0.2)
            made.bezelColor = rest
            made.onHover = { [weak made] on in
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = 0.15
                    context.allowsImplicitAnimation = true
                    made?.bezelColor = on ? over : rest
                }
            }
        } else {
            made.bezelStyle = .push
        }
        made.attributedTitle = title
        if main { made.keyEquivalent = "\r" }
        if kind == .cancel { made.keyEquivalent = "\u{1b}" }
        return made
    }

    @objc private func pressed(_ sender: NSButton) {
        guard handlers.indices.contains(sender.tag) else { return }
        handlers[sender.tag]()
    }

    // The open theme's ground and ink, read from the page
    private func theme(_ page: WKWebView?, then done: @escaping () -> Void) {
        let read = "(() => { const i = document.createElement('i'); document.documentElement.appendChild(i); const c = (v) => { i.style.color = 'var(' + v + ')'; return getComputedStyle(i).color; }; const out = [c('--theme-bg'), c('--theme-text'), c('--theme-text-muted')]; i.remove(); return out; })()"
        guard let page else { apply([]); return done() }
        page.evaluateJavaScript(read) { [weak self] value, _ in
            self?.apply(value as? [String] ?? [])
            done()
        }
    }

    private func apply(_ colors: [String]) {
        ground = colors.count > 0 ? NSColor(css: colors[0]) ?? ground : ground
        ink = colors.count > 1 ? NSColor(css: colors[1]) ?? ink : ink
        muted = colors.count > 2 ? NSColor(css: colors[2]) ?? muted : muted
        window.backgroundColor = ground
        let rgb = ground.usingColorSpace(.sRGB)
        light = rgb.map { 0.2126 * $0.redComponent + 0.7152 * $0.greenComponent + 0.0722 * $0.blueComponent > 0.5 } ?? false
        window.appearance = NSAppearance(named: light ? .aqua : .darkAqua)
        titleField.textColor = ink
        detailField.textColor = muted
    }
}

// A capsule that says when the pointer is over it
final class UpdateButton: NSButton {
    var onHover: ((Bool) -> Void)?
    private var area: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let made = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(made)
        area = made
    }

    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
}
