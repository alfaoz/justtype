import AppKit

// The palette glass's settings, for finding the right look by hand: a
// floating window (View > palette glass…) whose controls change the open
// palette as they move, kept between launches, and copied as one line to
// hand over. Temporary, until the look is settled.
struct GlassTuning: Codable, Equatable {
    var clear = true          // the system's clear glass, else the frosted one
    var tint = "theme"        // theme, black, white, none
    var tintAlpha = 0.7
    var frost = 0.0           // blur of the page under the glass, points
    var veil = 0.0            // the theme's ground drawn by the page over the glass, 0 to 1
    var dim = 0.0             // the page around the palette darkened, 0 to 1 (none by default)
    var radius = 18.0

    static let changed = Notification.Name("justtype.glassTuning")
    private static let key = "justtype.paletteGlass"

    static var current: GlassTuning = {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(GlassTuning.self, from: data) else { return GlassTuning() }
        return saved
    }() {
        didSet {
            if let data = try? JSONEncoder().encode(current) { UserDefaults.standard.set(data, forKey: key) }
            NotificationCenter.default.post(name: changed, object: nil)
        }
    }

    func tintColor(ground: NSColor) -> NSColor? {
        let base: NSColor? = switch tint {
        case "theme": ground
        case "black": .black
        case "white": .white
        default: nil
        }
        return base?.withAlphaComponent(tintAlpha)
    }

    var line: String {
        String(format: "glass=%@ tint=%@ tintAlpha=%.2f frost=%.1f veil=%.2f dim=%.2f radius=%.0f",
               clear ? "clear" : "regular", tint, tintAlpha, frost, veil, dim, radius)
    }

    // The page's side, as CSS variables (src/index.css html[data-mac-backdrop])
    var css: String {
        String(format: "(() => { const s = document.documentElement.style; s.setProperty('--palette-veil', '%.1f%%'); s.setProperty('--palette-dim', '%.3f'); s.setProperty('--palette-radius', '%.0fpx'); })()",
               veil * 100, dim, radius)
    }
}

final class GlassTuningPanel: NSObject {
    static let shared = GlassTuningPanel()
    private var panel: NSPanel?
    private let readout = NSTextField(labelWithString: "")
    private var values: [String: NSTextField] = [:]

    func show() {
        if panel == nil { build() }
        panel?.orderFrontRegardless()
    }

    private func build() {
        let made = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 360),
                           styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel, .hudWindow],
                           backing: .buffered, defer: false)
        made.title = "palette glass"
        made.isFloatingPanel = true
        made.level = .floating
        made.hidesOnDeactivate = false
        made.becomesKeyOnlyIfNeeded = true
        made.isReleasedWhenClosed = false

        let t = GlassTuning.current
        let style = NSSegmentedControl(labels: ["clear", "regular"], trackingMode: .selectOne, target: self, action: #selector(styleChanged(_:)))
        style.selectedSegment = t.clear ? 0 : 1
        let tint = NSSegmentedControl(labels: ["theme", "black", "white", "none"], trackingMode: .selectOne, target: self, action: #selector(tintChanged(_:)))
        tint.selectedSegment = ["theme", "black", "white", "none"].firstIndex(of: t.tint) ?? 0
        style.font = .justtype(12)
        tint.font = .justtype(12)

        let rows: [NSView] = [
            row("glass", style),
            row("tint", tint),
            slider("tint", key: "tintAlpha", value: t.tintAlpha, range: 0...1),
            slider("frost", key: "frost", value: t.frost, range: 0...40),
            slider("veil", key: "veil", value: t.veil, range: 0...1),
            slider("dim", key: "dim", value: t.dim, range: 0...0.8),
            slider("corners", key: "radius", value: t.radius, range: 0...36),
        ]
        let copy = NSButton(title: "copy settings", target: self, action: #selector(copySettings))
        let reset = NSButton(title: "reset", target: self, action: #selector(resetSettings))
        copy.font = .justtype(12)
        reset.font = .justtype(12)
        let buttons = NSStackView(views: [reset, copy])
        readout.font = .justtype(10)
        readout.textColor = .secondaryLabelColor
        readout.lineBreakMode = .byWordWrapping
        readout.maximumNumberOfLines = 3
        readout.preferredMaxLayoutWidth = 320
        let hint = NSTextField(labelWithString: "open the palette (⌘K) and move these")
        hint.textColor = .tertiaryLabelColor
        hint.font = .justtype(11)

        let stack = NSStackView(views: [hint] + rows + [readout, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 14, left: 16, bottom: 14, right: 16)
        made.contentView = stack
        made.setContentSize(stack.fittingSize)
        if let screen = NSScreen.main?.visibleFrame {
            made.setFrameTopLeftPoint(NSPoint(x: screen.maxX - made.frame.width - 24, y: screen.maxY - 24))
        }
        panel = made
        refresh()
    }

    private func row(_ title: String, _ control: NSView) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .justtype(12)
        label.widthAnchor.constraint(equalToConstant: 56).isActive = true
        let row = NSStackView(views: [label, control])
        row.spacing = 8
        return row
    }

    private func slider(_ title: String, key: String, value: Double, range: ClosedRange<Double>) -> NSView {
        let slider = NSSlider(value: value, minValue: range.lowerBound, maxValue: range.upperBound, target: self, action: #selector(slid(_:)))
        slider.identifier = NSUserInterfaceItemIdentifier(key)
        slider.isContinuous = true
        slider.widthAnchor.constraint(equalToConstant: 200).isActive = true
        let shown = NSTextField(labelWithString: "")
        shown.font = .justtype(11)
        shown.widthAnchor.constraint(equalToConstant: 40).isActive = true
        values[key] = shown
        return row(title, NSStackView(views: [slider, shown]))
    }

    private func refresh() {
        let t = GlassTuning.current
        values["tintAlpha"]?.stringValue = String(format: "%.2f", t.tintAlpha)
        values["frost"]?.stringValue = String(format: "%.1f", t.frost)
        values["veil"]?.stringValue = String(format: "%.2f", t.veil)
        values["dim"]?.stringValue = String(format: "%.2f", t.dim)
        values["radius"]?.stringValue = String(format: "%.0f", t.radius)
        readout.stringValue = t.line
    }

    @objc private func styleChanged(_ sender: NSSegmentedControl) {
        GlassTuning.current.clear = sender.selectedSegment == 0
        refresh()
    }

    @objc private func tintChanged(_ sender: NSSegmentedControl) {
        GlassTuning.current.tint = ["theme", "black", "white", "none"][max(0, sender.selectedSegment)]
        refresh()
    }

    @objc private func slid(_ sender: NSSlider) {
        var t = GlassTuning.current
        let v = sender.doubleValue
        switch sender.identifier?.rawValue {
        case "tintAlpha": t.tintAlpha = v
        case "frost": t.frost = v
        case "veil": t.veil = v
        case "dim": t.dim = v
        case "radius": t.radius = v.rounded()
        default: return
        }
        GlassTuning.current = t
        refresh()
    }

    @objc private func copySettings() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(GlassTuning.current.line, forType: .string)
    }

    @objc private func resetSettings() {
        GlassTuning.current = GlassTuning()
        panel?.close()
        panel = nil
        show()
    }
}
