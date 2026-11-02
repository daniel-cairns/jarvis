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
  return (AXUIElementCreateApplication(p), p)
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
  let d = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: true)
  let u = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: false)
  d?.flags = flags
  u?.flags = flags
  post(d)
  post(u)
}

func focusedElement() -> AXUIElement? {
  attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute).map { $0 as! AXUIElement }
}

func typeText(_ text: String) {
  if let f = focusedElement(), isSecure(f) { fail("the focused field is a password field; Astra never types into one", code: "secure_field") }
  let units = Array(text.utf16)
  var i = 0
  while i < units.count {
    let chunk = Array(units[i..<min(i + 16, units.count)])
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
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
  AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  emit(["focused": ref])

case "click":
  guard let x = num("x"), let y = num("y") else { fail("click needs x and y") }
  click(x: x, y: y, count: Int(num("count") ?? 1), right: (input["right"] as? Bool) ?? false)
  emit(["clicked": ["x": x, "y": y]])

case "type":
  guard let text = input["text"] as? String else { fail("type needs text") }
  typeText(text)
  emit(["typed": text.count])

case "key":
  guard let combo = input["combo"] as? String else { fail("key needs combo") }
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
  guard let app = NSWorkspace.shared.runningApplications.first(where: {
    ($0.localizedName ?? "").lowercased() == name || ($0.bundleIdentifier ?? "").lowercased() == name
  }) else { fail("\(name) isn't running", code: "not_running") }
  app.activate()
  emit(["activated": app.localizedName ?? name, "pid": app.processIdentifier])

default:
  fail("unknown command \(command)")
}
