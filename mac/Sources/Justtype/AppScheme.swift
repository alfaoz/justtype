import Foundation
import UniformTypeIdentifiers
import WebKit

// Everything the page loads comes through here, at capacitor://justtype.io
// (the same origin the iOS app has, so the server and Turnstile already know
// it): the web build bundled in the app for every file, so the app opens
// offline and at once; and /api/* relayed to https://justtype.io over the
// app's own URLSession. The session cookie lives in that session's cookie
// store, first party to the server, and every call is same-origin for the
// page, so there is no CORS and nothing to sign in to twice. Responses are
// streamed as they arrive, which is what keeps the event stream alive.
final class AppScheme: NSObject, WKURLSchemeHandler, URLSessionDataDelegate {
    static let scheme = "capacitor"
    static let host = "justtype.io"
    static let remote = URL(string: "https://justtype.io")!
    static var start: URL { URL(string: "\(scheme)://\(host)/")! }

    private let webRoot: URL
    private lazy var session: URLSession = {
        let config = Profile.clean ? URLSessionConfiguration.ephemeral : .default
        if !Profile.clean { config.httpCookieStorage = .shared }
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        // The event stream sends a keepalive every 25 s
        config.timeoutIntervalForRequest = 60
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    // In-flight relays, both ways, so a task the page cancels is cancelled
    // here and never answered after WebKit let go of it (that throws)
    private var relays: [Int: WKURLSchemeTask] = [:]
    private var byPage: [ObjectIdentifier: URLSessionTask] = [:]

    init(webRoot: URL) {
        self.webRoot = webRoot
        super.init()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        if url.path.hasPrefix("/api/") { relay(task, url) } else { serve(task, url) }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guard let remote = byPage.removeValue(forKey: ObjectIdentifier(task)) else { return }
        relays.removeValue(forKey: remote.taskIdentifier)
        remote.cancel()
    }

    // MARK: the bundled web build

    private func serve(_ task: WKURLSchemeTask, _ url: URL) {
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        var file = webRoot.appendingPathComponent(String(path.dropFirst()))
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir) && !isDir.boolValue
        // An app route (/slates, /slate/12, /account): the app itself answers it
        if !exists {
            guard file.pathExtension.isEmpty else { return notFound(task, url) }
            file = webRoot.appendingPathComponent("index.html")
        }
        guard file.standardizedFileURL.path.hasPrefix(webRoot.standardizedFileURL.path),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return notFound(task, url) }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = [
            "Content-Type": type.hasPrefix("text/") || type.hasSuffix("javascript") || type.hasSuffix("json") ? "\(type); charset=utf-8" : type,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func notFound(_ task: WKURLSchemeTask, _ url: URL) {
        let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!
        task.didReceive(response)
        task.didFinish()
    }

    // MARK: the API, relayed

    // Headers the page's request carries that describe the page, not the
    // caller the server should see: the relay is a first-party client
    private static let dropped: Set<String> = ["origin", "referer", "host", "cookie", "content-length", "accept-encoding", "connection"]

    private func relay(_ task: WKURLSchemeTask, _ url: URL) {
        if let fixtures = Self.fixtures { return answer(task, url, fixtures) }
        var parts = URLComponents(url: Self.remote, resolvingAgainstBaseURL: false)!
        parts.path = url.path
        parts.percentEncodedQuery = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery
        guard let target = parts.url else { task.didFailWithError(URLError(.badURL)); return }
        var request = URLRequest(url: target)
        request.httpMethod = task.request.httpMethod ?? "GET"
        for (name, value) in task.request.allHTTPHeaderFields ?? [:] where !Self.dropped.contains(name.lowercased()) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.httpBody = task.request.httpBody ?? task.request.httpBodyStream.map(Self.drain)
        let remote = session.dataTask(with: request)
        relays[remote.taskIdentifier] = task
        byPage[ObjectIdentifier(task)] = remote
        remote.resume()
    }

    // Made-up answers instead of the server (JUSTTYPE_FIXTURES=<file.json>,
    // with the throwaway profile only): a made-up account for the pictures
    // on justtype.io/mac (site-shots.sh). Each key is "METHOD /api/path",
    // with or without its query, where * stands for one part of the path;
    // its value is the JSON body. Anything else is a 404. Every call is
    // written to requests.log beside the file.
    private static let fixtureFile = Profile.clean ? ProcessInfo.processInfo.environment["JUSTTYPE_FIXTURES"] : nil
    private static let fixtures: [String: Any]? = fixtureFile
        .flatMap { try? Data(contentsOf: URL(fileURLWithPath: $0)) }
        .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }

    private func answer(_ task: WKURLSchemeTask, _ url: URL, _ fixtures: [String: Any]) {
        let method = task.request.httpMethod ?? "GET"
        let query = url.query.map { "?\($0)" } ?? ""
        let parts = url.path.split(separator: "/")
        let found = fixtures["\(method) \(url.path)\(query)"] ?? fixtures["\(method) \(url.path)"] ?? fixtures.first { key, _ in
            let pattern = key.split(separator: " ", maxSplits: 1)
            guard pattern.count == 2, pattern[0] == method else { return false }
            let wanted = pattern[1].split(separator: "?")[0].split(separator: "/")
            return wanted.count == parts.count && zip(wanted, parts).allSatisfy { $0 == "*" || $0 == $1 }
        }?.value
        let body = found.flatMap { try? JSONSerialization.data(withJSONObject: $0, options: .fragmentsAllowed) } ?? Data("{}".utf8)
        let status = found == nil ? 404 : 200
        if let file = Self.fixtureFile {
            let log = URL(fileURLWithPath: file).deletingLastPathComponent().appendingPathComponent("requests.log")
            let line = Data("\(status) \(method) \(url.path)\(query)\n".utf8)
            if let handle = try? FileHandle(forWritingTo: log) { handle.seekToEndOfFile(); handle.write(line); try? handle.close() } else { try? line.write(to: log) }
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json; charset=utf-8", "Content-Length": String(body.count)])!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private static func drain(_ stream: InputStream) -> Data {
        var data = Data()
        stream.open()
        defer { stream.close() }
        let size = 64 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: size)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let task = relays[dataTask.taskIdentifier], let http = response as? HTTPURLResponse,
              let url = task.request.url else { completionHandler(.cancel); return }
        // URLSession has already inflated the body and kept the cookies
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            guard let name = key as? String, let value = value as? String else { continue }
            if ["set-cookie", "content-encoding", "content-length", "transfer-encoding"].contains(name.lowercased()) { continue }
            headers[name] = value
        }
        let answer = HTTPURLResponse(url: url, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(answer)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        relays[dataTask.taskIdentifier]?.didReceive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let page = relays.removeValue(forKey: task.taskIdentifier) else { return }
        byPage.removeValue(forKey: ObjectIdentifier(page))
        if let error { page.didFailWithError(error) } else { page.didFinish() }
    }
}
