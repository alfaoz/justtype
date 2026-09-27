import UIKit

// Keeps a bottom-anchored view on the safe-area line, and rides it up onto
// the keyboard with the keyboard's own timing. Shared by the pill and the bar.
final class ShellDock {
    private weak var view: UIView?
    private let bottom: NSLayoutConstraint

    init(_ view: UIView, in parent: UIView) {
        self.view = view
        bottom = view.bottomAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.bottomAnchor)
        bottom.isActive = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(change(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        nc.addObserver(self, selector: #selector(hide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func change(_ n: Notification) {
        guard let parent = view?.superview, let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let frame = parent.convert(end, from: nil)
        move(covered: max(0, parent.bounds.maxY - frame.minY), n)
    }
    @objc private func hide(_ n: Notification) { move(covered: 0, n) }

    private func move(covered h: CGFloat, _ n: Notification) {
        guard let parent = view?.superview else { return }
        let inset = parent.safeAreaInsets.bottom
        bottom.constant = h > 0 ? -(h - inset + 12) : 0
        let duration = (n.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curve = (n.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        UIView.animate(withDuration: duration, delay: 0, options: UIView.AnimationOptions(rawValue: curve << 16)) { parent.layoutIfNeeded() }
    }
}

// The app's type on native chrome: IBM Plex Mono when bundled, else the
// system's mono
func shellFont(_ size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
    UIFont(name: weight == .regular ? "IBMPlexMono" : "IBMPlexMono-Medium", size: size) ?? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
}
