import AppKit
import WebKit

// The writer's pill in a narrow window opens what the phone's pill opens
// (ios/App/App/ShellPillPlugin.swift), laid out the same on the system's
// glass: save lit, export and about (and the updates tray) beside it, the
// slate's actions two to a row, and the settings behind a disclosure, each a
// row of words with a line under the chosen one. The page under it dims a
// little; a click off it, the pill (a cross while it is open) or escape
// closes it. The page keeps the items current (ShellGlass `pill`, as it does
// the phone's ShellPill `set`) and gets what is picked as `shell:pick`, the
// tray's own as `shell:nav`. Its words are the theme's, in its type.
@available(macOS 26.0, *)
final class PillPanel: NSObject {
    private weak var host: NSView?
    private weak var webView: WKWebView?
    // The pill it hangs from, and what the pill shows while it is open
    var pill: (() -> NSView?)?
    var onOpen: ((Bool) -> Void)?

    private var items: [[String: Any]] = []
    private var modelKey = ""
    private var updatesTitle = ""
    private var updatesEmpty = ""
    private var updateItems: [[String: Any]] = []
    private var updatesKey = ""
    private var unread = false

    // The theme's, from the page with the pill (src/macGlass.js)
    private var ink = NSColor.white
    private var muted = NSColor(white: 1, alpha: 0.6)
    private var faint = NSColor(white: 1, alpha: 0.4)
    private var line = NSColor(white: 1, alpha: 0.15)
    private var ground = NSColor.black
    private var colorKey = ""
    // The page's own: share while a link is out, and something unread
    private let blue = NSColor(srgbRed: 96 / 255, green: 165 / 255, blue: 250 / 255, alpha: 1)
    private let red = NSColor(srgbRed: 239 / 255, green: 68 / 255, blue: 68 / 255, alpha: 1)

    private var shade: Shade?
    private var holder: Holder?
    private var glass: NSGlassEffectView?
    private var scroll: NSScrollView?
    private var document: FlippedView?
    private var stack: NSStackView?
    private var stackWidth: NSLayoutConstraint?
    private var keys: Any?
    private var menuOpen = false
    private var pillFrame = NSRect.zero
    private var contentHeight: CGFloat = 0
    private var collapsedHeight: CGFloat = 0
    private var expandedSettingsHeight: CGFloat = 0
    private var settingsExpanded = false
    private var showingUpdates = false
    private var wrapper: NSView?
    private var wrapperHeight: NSLayoutConstraint?
    private weak var chevron: NSImageView?
    private var pickers: [(WordPicker, [String])] = []
    private weak var themeWords: NSTextField?

    var isOpen: Bool { holder != nil }
    private var width: CGFloat { min(320, (host?.bounds.width ?? 393) - 32) }
    private var calm: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    private var light: Bool {
        guard let rgb = ground.usingColorSpace(.sRGB) else { return false }
        return 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent > 0.5
    }

    init(host: NSView, webView: WKWebView) {
        self.host = host
        self.webView = webView
        super.init()
    }

    // MARK: from the page

    // { items } as the phone's pill gets them; { open } or { toggle } to show it
    func set(_ args: [String: Any]) {
        if let items = args["items"] as? [[String: Any]] {
            self.items = items
            let key = json(items.map(structure))
            if isOpen {
                if key != modelKey { modelKey = key; render() } else { updateSelections() }
            }
            modelKey = key
        }
        if args["toggle"] as? Bool == true { isOpen ? close() : open() }
        else if args["open"] as? Bool == true { open() }
        else if args["open"] as? Bool == false { close() }
    }

    // { title, empty, unread, items: [{ id, title, message, date, link }] }
    func updates(_ args: [String: Any]) {
        let key = json([args["title"] ?? "", args["empty"] ?? "", args["items"] ?? [], args["unread"] ?? false])
        guard key != updatesKey else { return }
        updatesKey = key
        updatesTitle = args["title"] as? String ?? ""
        updatesEmpty = args["empty"] as? String ?? ""
        updateItems = args["items"] as? [[String: Any]] ?? []
        unread = args["unread"] as? Bool ?? false
        if isOpen { render() }
    }

    // The theme's colours, sent with the pill
    func colors(_ state: [String: Any]) {
        let key = ["text", "muted", "dim", "border", "bg"].map { state[$0] as? String ?? "" }.joined(separator: "|")
        guard key != colorKey else { return }
        colorKey = key
        ink = NSColor(css: state["text"]) ?? ink
        muted = NSColor(css: state["muted"]) ?? muted
        faint = NSColor(css: state["dim"]) ?? faint
        line = NSColor(css: state["border"]) ?? line
        ground = NSColor(css: state["bg"]) ?? ground
        if isOpen { tint(); render() }
    }

    // Where the pill is now (page points times zoom, top down)
    func anchor(_ frame: NSRect) {
        guard frame != pillFrame else { return }
        pillFrame = frame
        let resized = host.map { $0.bounds.width } != lastHostWidth
        guard isOpen else { return }
        if resized { render() } else { place(animated: false) }
    }
    private var lastHostWidth: CGFloat?

    // MARK: open and close

    func open() {
        guard !isOpen, let host, let pill = pill?(), pill.superview === host else { return }
        let shade = Shade()
        shade.frame = host.bounds
        shade.autoresizingMask = [.width, .height]
        shade.wantsLayer = true
        shade.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.12).cgColor
        shade.onPress = { [weak self] in self?.close() }
        host.addSubview(shade, positioned: .below, relativeTo: pill)

        let holder = Holder()
        holder.wantsLayer = true
        let glass = NSGlassEffectView()
        glass.cornerRadius = 28
        glass.autoresizingMask = [.width, .height]
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.autoresizingMask = [.width, .height]
        let document = FlippedView()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.distribution = .fill
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(stack)
        let stackWidth = stack.widthAnchor.constraint(equalToConstant: width - 32)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 16),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 14),
            stackWidth,
        ])
        scroll.documentView = document
        glass.contentView = scroll
        holder.addSubview(glass)
        host.addSubview(holder, positioned: .below, relativeTo: pill)

        self.shade = shade
        self.holder = holder
        self.glass = glass
        self.scroll = scroll
        self.document = document
        self.stack = stack
        self.stackWidth = stackWidth
        tint()
        render()
        onOpen?(true)
        keys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53, self?.isOpen == true, self?.menuOpen == false else { return event }
            self?.close()
            return nil
        }
        // In: a fade, rising the last few points into place
        guard !calm else { return }
        let end = holder.frame
        holder.alphaValue = 0
        holder.frame = end.offsetBy(dx: 0, dy: 8)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            context.allowsImplicitAnimation = true
            holder.animator().alphaValue = 1
            holder.animator().frame = end
        }
    }

    func close() {
        guard let holder else { return }
        let shade = self.shade
        if let keys { NSEvent.removeMonitor(keys) }
        keys = nil
        self.holder = nil
        self.shade = nil
        glass = nil
        scroll = nil
        document = nil
        stack = nil
        stackWidth = nil
        wrapper = nil
        wrapperHeight = nil
        pickers = []
        settingsExpanded = false
        showingUpdates = false
        holder.inert = true
        shade?.inert = true
        onOpen?(false)
        if calm {
            holder.removeFromSuperview()
            shade?.removeFromSuperview()
            return
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.16
            holder.animator().alphaValue = 0
            shade?.animator().alphaValue = 0
        }, completionHandler: {
            holder.removeFromSuperview()
            shade?.removeFromSuperview()
        })
    }

    // MARK: what it says

    private func send(_ item: [String: Any], dismiss: Bool = true) {
        guard let id = item["id"] as? String else { return }
        if dismiss { close() }
        event("shell:pick", id)
    }

    private func event(_ name: String, _ id: String) {
        let detail = json(["id": id])
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)', { detail: \(detail) }))")
    }

    // Choices only tick as they are picked; a new layout is only for new
    // actions or choices
    private func structure(_ item: [String: Any]) -> [String: Any] {
        var result = item
        result.removeValue(forKey: "checked")
        if let kids = item["children"] as? [[String: Any]] { result["children"] = kids.map(structure) }
        return result
    }

    private func updateSelections() {
        func descendants(_ items: [[String: Any]]) -> [[String: Any]] {
            items.flatMap { [$0] + descendants(children($0)) }
        }
        let all = descendants(items)
        let checked = Set(all.filter { $0["checked"] as? Bool == true }.compactMap { $0["id"] as? String })
        for (picker, ids) in pickers {
            picker.select(ids.firstIndex { checked.contains($0) } ?? -1, animated: true)
        }
        if let theme = all.first(where: { id($0) == "set:theme" }) {
            themeWords?.stringValue = children(theme).first { $0["checked"] as? Bool == true }.map(label) ?? ""
        }
    }

    // MARK: laying it out

    private func render(animated: Bool = false) {
        guard let stack, let scroll else { return }
        lastHostWidth = host?.bounds.width
        let offset = scroll.contentView.bounds.origin
        for view in stack.arrangedSubviews {
            stack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        pickers = []
        themeWords = nil
        chevron = nil
        wrapper = nil
        wrapperHeight = nil
        stackWidth?.constant = width - 32
        if showingUpdates { renderUpdates(in: stack) } else { renderMenu(in: stack) }
        place(animated: animated)
        if !animated { scroll.contentView.scroll(to: offset) }
    }

    private func renderMenu(in stack: NSStackView) {
        let flat = items.flatMap { ($0["inline"] as? Bool == true) ? children($0) : [$0] }
        let primary = row()
        if let save = flat.first(where: { id($0) == "save" }) { primary.addArrangedSubview(saveButton(save)) }
        for (key, symbol) in [("export", "square.and.arrow.up"), ("about", "info.circle")] {
            guard let item = flat.first(where: { id($0) == key }) else { continue }
            primary.addArrangedSubview(roundButton(symbol, label: label(item)) { [weak self] button in
                let kids = children(item)
                if kids.isEmpty { self?.send(item) } else { self?.menu(kids, from: button, dismiss: true) }
            })
        }
        if !updatesTitle.isEmpty {
            let tray = roundButton("tray", label: updatesTitle) { [weak self] _ in
                self?.switchUpdates(true)
                self?.event("shell:nav", "updates")
            }
            // Something unread: a red dot on the tray's corner
            if unread {
                let dot = NSView()
                dot.wantsLayer = true
                dot.layer?.backgroundColor = red.cgColor
                dot.layer?.cornerRadius = 4
                dot.translatesAutoresizingMaskIntoConstraints = false
                tray.addSubview(dot)
                NSLayoutConstraint.activate([
                    dot.widthAnchor.constraint(equalToConstant: 8),
                    dot.heightAnchor.constraint(equalToConstant: 8),
                    dot.topAnchor.constraint(equalTo: tray.topAnchor, constant: 7),
                    dot.trailingAnchor.constraint(equalTo: tray.trailingAnchor, constant: -7),
                ])
            }
            primary.addArrangedSubview(tray)
        }
        add(primary, to: stack)

        let actions = flat.filter {
            let key = id($0)
            return key.hasPrefix("act:") || key.hasPrefix("share:")
        }.sorted { id($0) < id($1) }
        // Two to a row; a `wide` action (collab & history) takes a row alone
        var rows: [[[String: Any]]] = []
        for item in actions where item["wide"] as? Bool == true { rows.append([item]) }
        let narrow = actions.filter { $0["wide"] as? Bool != true }
        for start in stride(from: 0, to: narrow.count, by: 2) { rows.append(Array(narrow[start..<min(start + 2, narrow.count)])) }
        // An odd action out leaves a slot: settings becomes the button there
        // instead of a row of its own under a line
        let slot = rows.last.map { $0.count == 1 && $0[0]["wide"] as? Bool != true } ?? false
        for (index, items) in rows.enumerated() {
            let line = row(equal: true)
            for item in items { line.addArrangedSubview(capsule(item)) }
            if slot && index == rows.count - 1 { line.addArrangedSubview(settingsSlot()) }
            add(line, to: stack)
        }
        if !slot {
            divider(in: stack)
            let (disclosure, chevron) = disclosureRow("settings", open: settingsExpanded) { [weak self] in self?.toggleSettings() }
            self.chevron = chevron
            add(disclosure, to: stack)
            stack.setCustomSpacing(0, after: disclosure)
        }

        // The settings stay built inside a clipped box: opening grows the box
        // over them rather than building them again
        let wrapper = NSView()
        wrapper.wantsLayer = true
        wrapper.layer?.masksToBounds = true
        let settings = NSStackView()
        settings.orientation = .vertical
        settings.alignment = .leading
        settings.spacing = 4
        settings.translatesAutoresizingMaskIntoConstraints = false
        wrapper.addSubview(settings)
        NSLayoutConstraint.activate([
            settings.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            settings.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 8),
            settings.widthAnchor.constraint(equalToConstant: width - 32),
        ])
        for key in ["set:editor", "set:counter", "set:lefty"] {
            if let item = flat.first(where: { id($0) == key }) { addPicker(item, to: settings) }
        }
        if let theme = flat.first(where: { id($0) == "set:theme" }) { add(themeRow(theme), to: settings) }
        expandedSettingsHeight = settings.fittingSize.height + 8
        let height = wrapper.heightAnchor.constraint(equalToConstant: 0)
        height.isActive = true
        add(wrapper, to: stack)
        self.wrapper = wrapper
        self.wrapperHeight = height
        collapsedHeight = stack.fittingSize.height + 30
        height.constant = settingsExpanded ? expandedSettingsHeight : 0
        wrapper.alphaValue = settingsExpanded ? 1 : 0
        contentHeight = collapsedHeight + height.constant
    }

    // Titled like the settings row, its chevron pointing up: back to the menu
    private func renderUpdates(in stack: NSStackView) {
        let (head, _) = disclosureRow(updatesTitle, open: true) { [weak self] in self?.switchUpdates(false) }
        add(head, to: stack)
        stack.setCustomSpacing(0, after: head)
        if updateItems.isEmpty {
            let pad = NSView()
            let empty = text(updatesEmpty, 12, faint)
            pad.addSubview(empty)
            NSLayoutConstraint.activate([
                empty.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: 8),
                empty.trailingAnchor.constraint(lessThanOrEqualTo: pad.trailingAnchor),
                empty.topAnchor.constraint(equalTo: pad.topAnchor, constant: 6),
                empty.bottomAnchor.constraint(equalTo: pad.bottomAnchor, constant: -8),
            ])
            add(pad, to: stack)
        }
        for (index, item) in updateItems.enumerated() {
            if index > 0 { divider(in: stack) }
            add(updateRow(item), to: stack)
        }
        contentHeight = stack.fittingSize.height + 30
    }

    // Above the pill, its trailing edge on the pill's, under the window's bar;
    // taller than there is room for, it scrolls
    private func place(animated: Bool) {
        guard let host, let holder, let document else { return }
        let width = self.width
        let bar = host.window.map { $0.frame.height - $0.contentLayoutRect.height } ?? 52
        let bottom = pillFrame.minY - 12
        let height = max(80, min(contentHeight, bottom - bar - 8))
        let x = min(max(16, pillFrame.maxX - width), host.bounds.width - 16 - width)
        let frame = NSRect(x: x, y: bottom - height, width: width, height: height)
        let page = NSRect(x: 0, y: 0, width: width, height: max(contentHeight, height))
        if animated {
            holder.animator().frame = frame
            document.animator().frame = page
        } else {
            holder.frame = frame
            glass?.frame = holder.bounds
            scroll?.frame = glass?.bounds ?? holder.bounds
            document.frame = page
        }
    }

    private func toggleSettings() {
        guard let wrapper, let wrapperHeight else { return }
        settingsExpanded.toggle()
        chevron?.setSymbolImage(symbol(settingsExpanded ? "chevron.up" : "chevron.down", 11, .medium), contentTransition: .replace)
        settingsSlotChevron?.setSymbolImage(symbol(settingsExpanded ? "chevron.up" : "chevron.down", 10, .medium), contentTransition: .replace)
        let open = settingsExpanded ? expandedSettingsHeight : 0
        contentHeight = collapsedHeight + open
        scroll?.contentView.scroll(to: .zero)
        let changes = {
            wrapperHeight.constant = open
            wrapper.alphaValue = self.settingsExpanded ? 1 : 0
            self.place(animated: !self.calm)
            self.document?.layoutSubtreeIfNeeded()
        }
        if calm { changes(); return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.28
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            context.allowsImplicitAnimation = true
            changes()
        }
    }
    private weak var settingsSlotChevron: NSImageView?

    // The panel's contents swap between the writing menu and the updates;
    // its height follows, the way settings open and close
    private func switchUpdates(_ on: Bool) {
        guard let stack else { return }
        showingUpdates = on
        if calm { render(); scroll?.contentView.scroll(to: .zero); return }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.12
            stack.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, self.stack === stack else { return }
            self.scroll?.contentView.scroll(to: .zero)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.28
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                context.allowsImplicitAnimation = true
                self.render(animated: true)
                stack.animator().alphaValue = 1
            }
        })
    }

    private func tint() {
        guard let glass, let holder else { return }
        let t = GlassTuning.current
        holder.appearance = GlassLayer.appearance(for: ground)
        glass.style = t.clear ? .clear : .regular
        glass.tintColor = t.tintColor(ground: ground)
    }

    // MARK: the pieces

    // Save: lit in the theme's ink, brighter under the pointer
    private func saveButton(_ item: [String: Any]) -> NSView {
        let enabled = item["disabled"] as? Bool != true
        let tap = Tap()
        tap.fill = ink
        tap.hover = ink.blended(withFraction: 0.2, of: light ? .black : .white) ?? ink
        tap.press = ink.blended(withFraction: 0.35, of: light ? .black : .white) ?? ink
        tap.enabled = enabled
        tap.alphaValue = enabled ? 1 : 0.5
        tap.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let words = NSTextField(labelWithString: label(item))
        words.font = .justtype(14, medium: true)
        words.textColor = ground
        center([words], in: tap)
        tap.setAccessibilityLabel(label(item))
        tap.run = { [weak self] in self?.send(item) }
        tap.setContentHuggingPriority(.init(1), for: .horizontal)
        return tap
    }

    // A glass round with a symbol: export, about, the updates tray
    private func roundButton(_ name: String, label: String, run: @escaping (NSView) -> Void) -> GlassPress {
        let button = glassButton()
        button.image = symbol(name, 15)
        button.imagePosition = .imageOnly
        button.contentTintColor = ink
        button.setAccessibilityLabel(label)
        let over = ink.withAlphaComponent(0.2)
        button.onHover = { [weak button] on in
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                context.allowsImplicitAnimation = true
                button?.bezelColor = on ? over : nil
            }
        }
        button.run = run
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        return button
    }

    private func glassButton() -> GlassPress {
        let button = GlassPress()
        button.bezelStyle = .glass
        button.borderShape = .capsule
        button.controlSize = .extraLarge
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        return button
    }

    // One of the slate's actions: a filled capsule; while on (share with a
    // link out), outlined and worded in the page's blue
    private func capsule(_ item: [String: Any]) -> NSView {
        let on = item["on"] as? Bool == true
        let enabled = item["disabled"] as? Bool != true
        let tap = filled()
        tap.enabled = enabled
        if on { tap.stroke = blue }
        let words = text(label(item), 14, on ? blue : enabled ? ink : ink.withAlphaComponent(0.35))
        center([words], in: tap)
        tap.setAccessibilityLabel(label(item))
        tap.run = { [weak self] in self?.send(item) }
        return tap
    }

    // Settings as one of the actions, its chevron saying open or not
    private func settingsSlot() -> NSView {
        let tap = filled()
        let words = text("settings", 14, ink)
        let chevron = NSImageView(image: symbol(settingsExpanded ? "chevron.up" : "chevron.down", 10, .medium))
        chevron.contentTintColor = ink
        settingsSlotChevron = chevron
        center([words, chevron], in: tap)
        tap.setAccessibilityLabel("settings")
        tap.run = { [weak self] in self?.toggleSettings() }
        return tap
    }

    private func filled() -> Tap {
        let tap = Tap()
        tap.fill = ink.withAlphaComponent(0.1)
        tap.hover = ink.withAlphaComponent(0.16)
        tap.press = ink.withAlphaComponent(0.22)
        tap.heightAnchor.constraint(equalToConstant: 44).isActive = true
        return tap
    }

    // A word on the left, a chevron on the right: down to open, up when open
    private func disclosureRow(_ title: String, open: Bool, run: @escaping () -> Void) -> (Tap, NSImageView) {
        let tap = Tap()
        tap.radius = 12
        tap.hover = ink.withAlphaComponent(0.07)
        tap.press = ink.withAlphaComponent(0.12)
        tap.run = run
        let words = text(title, 13, ink)
        let chevron = NSImageView(image: symbol(open ? "chevron.up" : "chevron.down", 11, .medium))
        chevron.contentTintColor = muted
        chevron.translatesAutoresizingMaskIntoConstraints = false
        tap.addSubview(words)
        tap.addSubview(chevron)
        NSLayoutConstraint.activate([
            tap.heightAnchor.constraint(equalToConstant: 44),
            words.leadingAnchor.constraint(equalTo: tap.leadingAnchor, constant: 8),
            words.centerYAnchor.constraint(equalTo: tap.centerYAnchor),
            words.trailingAnchor.constraint(lessThanOrEqualTo: chevron.leadingAnchor, constant: -8),
            chevron.trailingAnchor.constraint(equalTo: tap.trailingAnchor, constant: -10),
            chevron.centerYAnchor.constraint(equalTo: tap.centerYAnchor),
        ])
        tap.setAccessibilityLabel(title)
        return (tap, chevron)
    }

    // A setting: its name, then its choices as words, three to a row
    private func addPicker(_ item: [String: Any], to settings: NSStackView) {
        let kids = children(item)
        let group = NSStackView()
        group.orientation = .vertical
        group.alignment = .leading
        group.spacing = 6
        for start in stride(from: 0, to: kids.count, by: 3) {
            let choices = Array(kids[start..<min(start + 3, kids.count)])
            let line = row()
            line.spacing = 10
            let name = text(start == 0 ? label(item) : "", 12, muted)
            name.widthAnchor.constraint(equalToConstant: 58).isActive = true
            line.addArrangedSubview(name)
            let picker = WordPicker(titles: choices.map(label), ink: ink, muted: muted)
            picker.select(choices.firstIndex { $0["checked"] as? Bool == true } ?? -1, animated: false)
            picker.setAccessibilityLabel(label(item))
            picker.onSelect = { [weak self] index in
                guard choices.indices.contains(index) else { return }
                self?.send(choices[index], dismiss: false)
            }
            picker.setContentHuggingPriority(.init(1), for: .horizontal)
            pickers.append((picker, choices.map(id)))
            line.addArrangedSubview(picker)
            line.heightAnchor.constraint(equalToConstant: 40).isActive = true
            add(line, to: group)
        }
        add(group, to: settings)
    }

    // The theme: its name and a chevron, opening the themes as a menu
    private func themeRow(_ theme: [String: Any]) -> NSView {
        let line = row()
        line.spacing = 10
        let name = text("theme", 12, muted)
        name.widthAnchor.constraint(equalToConstant: 58).isActive = true
        line.addArrangedSubview(name)
        let space = NSView()
        space.setContentHuggingPriority(.init(1), for: .horizontal)
        line.addArrangedSubview(space)
        let tap = Tap()
        tap.hover = ink.withAlphaComponent(0.1)
        tap.press = ink.withAlphaComponent(0.16)
        let chosen = children(theme).first { $0["checked"] as? Bool == true }.map(label) ?? ""
        let words = text(chosen, 12, ink)
        themeWords = words
        let chevron = NSImageView(image: symbol("chevron.down", 10, .medium))
        chevron.contentTintColor = ink
        let inside = NSStackView(views: [words, chevron])
        inside.orientation = .horizontal
        inside.spacing = 8
        inside.translatesAutoresizingMaskIntoConstraints = false
        tap.addSubview(inside)
        NSLayoutConstraint.activate([
            tap.heightAnchor.constraint(equalToConstant: 32),
            inside.leadingAnchor.constraint(equalTo: tap.leadingAnchor, constant: 10),
            inside.trailingAnchor.constraint(equalTo: tap.trailingAnchor, constant: -10),
            inside.centerYAnchor.constraint(equalTo: tap.centerYAnchor),
        ])
        tap.setAccessibilityLabel("theme: " + chosen)
        tap.run = { [weak self, weak tap] in
            guard let self, let tap else { return }
            let now = self.items.flatMap { ($0["inline"] as? Bool == true) ? children($0) : [$0] }.first { id($0) == "set:theme" } ?? theme
            self.menu(children(now), from: tap, dismiss: false)
        }
        line.addArrangedSubview(tap)
        line.heightAnchor.constraint(equalToConstant: 40).isActive = true
        return line
    }

    // An update: its title, its message, and the date (with the header's
    // arrow when it goes somewhere)
    private func updateRow(_ item: [String: Any]) -> NSView {
        let key = item["id"].map { "\($0)" } ?? ""
        let link = !((item["link"] as? String) ?? "").isEmpty
        let tap = Tap()
        tap.radius = 12
        if link {
            tap.hover = ink.withAlphaComponent(0.07)
            tap.press = ink.withAlphaComponent(0.12)
            tap.run = { [weak self] in
                self?.close()
                self?.event("shell:nav", "update:\(key)")
            }
        }
        let words = NSStackView()
        words.orientation = .vertical
        words.alignment = .leading
        words.spacing = 4
        words.translatesAutoresizingMaskIntoConstraints = false
        let parts: [(String, CGFloat, NSColor)] = [
            (item["title"] as? String ?? "", 13, ink),
            (item["message"] as? String ?? "", 12, muted),
            ((item["date"] as? String ?? "") + (link ? "  →" : ""), 11, faint),
        ]
        for (words_, size, color) in parts where !words_.isEmpty {
            let field = NSTextField(wrappingLabelWithString: words_)
            field.font = .justtype(size)
            field.textColor = color
            field.preferredMaxLayoutWidth = width - 32 - 16
            words.addArrangedSubview(field)
        }
        tap.addSubview(words)
        NSLayoutConstraint.activate([
            words.leadingAnchor.constraint(equalTo: tap.leadingAnchor, constant: 8),
            words.trailingAnchor.constraint(equalTo: tap.trailingAnchor, constant: -8),
            words.topAnchor.constraint(equalTo: tap.topAnchor, constant: 10),
            words.bottomAnchor.constraint(equalTo: tap.bottomAnchor, constant: -10),
        ])
        tap.setAccessibilityLabel(parts.map(\.0).filter { !$0.isEmpty }.joined(separator: ", "))
        return tap
    }

    // Choices as the Mac's own menu, in the page's type: export's formats, the themes
    private func menu(_ kids: [[String: Any]], from view: NSView, dismiss: Bool) {
        let menu = NSMenu()
        menu.font = .justtype(13)
        menu.autoenablesItems = false
        for kid in kids {
            let item = PickItem(label(kid)) { [weak self] in self?.send(kid, dismiss: dismiss) }
            item.state = kid["checked"] as? Bool == true ? .on : .off
            item.isEnabled = kid["disabled"] as? Bool != true
            menu.addItem(item)
        }
        // Escape closes the menu, not the panel under it
        menuOpen = true
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.isFlipped ? view.bounds.height + 4 : -4), in: view)
        menuOpen = false
    }

    private func divider(in stack: NSStackView) {
        let rule = NSView()
        rule.wantsLayer = true
        rule.layer?.backgroundColor = line.cgColor
        rule.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
        add(rule, to: stack)
    }

    private func row(equal: Bool = false) -> NSStackView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 8
        row.distribution = equal ? .fillEqually : .fill
        return row
    }

    // Full width, as every row of the panel is
    private func add(_ view: NSView, to stack: NSStackView) {
        stack.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    }

    private func center(_ views: [NSView], in tap: Tap) {
        let inside = NSStackView(views: views)
        inside.orientation = .horizontal
        inside.spacing = 8
        inside.translatesAutoresizingMaskIntoConstraints = false
        tap.addSubview(inside)
        NSLayoutConstraint.activate([
            inside.centerXAnchor.constraint(equalTo: tap.centerXAnchor),
            inside.centerYAnchor.constraint(equalTo: tap.centerYAnchor),
            inside.leadingAnchor.constraint(greaterThanOrEqualTo: tap.leadingAnchor, constant: 10),
        ])
    }

    private func text(_ words: String, _ size: CGFloat, _ color: NSColor) -> NSTextField {
        let field = NSTextField(labelWithString: words)
        field.font = .justtype(size)
        field.textColor = color
        field.lineBreakMode = .byTruncatingTail
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }

    private func json(_ value: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
}

private func children(_ item: [String: Any]) -> [[String: Any]] { item["children"] as? [[String: Any]] ?? [] }
private func id(_ item: [String: Any]) -> String { item["id"] as? String ?? "" }
private func label(_ item: [String: Any]) -> String { item["label"] as? String ?? "" }
private func symbol(_ name: String, _ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSImage {
    NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(.init(pointSize: size, weight: weight)) ?? NSImage()
}

// A setting's choices as words, the chosen one with a line under it that
// slides to the next one chosen (the phone's ShellTextSelector)
@available(macOS 26.0, *)
private final class WordPicker: NSView {
    var onSelect: ((Int) -> Void)?
    private let words = NSStackView()
    private let underline = NSView()
    private var taps: [Tap] = []
    private var fields: [NSTextField] = []
    private let titles: [String]
    private var selected = -1
    private var sliding = false
    private let ink: NSColor
    private let muted: NSColor
    private static let font = NSFont.justtype(12)

    override var isFlipped: Bool { true }

    init(titles: [String], ink: NSColor, muted: NSColor) {
        self.titles = titles
        self.ink = ink
        self.muted = muted
        super.init(frame: .zero)
        words.orientation = .horizontal
        words.spacing = 4
        words.translatesAutoresizingMaskIntoConstraints = false
        addSubview(words)
        underline.wantsLayer = true
        underline.layer?.backgroundColor = ink.cgColor
        underline.isHidden = true
        addSubview(underline)
        NSLayoutConstraint.activate([
            words.trailingAnchor.constraint(equalTo: trailingAnchor),
            words.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor),
            words.topAnchor.constraint(equalTo: topAnchor),
            words.bottomAnchor.constraint(equalTo: bottomAnchor),
            heightAnchor.constraint(equalToConstant: 40),
        ])
        for (index, title) in titles.enumerated() {
            let tap = Tap()
            tap.radius = 8
            let field = NSTextField(labelWithString: title)
            field.font = Self.font
            field.textColor = muted
            field.translatesAutoresizingMaskIntoConstraints = false
            tap.addSubview(field)
            let width = max(44, ceil((title as NSString).size(withAttributes: [.font: Self.font]).width) + 8)
            NSLayoutConstraint.activate([
                tap.widthAnchor.constraint(equalToConstant: width),
                tap.heightAnchor.constraint(equalToConstant: 40),
                field.centerXAnchor.constraint(equalTo: tap.centerXAnchor),
                field.centerYAnchor.constraint(equalTo: tap.centerYAnchor),
            ])
            tap.onHover = { [weak self, weak field] on in
                guard let self, self.selected != index else { return }
                field?.textColor = on ? ink.withAlphaComponent(0.85) : muted
            }
            tap.run = { [weak self] in
                guard let self, self.selected != index else { return }
                self.select(index, animated: true)
                self.onSelect?(index)
            }
            tap.setAccessibilityLabel(title)
            words.addArrangedSubview(tap)
            taps.append(tap)
            fields.append(field)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    func select(_ index: Int, animated: Bool) {
        guard index != selected else { return }
        layoutSubtreeIfNeeded()
        let from = selected
        selected = index
        for (i, field) in fields.enumerated() { field.textColor = i == index ? ink : muted }
        underline.isHidden = !taps.indices.contains(index)
        let target = lineFrame()
        guard animated, from >= 0, window != nil, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
            underline.frame = target
            return
        }
        sliding = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.25
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            underline.animator().frame = target
        }, completionHandler: { [weak self] in self?.sliding = false })
    }

    override func layout() {
        super.layout()
        if !sliding { underline.frame = lineFrame() }
    }

    // Under the chosen word's own width, just below its letters
    private func lineFrame() -> NSRect {
        guard taps.indices.contains(selected) else { return .zero }
        let rect = taps[selected].convert(taps[selected].bounds, to: self)
        let width = ceil((titles[selected] as NSString).size(withAttributes: [.font: Self.font]).width)
        let height = ceil(Self.font.ascender - Self.font.descender)
        return NSRect(x: rect.midX - width / 2, y: rect.midY + height / 2 + 2, width: width, height: 1)
    }
}

// A press that runs something, lit a little under the pointer: the panel's
// capsules, its rows, its words
private final class Tap: NSView {
    var run: (() -> Void)?
    var onHover: ((Bool) -> Void)?
    var fill = NSColor.clear { didSet { paint(animated: false) } }
    var hover = NSColor.clear
    var press = NSColor.clear
    var stroke: NSColor? { didSet { layer?.borderColor = stroke?.cgColor; layer?.borderWidth = stroke == nil ? 0 : 1.5 } }
    // A capsule unless it says otherwise
    var radius: CGFloat?
    var enabled = true
    private var over = false
    private var down = false
    private var area: NSTrackingArea?

    override var isFlipped: Bool { true }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerCurve = .continuous
        setAccessibilityRole(.button)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        layer?.cornerRadius = radius ?? bounds.height / 2
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let made = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(made)
        area = made
    }

    override func hitTest(_ point: NSPoint) -> NSView? { super.hitTest(point) == nil ? nil : self }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseEntered(with event: NSEvent) {
        guard enabled else { return }
        over = true
        paint(animated: true)
        onHover?(true)
    }

    override func mouseExited(with event: NSEvent) {
        over = false
        paint(animated: true)
        onHover?(false)
    }

    override func mouseDown(with event: NSEvent) {
        guard enabled else { return }
        down = true
        paint(animated: false)
    }

    override func mouseUp(with event: NSEvent) {
        guard down else { return }
        down = false
        paint(animated: true)
        if bounds.contains(convert(event.locationInWindow, from: nil)) { run?() }
    }

    override func accessibilityPerformPress() -> Bool {
        guard enabled else { return false }
        run?()
        return true
    }

    private func paint(animated: Bool) {
        let color = down ? press : over ? hover : fill
        NSAnimationContext.runAnimationGroup { context in
            context.duration = animated ? 0.15 : 0
            context.allowsImplicitAnimation = animated
            layer?.backgroundColor = color.cgColor
        }
    }
}

// The system's glass button, running something, saying when the pointer is over it
private final class GlassPress: NSButton {
    var run: ((NSView) -> Void)?
    var onHover: ((Bool) -> Void)?
    private var area: NSTrackingArea?

    init() {
        super.init(frame: .zero)
        title = ""
        target = self
        action = #selector(fire)
        focusRingType = .none
        refusesFirstResponder = true
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func fire() { run?(self) }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

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

// A menu row that runs something
private final class PickItem: NSMenuItem {
    private let pick: () -> Void

    init(_ title: String, pick: @escaping () -> Void) {
        self.pick = pick
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }

    required init(coder: NSCoder) { fatalError() }

    @objc private func fire() { pick() }
}

// Over the page, under the panel: a little darker, and a click on it closes
// the panel (the page does not scroll under it)
private final class Shade: NSView {
    var onPress: (() -> Void)?
    var inert = false
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { inert ? nil : super.hitTest(point) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onPress?() }
    override func scrollWheel(with event: NSEvent) {}
}

// The panel's glass, and nothing to press once it is on its way out
private final class Holder: NSView {
    var inert = false
    override func hitTest(_ point: NSPoint) -> NSView? { inert ? nil : super.hitTest(point) }
}
