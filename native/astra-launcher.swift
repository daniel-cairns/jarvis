// Astra.app's own executable (built by scripts/make-app.sh). It stays running for as long as Astra does and is the
// parent of everything she starts (node, Electron, sox, astra-ax, screencapture). That makes Astra.app the
// "responsible" app in macOS's eyes, so Microphone, Accessibility and Screen Recording are granted to Astra herself,
// once, instead of to Terminal, a stock Electron binary, or a launcher that has already quit.
//
// It runs scripts/astra-launch.sh from the repo named in Info.plist (AstraRepo), with the PATH baked in at build
// time (AstraPath), and quits when that script ends. Quitting the app (Cmd-Q, the Dock, logout) stops Astra too.
//
// It's a regular app, so Astra shows in the Dock with the running dot and in Cmd-Tab. It has no windows of its own:
// switching to it (Cmd-Tab, a Dock click) writes ~/.jarvis/summon, and her orb (orb/main.cjs) comes forward and takes
// the keyboard.

import AppKit
import ApplicationServices
import CoreGraphics

final class Launcher: NSObject, NSApplicationDelegate {
  private var childGroup: pid_t = 0
  private var exitSource: DispatchSourceProcess?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMenu()
    let info = Bundle.main.infoDictionary ?? [:]
    guard let repo = info["AstraRepo"] as? String,
      FileManager.default.fileExists(atPath: "\(repo)/scripts/astra-launch.sh")
    else {
      fail("Astra's code folder wasn't found. Rebuild the app from the Jarvis repo with: npm run app")
      return
    }
    requestPermissionsOnce()

    var env = ProcessInfo.processInfo.environment
    if let path = info["AstraPath"] as? String { env["PATH"] = path }
    env["ASTRA_APP"] = Bundle.main.bundlePath

    guard let pid = spawnInOwnGroup("/bin/sh", ["\(repo)/scripts/astra-launch.sh"], env: env, cwd: repo) else {
      fail("Astra couldn't start: \(String(cString: strerror(errno))).")
      return
    }
    childGroup = pid
    let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
    source.setEventHandler {
      var status: Int32 = 0
      waitpid(pid, &status, 0)
      // From the run loop, not from inside this main-queue block: quitting can wait on the rest of her process group
      // (applicationShouldTerminate), and a wait started inside a main-queue block never lets its own timer run, so
      // the app hung with its Dock dot showing and nothing behind it.
      RunLoop.main.perform { NSApp.terminate(nil) }
    }
    source.resume()
    exitSource = source
  }

  /** Cmd-Tab or a click on her Dock icon makes this app active: hand that on to her orb. */
  func applicationDidBecomeActive(_ notification: Notification) {
    summon()
  }

  /** A Dock click while it's already active. */
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    summon()
    return false
  }

  func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
    let menu = NSMenu()
    menu.addItem(withTitle: "Show Astra", action: #selector(showAstra), keyEquivalent: "")
    return menu
  }

  @objc func showAstra() {
    summon()
  }

  /** Tells her orb to come forward (it watches for this file). */
  private func summon() {
    let env = ProcessInfo.processInfo.environment
    let home = env["JARVIS_HOME"] ?? "\(NSHomeDirectory())/.jarvis"
    try? FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true)
    let stamp = "\(Date().timeIntervalSince1970)\n"
    FileManager.default.createFile(atPath: "\(home)/summon", contents: stamp.data(using: .utf8))
  }

  /** The menu bar while she's the active app: just her name's menu, with Show, Hide and Quit. */
  private func makeMenu() -> NSMenu {
    let appMenu = NSMenu(title: "Astra")
    appMenu.addItem(withTitle: "Show Astra", action: #selector(showAstra), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Astra", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit Astra", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let item = NSMenuItem()
    item.submenu = appMenu
    let bar = NSMenu()
    bar.addItem(item)
    return bar
  }

  /** On quit, stop Astra's whole process tree (she runs in her own process group), then let the app go. */
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    // Checks the group, not just the script: anything it left behind (an orphaned Electron, say) is stopped too.
    if childGroup > 0, kill(-childGroup, 0) == 0 {
      kill(-childGroup, SIGTERM)
      // A timer in the common modes keeps running while AppKit waits for this reply (a modal run loop).
      let group = childGroup
      let timer = Timer(timeInterval: 3, repeats: false) { _ in
        kill(-group, SIGKILL)
        sender.reply(toApplicationShouldTerminate: true)
      }
      RunLoop.main.add(timer, forMode: .common)
      return .terminateLater
    }
    return .terminateNow
  }

  /**
   * Asks macOS for Accessibility and Screen Recording if they aren't granted yet. This lists Astra (this app, with
   * this signature) in both System Settings panes straight away, so there's nothing to add by hand.
   */
  private func requestPermissionsOnce() {
    let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(prompt)
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
  }

  private func fail(_ message: String) {
    NSLog("Astra launcher: %@", message)
    let alert = NSAlert()
    alert.messageText = "Astra can't start"
    alert.informativeText = message
    NSApp.activate(ignoringOtherApps: true)
    alert.runModal()
    NSApp.terminate(nil)
  }
}

/** posix_spawn with the child as leader of a new process group, so the whole tree can be signalled at once. */
func spawnInOwnGroup(_ path: String, _ args: [String], env: [String: String], cwd: String) -> pid_t? {
  FileManager.default.changeCurrentDirectoryPath(cwd)
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  defer { posix_spawnattr_destroy(&attr) }
  posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
  posix_spawnattr_setpgroup(&attr, 0)

  let argv = ([path] + args).map { strdup($0) } + [nil]
  let envp = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
  defer { (argv + envp).forEach { free($0) } }

  var pid: pid_t = 0
  return posix_spawn(&pid, path, nil, &attr, argv, envp) == 0 ? pid : nil
}

let app = NSApplication.shared
let launcher = Launcher()
app.delegate = launcher
// Regular, not an accessory: in the Dock with its running dot, and in Cmd-Tab.
app.setActivationPolicy(.regular)
app.run()
