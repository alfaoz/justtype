// swift-tools-version:5.9
// The justtype Mac app: the web app's desktop layout in a native window.
// AppKit + the system WebKit (no bundled browser engine), the web build
// inside the app so it opens offline, native files for the offline copies.
// Sparkle keeps it up to date. build.sh assembles justtype.app around the
// executable this produces.
import PackageDescription

let package = Package(
    name: "Justtype",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")
    ],
    targets: [
        .executableTarget(name: "Justtype", dependencies: [.product(name: "Sparkle", package: "Sparkle")], path: "Sources/Justtype")
    ]
)
