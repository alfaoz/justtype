import UIKit

// UIKit tracks keyboard presentation, rotation and dismissal even when the
// web editor focused before the dock was created.
final class ShellDock {
    private let bottom: NSLayoutConstraint

    init(_ view: UIView, in parent: UIView) {
        bottom = view.bottomAnchor.constraint(equalTo: parent.keyboardLayoutGuide.topAnchor, constant: -8)
        bottom.isActive = true
    }
}

// Match the web UI with the bundled IBM Plex Mono fonts.
func shellFont(_ size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
    UIFont(name: weight == .regular ? "IBMPlexMono-Regular" : "IBMPlexMono-Medium", size: size) ?? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
}

// Buttons whose old words are still fading out; their new ones wait
private var shellFading: Set<ObjectIdentifier> = []

// Preserve the control (and its glass) while the words move. Layout animates
// separately so the capsule expands/contracts with the incoming text.
func shellSetTitle(_ button: UIButton, configuration: UIButton.Configuration, in parent: UIView?, animated: Bool, direction: CATransitionSubtype = .fromTop, fadeOnly: Bool = false, layoutChanges: (() -> Void)? = nil) {
    // Mid-morph, the newest words wait for the glass instead of jumping it
    if let pending = shellMorphs[ObjectIdentifier(button)] {
        pending.configuration = configuration
        pending.layoutChanges = layoutChanges
        pending.apply = nil
        pending.show()
        return
    }
    parent?.layoutIfNeeded()
    if fadeOnly {
        // Keep the outgoing rendering in parent coordinates. A shorter title
        // can resize the live button without dragging the fading words with it.
        // Held by the button's own container, so it travels with a capsule
        // that moves meanwhile instead of lingering where it was.
        let holder = button.superview ?? parent
        let snapshot = animated && !UIAccessibility.isReduceMotionEnabled ? button.snapshotView(afterScreenUpdates: false) : nil
        if let snapshot, let holder {
            snapshot.frame = button.frame
            snapshot.isUserInteractionEnabled = false
            snapshot.accessibilityElementsHidden = true
            holder.addSubview(snapshot)
        }
        let update = {
            layoutChanges?()
            UIView.performWithoutAnimation {
                button.configuration = configuration
                parent?.layoutIfNeeded()
            }
        }
        update()
        if let snapshot, holder != nil {
            // Out, then in: two words cross-fading in one place read as neither
            button.alpha = 0
            shellFading.insert(ObjectIdentifier(button))
            UIView.animate(withDuration: 0.1, delay: 0, options: [.allowUserInteraction], animations: {
                snapshot.alpha = 0
            }, completion: { _ in
                snapshot.removeFromSuperview()
                shellFading.remove(ObjectIdentifier(button))
                UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction], animations: {
                    button.alpha = 1
                })
            })
        } else if !shellFading.contains(ObjectIdentifier(button)) && button.layer.animation(forKey: "opacity") == nil {
            // A repeat of the same words must not cut a fade-in short
            button.alpha = 1
        }
        return
    }
    if animated && !UIAccessibility.isReduceMotionEnabled, let label = button.titleLabel {
        let transition = CATransition()
        transition.type = .push
        transition.subtype = direction
        transition.duration = 0.2
        transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        label.layer.add(transition, forKey: "shell.title")
    }
    button.configuration = configuration
    if animated && !UIAccessibility.isReduceMotionEnabled {
        UIView.animate(withDuration: 0.24, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) { parent?.layoutIfNeeded() }
    } else { parent?.layoutIfNeeded() }
}

private final class ShellMorph {
    var configuration: UIButton.Configuration
    var layoutChanges: (() -> Void)?
    // How the landed configuration goes onto the button (plain assignment
    // when nil); the pill uses it to hand its words to their own layer
    var apply: ((UIButton.Configuration) -> Void)?
    let incoming: UIButton
    init(_ configuration: UIButton.Configuration, _ layoutChanges: (() -> Void)?, _ incoming: UIButton) {
        self.configuration = configuration
        self.layoutChanges = layoutChanges
        self.incoming = incoming
    }
    // A newer update mid-morph: the stand-in takes it at once, in place
    func show() {
        let next = shellContents(configuration).configuration
        guard next?.attributedTitle != incoming.configuration?.attributedTitle || next?.image != incoming.configuration?.image else { return }
        UIView.performWithoutAnimation {
            incoming.configuration = next
            incoming.layoutIfNeeded()
        }
    }
}
private var shellMorphs: [ObjectIdentifier: ShellMorph] = [:]

func shellMorphing(_ button: UIButton) -> Bool { shellMorphs[ObjectIdentifier(button)] != nil }

// What the button is showing, or about to show once a morph lands. Mid-morph
// the button itself holds a blank stand-in configuration; never build on that.
func shellConfiguration(_ button: UIButton) -> UIButton.Configuration? {
    shellMorphs[ObjectIdentifier(button)]?.configuration ?? button.configuration
}

// Change what the button shows, landing after a morph if one is under way
func shellEditConfiguration(_ button: UIButton, _ edit: (inout UIButton.Configuration) -> Void) {
    if let pending = shellMorphs[ObjectIdentifier(button)] {
        edit(&pending.configuration)
        pending.show()
    } else if var cfg = button.configuration {
        edit(&cfg)
        button.configuration = cfg
    }
}

// The contents of a configuration, drawn by a plain button with no glass:
// same insets, image placement and font, so it sits where the real one would.
private func shellContents(_ configuration: UIButton.Configuration) -> UIButton {
    var cfg = UIButton.Configuration.plain()
    cfg.attributedTitle = configuration.attributedTitle
    cfg.image = configuration.image
    cfg.imagePlacement = configuration.imagePlacement
    cfg.imagePadding = configuration.imagePadding
    cfg.contentInsets = configuration.contentInsets
    cfg.baseForegroundColor = configuration.baseForegroundColor
    cfg.preferredSymbolConfigurationForImage = configuration.preferredSymbolConfigurationForImage
    cfg.titleLineBreakMode = .byClipping
    let b = UIButton(configuration: cfg)
    b.translatesAutoresizingMaskIntoConstraints = false
    b.isUserInteractionEnabled = false
    b.accessibilityElementsHidden = true
    return b
}

// The same configuration with nothing visible in it: it still measures the
// words, so the glass takes the size it will have.
private func shellInvisible(_ configuration: UIButton.Configuration) -> UIButton.Configuration {
    var cfg = configuration
    if var title = cfg.attributedTitle {
        title.foregroundColor = UIColor.clear
        cfg.attributedTitle = title
    }
    // Glass re-tints any symbol it is given, so the image becomes a blank
    // one of the symbol's drawn size
    if let image = cfg.image {
        let drawn = cfg.preferredSymbolConfigurationForImage.flatMap { image.applyingSymbolConfiguration($0) } ?? image
        cfg.image = UIGraphicsImageRenderer(size: drawn.size).image { _ in }
        cfg.preferredSymbolConfigurationForImage = nil
    }
    return cfg
}

// A button becoming something else (a page's word and the writing menu hand
// the pill over). The button's own title and image are hidden meanwhile; two
// stand-ins, centred and clipped to the glass, cross-fade while the glass
// reshapes on a spring. Nothing inside UIButton is touched, so a later
// update can never leave it half faded.
func shellMorph(_ button: UIButton, configuration: UIButton.Configuration, in parent: UIView?, layoutChanges: (() -> Void)? = nil, apply: ((UIButton.Configuration) -> Void)? = nil) {
    let key = ObjectIdentifier(button)
    if let pending = shellMorphs[key] {
        pending.configuration = configuration
        pending.layoutChanges = layoutChanges
        pending.apply = apply
        pending.show()
        return
    }
    guard !UIAccessibility.isReduceMotionEnabled, button.window != nil, !button.isHidden, let old = button.configuration else {
        layoutChanges?()
        if let apply { apply(configuration) } else { button.configuration = configuration }
        parent?.layoutIfNeeded()
        return
    }
    parent?.layoutIfNeeded()
    let clip = UIView()
    clip.translatesAutoresizingMaskIntoConstraints = false
    clip.isUserInteractionEnabled = false
    clip.clipsToBounds = true
    clip.layer.cornerCurve = .continuous
    clip.layer.cornerRadius = button.bounds.height / 2
    button.addSubview(clip)
    let outgoing = shellContents(old)
    let incoming = shellContents(configuration)
    incoming.alpha = 0
    clip.addSubview(outgoing)
    clip.addSubview(incoming)
    NSLayoutConstraint.activate([
        clip.leadingAnchor.constraint(equalTo: button.leadingAnchor),
        clip.trailingAnchor.constraint(equalTo: button.trailingAnchor),
        clip.topAnchor.constraint(equalTo: button.topAnchor),
        clip.bottomAnchor.constraint(equalTo: button.bottomAnchor),
        outgoing.centerXAnchor.constraint(equalTo: clip.centerXAnchor),
        outgoing.centerYAnchor.constraint(equalTo: clip.centerYAnchor),
        incoming.centerXAnchor.constraint(equalTo: clip.centerXAnchor),
        incoming.centerYAnchor.constraint(equalTo: clip.centerYAnchor)
    ])
    let pending = ShellMorph(configuration, layoutChanges, incoming)
    pending.apply = apply
    shellMorphs[key] = pending
    UIView.performWithoutAnimation {
        button.configuration = shellInvisible(old)
        button.layoutIfNeeded()
    }
    layoutChanges?()
    UIView.performWithoutAnimation { button.configuration = shellInvisible(configuration) }
    // One after the other: two words in one place read as neither
    UIView.animate(withDuration: 0.1, delay: 0, options: [.allowUserInteraction], animations: { outgoing.alpha = 0 })
    UIView.animate(withDuration: 0.2, delay: 0.12, options: [.allowUserInteraction], animations: { incoming.alpha = 1 })
    UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0,
                   options: [.beginFromCurrentState, .allowUserInteraction], animations: { parent?.layoutIfNeeded() },
                   completion: { _ in
        shellMorphs[key] = nil
        pending.layoutChanges?()
        UIView.performWithoutAnimation {
            if let apply = pending.apply { apply(pending.configuration) } else { button.configuration = pending.configuration }
            clip.removeFromSuperview()
            parent?.layoutIfNeeded()
        }
    })
}

// Haptics, one voice for the whole shell. The page turns them on or off
// (the account's haptics setting, ShellBar.haptics) and asks for one by kind
// (ShellBar.haptic); the native controls use the same kinds.
var shellHapticsOn = true
func shellHaptic(_ kind: String) {
    guard shellHapticsOn else { return }
    switch kind {
    case "selection": UISelectionFeedbackGenerator().selectionChanged()
    case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
    case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
    case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
    case "soft": UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    case "rigid": UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.7)
    default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}
