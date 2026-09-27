import UIKit
import Capacitor

class ShellViewController: CAPBridgeViewController {
    private var dock: ShellDock?
    private var chrome: UIStackView?
    private var chromeObscured = false
    private var navigationContainer: UIView?
    private weak var navigation: UIView?
    private var navigationWidth: NSLayoutConstraint?
    private var collapsedNavigationWidth: NSLayoutConstraint?
    private var statusMessageWidth: CGFloat = 0
    private let navigationMask = CAGradientLayer()
    private var visibleNavigationWidth: CGFloat?
    private var maskDisplayLink: CADisplayLink?
    private var maskTransition = 0
    private var fadingNavigationEdge = false
    private(set) var isLeftHanded = false
    private var dockSpacer: UIView?
    private weak var statusPill: UIView?
    // A pill beside the capsule, on its inner side (a new slate's `save`)
    private weak var companion: UIView?
    private var navigationLeading: NSLayoutConstraint?
    private var navigationTrailing: NSLayoutConstraint?
    var closeWriterMenu: (() -> Void)?
    var handednessChanged: (() -> Void)?

    // One layout owns both capsules, so their spacing survives rotation,
    // longer counts and navigation labels. Safe-area edges avoid the notch.
    // Laid over the page but under the dock (the slate flying off on a quick new)
    func insertBelowChrome(_ child: UIView) {
        if let chrome { view.insertSubview(child, belowSubview: chrome) } else { view.addSubview(child) }
    }

    func mountChrome(_ child: UIView, leading: Bool) {
        let row: UIStackView
        if let chrome { row = chrome } else {
            row = UIStackView()
            row.translatesAutoresizingMaskIntoConstraints = false
            row.axis = .horizontal
            row.alignment = .center
            row.spacing = 6
            let space = UIView()
            dockSpacer = space
            space.setContentHuggingPriority(.defaultLow, for: .horizontal)
            row.addArrangedSubview(space)
            view.addSubview(row)
            NSLayoutConstraint.activate([
                row.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
                row.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
                row.heightAnchor.constraint(equalToConstant: 44)
            ])
            dock = ShellDock(row, in: view)
            chrome = row
            row.isHidden = chromeObscured
        }
        if leading {
            // Keep the words stationary while their right edge is softly cut.
            let container = UIView()
            container.translatesAutoresizingMaskIntoConstraints = false
            container.clipsToBounds = true
            container.layer.cornerRadius = 20
            container.layer.cornerCurve = .continuous
            container.addSubview(child)
            let width = container.widthAnchor.constraint(equalTo: child.widthAnchor)
            navigationLeading = child.leadingAnchor.constraint(equalTo: container.leadingAnchor)
            navigationTrailing = child.trailingAnchor.constraint(equalTo: container.trailingAnchor)
            NSLayoutConstraint.activate([
                width,
                container.heightAnchor.constraint(equalTo: child.heightAnchor),
                isLeftHanded ? navigationTrailing! : navigationLeading!,
                child.centerYAnchor.constraint(equalTo: container.centerYAnchor)
            ])
            navigation = child
            navigationMask.type = .radial
            navigationMask.colors = [UIColor.clear.cgColor, UIColor.clear.cgColor, UIColor.white.cgColor, UIColor.white.cgColor]
            navigationContainer = container
            navigationWidth = width
            collapsedNavigationWidth = container.widthAnchor.constraint(equalToConstant: 0)
            row.insertArrangedSubview(container, at: 0)
        }
        else { statusPill = child; row.addArrangedSubview(child) }
        arrangeChrome()
    }

    func mountCompanion(_ view: UIView) {
        companion = view
        chrome?.addArrangedSubview(view)
        arrangeChrome()
    }

    func setLeftHanded(_ enabled: Bool) {
        guard isLeftHanded != enabled else { return }
        closeWriterMenu?()
        isLeftHanded = enabled
        navigationLeading?.isActive = !enabled
        navigationTrailing?.isActive = enabled
        arrangeChrome()
        visibleNavigationWidth = nil
        updateStatusSpace()
        handednessChanged?()
        view.layoutIfNeeded()
    }

    private func arrangeChrome() {
        guard let chrome, let dockSpacer else { return }
        let ordered = isLeftHanded ? [statusPill, dockSpacer, companion, navigationContainer] : [navigationContainer, companion, dockSpacer, statusPill]
        chrome.arrangedSubviews.forEach { chrome.removeArrangedSubview($0) }
        ordered.compactMap { $0 }.forEach { chrome.addArrangedSubview($0) }
    }

    // A long status in the pill is squeezing the words beside it
    var statusCoversNavigation: Bool {
        guard let navigation, let visible = visibleNavigationWidth else { return false }
        return visible < navigation.bounds.width - 0.5
    }

    func setStatusMessageWidth(_ width: CGFloat) {
        statusMessageWidth = width
        updateStatusSpace()
    }

    private func updateStatusSpace() {
        guard let container = navigationContainer, let navigation else { return }
        let fullWidth = navigation.bounds.width
        guard fullWidth > 0 else { return }
        let beside = companion.map { $0.isHidden ? 0 : $0.bounds.width + 6 } ?? 0
        let available = max(0, view.safeAreaLayoutGuide.layoutFrame.width - 32 - statusMessageWidth - 12 - beside)
        let visibleWidth = statusMessageWidth > 0 ? min(fullWidth, available) : fullWidth
        guard visibleNavigationWidth == nil || abs(visibleNavigationWidth! - visibleWidth) > 0.5 else {
            if maskDisplayLink == nil { syncNavigationMask() }
            return
        }
        visibleNavigationWidth = visibleWidth
        let clipped = visibleWidth < fullWidth - 0.5
        container.isUserInteractionEnabled = !clipped
        container.accessibilityElementsHidden = clipped
        navigationWidth?.isActive = !clipped
        collapsedNavigationWidth?.constant = visibleWidth
        collapsedNavigationWidth?.isActive = clipped
        fadingNavigationEdge = clipped || container.layer.mask != nil
        maskTransition += 1
        let transition = maskTransition
        maskDisplayLink?.invalidate()
        maskDisplayLink = nil
        syncNavigationMask()
        let changes = { self.view.layoutIfNeeded() }
        let finish = {
            guard self.maskTransition == transition else { return }
            self.maskDisplayLink?.invalidate()
            self.maskDisplayLink = nil
            self.fadingNavigationEdge = clipped
            // Fully restoring navigation must remove the mask, not leave a
            // previous narrow mask attached after its layout has expanded.
            self.syncNavigationMask(usePresentation: false)
        }
        if UIAccessibility.isReduceMotionEnabled {
            changes()
            finish()
        } else {
            let link = CADisplayLink(target: self, selector: #selector(updateNavigationMaskFrame))
            link.add(to: .main, forMode: .common)
            maskDisplayLink = link
            UIView.animate(withDuration: 0.25, delay: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut],
                           animations: changes, completion: { _ in finish() })
        }
    }

    @objc private func updateNavigationMaskFrame() { syncNavigationMask() }

    // A clipped capsule cups the pill: it runs on past its cut, under where
    // the pill's round end begins, and a circle around that end (a few points
    // wider than it) takes the bite, so the pill sits in the capsule with one
    // even gap all round. The words fade into the cup. The capsule stops at
    // the round end's centre; clipping to its own bounds is off meanwhile, the
    // mask alone decides what shows.
    private func syncNavigationMask(usePresentation: Bool = true) {
        guard let container = navigationContainer else { return }
        guard fadingNavigationEdge else {
            container.layer.mask = nil
            container.layer.masksToBounds = true
            return
        }
        let bounds = usePresentation ? (container.layer.presentation()?.bounds ?? container.bounds) : container.bounds
        let width = max(1, bounds.width)
        let height = max(1, bounds.height)
        let end = height / 2            // the pill's round end: same height, a half circle
        let reach = 12 + end            // from the cut to that end's centre (the dock's gap, spacer squeezed out)
        let cup = end + 4               // the bite: the round end and a sliver of room
        let fade: CGFloat = 12
        let span = width + reach        // the capsule up to the round end's centre
        let centreX = isLeftHanded ? 0 : span
        let outer = cup + fade + span   // far enough that the gradient covers it all
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        container.layer.masksToBounds = false
        navigationMask.frame = CGRect(x: isLeftHanded ? -reach : 0, y: 0, width: span, height: height)
        navigationMask.startPoint = CGPoint(x: centreX / span, y: 0.5)
        navigationMask.endPoint = CGPoint(x: (centreX + outer) / span, y: 0.5 + outer / height)
        navigationMask.locations = [0, NSNumber(value: Double(cup / outer)), NSNumber(value: Double((cup + fade) / outer)), 1]
        container.layer.mask = navigationMask
        CATransaction.commit()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateStatusSpace()
    }

    func setChromeObscured(_ obscured: Bool) {
        chromeObscured = obscured
        if obscured { closeWriterMenu?() }
        chrome?.isHidden = obscured
        chrome?.isUserInteractionEnabled = !obscured
    }

    func bringChromeForward() {
        if let chrome { view.bringSubviewToFront(chrome) }
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShellMenuPlugin())
        bridge?.registerPluginInstance(ShellPillPlugin())
        bridge?.registerPluginInstance(ShellBarPlugin())
        bridge?.registerPluginInstance(ShellKeychainPlugin())
        bridge?.registerPluginInstance(ShellStorePlugin())
        bridge?.registerPluginInstance(ShellScanPlugin())
    }
}
