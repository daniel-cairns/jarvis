// astra-ax: Astra's hands and eyes on the Mac, through the Accessibility API (AXUIElement) and synthetic input
// (CGEvent). One command per run; prints JSON. The safety rules live in Node (src/control/), but this helper
// enforces the one that must never slip: it never reads, and never types into, a secure (password) field.
//
//   astra-ax perms [prompt]            whether Accessibility and Screen Recording are granted
//   astra-ax windows                   on-screen windows
//   astra-ax tree '{"pid":1,"scope":"window","depth":12,"max":400}'
//   astra-ax focused                   the focused element
//   astra-ax at '{"x":1,"y":2}'        the element at a point
//   astra-ax press '{"ref":"123/w/0.2.1"}'   press (or click) an element from a tree
//   astra-ax click '{"x":1,"y":2,"count":1,"right":false}'
//   astra-ax type '{"text":"hi"}'      types into the focused element (refused if it's secure)
//   astra-ax key '{"combo":"cmd+b"}'
//   astra-ax scroll '{"x":1,"y":2,"dy":-5,"dx":0}'
//   astra-ax activate '{"name":"TextEdit"}'
import AppKit
import ApplicationServices
import Foundation

func emit(_ value: Any) -> Never {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(0)
}

func fail(_ message: String, code: String = "error") -> Never {
  let data = try! JSONSerialization.data(withJSONObject: ["error": message, "code": code])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: astra-ax <command> [json]") }
let command = args[1]
let input: [String: Any] = {
  guard args.count >= 3, let data = args[2].data(using: .utf8),
    let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return [:] }
  return obj
}()

func num(_ key: String) -> Double? { (input[key] as? NSNumber)?.doubleValue }

// MARK: - Accessibility reads

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

func str(_ el: AXUIElement, _ name: String) -> String? {
  guard let s = attr(el, name) as? String, !s.isEmpty else { return nil }
  return s
}

func frame(_ el: AXUIElement) -> [String: Double]? {
  guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &point)
  AXValueGetValue(s as! AXValue, .cgSize, &size)
  return ["x": Double(point.x), "y": Double(point.y), "w": Double(size.width), "h": Double(size.height)]
}

func isSecure(_ el: AXUIElement) -> Bool {
  let role = str(el, kAXRoleAttribute) ?? ""
  let subrole = str(el, kAXSubroleAttribute) ?? ""
  return role == "AXSecureTextField" || subrole == "AXSecureTextField"
}

func children(_ el: AXUIElement) -> [AXUIElement] { (attr(el, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }

func pidOf(_ el: AXUIElement) -> pid_t {
  var pid: pid_t = 0
  AXUIElementGetPid(el, &pid)
  return pid
}

/** What Astra sees of one element. A secure field is marked as such, and its value is never read. */
func describe(_ el: AXUIElement) -> [String: Any] {
  var d: [String: Any] = ["role": str(el, kAXRoleAttribute) ?? "?"]
  if let s = str(el, kAXSubroleAttribute) { d["subrole"] = s }
  if let s = str(el, kAXTitleAttribute) { d["title"] = s }
  if let s = str(el, kAXDescriptionAttribute) { d["label"] = s }
  if let s = str(el, kAXPlaceholderValueAttribute) { d["placeholder"] = s }
  if let s = str(el, kAXIdentifierAttribute) { d["id"] = s }
  if isSecure(el) {
    d["secure"] = true
  } else if let v = attr(el, kAXValueAttribute) {
    if let s = v as? String, !s.isEmpty { d["value"] = s.count > 300 ? String(s.prefix(300)) + "…" : s }
    else if let n = v as? NSNumber { d["value"] = n }
  }
  if let f = frame(el) { d["frame"] = f }
  if let e = attr(el, kAXEnabledAttribute) as? Bool, !e { d["enabled"] = false }
  if let f = attr(el, kAXFocusedAttribute) as? Bool, f { d["focused"] = true }
  var names: CFArray?
  if AXUIElementCopyActionNames(el, &names) == .success, let list = names as? [String], !list.isEmpty {
    d["actions"] = list.map { $0.replacingOccurrences(of: "AX", with: "") }
  }
  return d
}

func appElement(_ pid: pid_t?) -> (AXUIElement, pid_t) {
  let p = pid ?? NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
  let app = AXUIElementCreateApplication(p)
  exposeChromiumTree(app)
  return (app, p)
}

/// Electron and Chromium apps (the Claude app, VS Code, Slack…) only build their accessibility tree for screen
/// readers; to everyone else it's a few empty AXGroups. Setting AXManualAccessibility on the app asks for the full
/// tree. (AXEnhancedUserInterface does too, but it's known to break window animations and positioning.)
/// The flag always reads back as false, so it can't say whether it's already on: it's set on every read (cheap and
/// harmless; native apps don't have it and refuse) and the wait happens only while the window's tree is still
/// sparse. Chromium keeps the tree for the life of the process, so in effect only an app's first read waits.
/// Measured on the Claude app: 14 elements before, 1,204 a few seconds after.
let manualAccessibility = "AXManualAccessibility" as CFString

func exposeChromiumTree(_ app: AXUIElement) {
  guard AXUIElementSetAttributeValue(app, manualAccessibility, kCFBooleanTrue) == .success else { return }
  let deadline = Date().addingTimeInterval(5)
  repeat {
    guard let w = attr(app, kAXFocusedWindowAttribute) ?? attr(app, kAXMainWindowAttribute) else { return }
    if countNodes(w as! AXUIElement, limit: 40) >= 40 { return }
    usleep(150_000)
  } while Date() < deadline
}

/// Counts elements under `el`, stopping at `limit`.
func countNodes(_ el: AXUIElement, limit: Int) -> Int {
  var n = 0
  var queue = [el]
  while let next = queue.popLast(), n < limit {
    n += 1
    queue.append(contentsOf: children(next))
  }
  return n
}

/** The root a ref's path starts from: the app's focused window ("w") or the app itself ("a"). */
func root(_ app: AXUIElement, _ scope: String) -> AXUIElement? {
  if scope == "a" { return app }
  if let w = attr(app, kAXFocusedWindowAttribute) { return (w as! AXUIElement) }
  return (attr(app, kAXMainWindowAttribute) as! AXUIElement?) ?? app
}

func resolve(_ ref: String) -> AXUIElement {
  let parts = ref.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
  guard parts.count == 3, let pid = pid_t(parts[0]), let start = root(AXUIElementCreateApplication(pid), parts[1])
  else { fail("bad element reference \(ref)", code: "bad_ref") }
  var el = start
  for step in parts[2].split(separator: ".") where !step.isEmpty {
    let kids = children(el)
    guard let i = Int(step), i < kids.count else { fail("element \(ref) is gone; read the UI again", code: "stale_ref") }
    el = kids[i]
  }
  return el
}

func tree() -> Never {
  let (app, pid) = appElement((input["pid"] as? NSNumber).map { pid_t($0.int32Value) })
  let scope = (input["scope"] as? String) == "app" ? "a" : "w"
  guard let start = root(app, scope) else { fail("no window to read") }
  let maxDepth = Int(num("depth") ?? 12)
  let maxNodes = Int(num("max") ?? 400)
  var count = 0
  var truncated = false
  func walk(_ el: AXUIElement, _ path: String, _ depth: Int) -> [String: Any] {
    count += 1
    var d = describe(el)
    d["ref"] = "\(pid)/\(scope)/\(path)"
    let kids = children(el)
    if !kids.isEmpty {
      if depth >= maxDepth || count >= maxNodes {
        truncated = true
        d["more"] = kids.count
      } else {
        var out: [[String: Any]] = []
        for (i, k) in kids.enumerated() {
          if count >= maxNodes { truncated = true; break }
          out.append(walk(k, path.isEmpty ? "\(i)" : "\(path).\(i)", depth + 1))
        }
        d["children"] = out
      }
    }
    return d
  }
  let name = NSRunningApplication(processIdentifier: pid)?.localizedName ?? "?"
  emit(["app": name, "pid": pid, "tree": walk(start, "", 0), "nodes": count, "truncated": truncated])
}

// MARK: - Input

func post(_ event: CGEvent?) {
  event?.post(tap: .cghidEventTap)
  usleep(8_000)
}

func click(x: Double, y: Double, count: Int, right: Bool) {
  let p = CGPoint(x: x, y: y)
  let (down, up, button): (CGEventType, CGEventType, CGMouseButton) =
    right ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  for n in 1...max(1, count) {
    let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: p, mouseButton: button)
    let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: p, mouseButton: button)
    d?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
    u?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
    post(d)
    post(u)
  }
}

let KEYS: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
  "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
  "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
  "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
  "return": 36, "enter": 76, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
  "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
  "left": 123, "right": 124, "down": 125, "up": 126,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
  "f11": 103, "f12": 111,
]

func key(_ combo: String) {
  var flags: CGEventFlags = []
  var code: CGKeyCode?
  for part in combo.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
    switch part {
    case "cmd", "command": flags.insert(.maskCommand)
    case "shift": flags.insert(.maskShift)
    case "alt", "option", "opt": flags.insert(.maskAlternate)
    case "ctrl", "control": flags.insert(.maskControl)
    case "fn": flags.insert(.maskSecondaryFn)
    default:
      guard let c = KEYS[part] else { fail("unknown key \(part)", code: "bad_key") }
      code = c
    }
  }
  guard let c = code else { fail("no key in \(combo)", code: "bad_key") }
  // Press the modifiers as real keys and release them afterwards. Only setting flags on the key event left macOS
  // believing ⌘ was still held, and everything typed after a shortcut arrived as ⌘+letter and was lost.
  let mods = MODIFIER_KEYS.filter { flags.contains($0.flag) }
  var held: CGEventFlags = []
  for m in mods {
    held.insert(m.flag)
    let e = CGEvent(keyboardEventSource: nil, virtualKey: m.code, keyDown: true)
    e?.flags = held
    post(e)
  }
  let d = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: true)
  let u = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: false)
  d?.flags = flags
  u?.flags = flags
  post(d)
  post(u)
  for m in mods.reversed() {
    held.remove(m.flag)
    let e = CGEvent(keyboardEventSource: nil, virtualKey: m.code, keyDown: false)
    e?.flags = held
    post(e)
  }
}

let MODIFIER_KEYS: [(flag: CGEventFlags, code: CGKeyCode)] = [
  (.maskCommand, 55), (.maskShift, 56), (.maskAlternate, 58), (.maskControl, 59), (.maskSecondaryFn, 63),
]

/// The element with keyboard focus. The system-wide query often fails (it did with TextEdit frontmost), so this
/// falls back to asking the frontmost app directly.
func focusedElement() -> AXUIElement? {
  if let f = attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute) { return (f as! AXUIElement) }
  guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return nil }
  return attr(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute).map { $0 as! AXUIElement }
}

/// The focused element's text, when it has some (nil for elements without a readable value).
func textValue(_ el: AXUIElement?) -> String? { el.flatMap { attr($0, kAXValueAttribute) as? String } }

/// Refuses to type unless the keystrokes will reach the app that's meant to get them: the frontmost app owns the
/// focused element, and, when the caller says which app it expects, it's that one. Typing blind is a safety risk,
/// since a newline in the wrong app can send a message.
func checkTarget(_ expected: pid_t?) -> AXUIElement {
  guard let front = NSWorkspace.shared.frontmostApplication else { fail("no app is in front", code: "wrong_target") }
  let frontName = front.localizedName ?? "?"
  if let e = expected, e != front.processIdentifier {
    let want = NSRunningApplication(processIdentifier: e)?.localizedName ?? "the app I focused"
    fail("\(frontName) is in front, not \(want), so I didn't type. Focus the field again first.", code: "wrong_target")
  }
  guard let f = focusedElement() else { fail("nothing in \(frontName) has keyboard focus, so I didn't type", code: "wrong_target") }
  if pidOf(f) != front.processIdentifier {
    fail("keyboard focus isn't in \(frontName), the app in front, so I didn't type", code: "wrong_target")
  }
  if isSecure(f) { fail("the focused field is a password field; Astra never types into one", code: "secure_field") }
  return f
}

/// Types `text` into the focused element. Each event carries no modifier flags: an event made without them
/// inherits whatever modifiers macOS thinks are held, so a stuck ⌘ turned typing into a string of ⌘ shortcuts.
func typeText(_ text: String, expected: pid_t?) {
  let target = checkTarget(expected)
  let front = pidOf(target)
  let units = Array(text.utf16)
  var i = 0
  while i < units.count {
    if NSWorkspace.shared.frontmostApplication?.processIdentifier != front {
      fail("another app came to the front after \(i) of \(units.count) characters, so I stopped typing", code: "wrong_target")
    }
    let chunk = Array(units[i..<min(i + 16, units.count)])
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
      e?.flags = []
      chunk.withUnsafeBufferPointer { e?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress) }
      post(e)
    }
    i += 16
  }
}

// MARK: - Commands

switch command {
case "perms":
  let prompt = args.count >= 3 && args[2] == "prompt"
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
  let ax = AXIsProcessTrustedWithOptions(opts)
  var screen = CGPreflightScreenCaptureAccess()
  if prompt && !screen { screen = CGRequestScreenCaptureAccess() }
  emit(["accessibility": ax, "screenRecording": screen])

case "windows":
  let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
  emit(list.filter { ($0[kCGWindowLayer as String] as? Int) == 0 }.map { w -> [String: Any] in
    var d: [String: Any] = [
      "app": w[kCGWindowOwnerName as String] as? String ?? "?",
      "pid": w[kCGWindowOwnerPID as String] as? Int ?? 0,
      "windowId": w[kCGWindowNumber as String] as? Int ?? 0,
    ]
    if let t = w[kCGWindowName as String] as? String, !t.isEmpty { d["title"] = t }
    if let b = w[kCGWindowBounds as String] as? [String: Any] { d["frame"] = b }
    return d
  })

case "tree": tree()

case "focused":
  guard let f = focusedElement() else { fail("nothing has keyboard focus") }
  var d = describe(f)
  d["app"] = NSRunningApplication(processIdentifier: pidOf(f))?.localizedName ?? "?"
  emit(d)

case "at":
  guard let x = num("x"), let y = num("y") else { fail("at needs x and y") }
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(x), Float(y), &hit) == .success, let el = hit
  else { fail("nothing at \(x),\(y)") }
  var d = describe(el)
  if let parent = attr(el, kAXParentAttribute) { d["parent"] = describe(parent as! AXUIElement) }
  d["app"] = NSRunningApplication(processIdentifier: pidOf(el))?.localizedName ?? "?"
  emit(d)

case "describe":
  guard let ref = input["ref"] as? String else { fail("describe needs ref") }
  let el = resolve(ref)
  var d = describe(el)
  d["app"] = NSRunningApplication(processIdentifier: pidOf(el))?.localizedName ?? "?"
  emit(d)

case "press":
  guard let ref = input["ref"] as? String else { fail("press needs ref") }
  let el = resolve(ref)
  if AXUIElementPerformAction(el, kAXPressAction as CFString) == .success { emit(["pressed": ref, "via": "action"]) }
  guard let f = frame(el) else { fail("can't press \(ref): no action and no position") }
  click(x: f["x"]! + f["w"]! / 2, y: f["y"]! + f["h"]! / 2, count: 1, right: false)
  emit(["pressed": ref, "via": "click"])

case "focus":
  guard let ref = input["ref"] as? String else { fail("focus needs ref") }
  let el = resolve(ref)
  if isSecure(el) { fail("that's a password field; Astra doesn't touch those", code: "secure_field") }
  // Typing goes to the frontmost app, so bring the element's app and window forward first; focusing inside an app
  // that's in the background moved its focus but sent the keystrokes elsewhere (to the orb, in testing).
  NSRunningApplication(processIdentifier: pidOf(el))?.activate()
  if let window = attr(el, kAXWindowAttribute) { AXUIElementPerformAction(window as! AXUIElement, kAXRaiseAction as CFString) }
  usleep(250_000)
  AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  usleep(100_000)
  // Chromium sometimes ignores the AX focus request; a click in the middle of the element focuses it reliably.
  if (attr(el, kAXFocusedAttribute) as? Bool) != true, let f = frame(el) {
    click(x: f["x"]! + f["w"]! / 2, y: f["y"]! + f["h"]! / 2, count: 1, right: false)
  }
  emit(["focused": ref, "app": NSRunningApplication(processIdentifier: pidOf(el))?.localizedName ?? "?"])

case "click":
  guard let x = num("x"), let y = num("y") else { fail("click needs x and y") }
  click(x: x, y: y, count: Int(num("count") ?? 1), right: (input["right"] as? Bool) ?? false)
  emit(["clicked": ["x": x, "y": y]])

case "type":
  guard let text = input["text"] as? String else { fail("type needs text") }
  let expected = (input["pid"] as? NSNumber).map { pid_t($0.int32Value) }
  let before = textValue(focusedElement())
  typeText(text, expected: expected)
  usleep(150_000)
  let after = textValue(focusedElement())
  var out: [String: Any] = ["typed": text.count, "app": NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"]
  // Did it land? Only checkable when the field exposes its text; apps may autocorrect, so compare loosely.
  if let b = before, let a = after {
    out["landed"] = a.count > b.count && (text.count < 4 || a.lowercased().contains(text.lowercased().trimmingCharacters(in: .whitespaces)))
  }
  emit(out)

case "key":
  guard let combo = input["combo"] as? String else { fail("key needs combo") }
  if let e = (input["pid"] as? NSNumber).map({ pid_t($0.int32Value) }),
     let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != e {
    fail("\(front.localizedName ?? "another app") is in front, not the app I focused, so I didn't press \(combo)", code: "wrong_target")
  }
  key(combo)
  emit(["pressed": combo])

case "scroll":
  if let x = num("x"), let y = num("y") {
    post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left))
  }
  let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2,
                  wheel1: Int32(num("dy") ?? 0), wheel2: Int32(num("dx") ?? 0), wheel3: 0)
  post(e)
  emit(["scrolled": true])

case "activate":
  let name = (input["name"] as? String ?? "").lowercased()
  let byPid = (input["pid"] as? NSNumber).flatMap { NSRunningApplication(processIdentifier: pid_t($0.int32Value)) }
  guard let app = byPid ?? NSWorkspace.shared.runningApplications.first(where: {
    ($0.localizedName ?? "").lowercased() == name || ($0.bundleIdentifier ?? "").lowercased() == name
  }) else { fail("\(name) isn't running", code: "not_running") }
  app.activate()
  // Wait (briefly) until it really is in front, so the keystrokes that follow reach it.
  for _ in 0..<20 where NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier { usleep(50_000) }
  emit(["activated": app.localizedName ?? name, "pid": app.processIdentifier])

default:
  fail("unknown command \(command)")
}
