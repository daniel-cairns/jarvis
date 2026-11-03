// Astra.app's own executable (built by scripts/make-app.sh). It stays running for as long as Astra does and is the
// parent of everything she starts (node, Electron, sox, astra-ax, screencapture). That makes Astra.app the
// "responsible" app in macOS's eyes, so Microphone, Accessibility and Screen Recording are granted to Astra herself,
// once, instead of to Terminal, a stock Electron binary, or a launcher that has already quit.
//
// It runs scripts/astra-launch.sh from the repo named in Info.plist (AstraRepo), with the PATH baked in at build
// time (AstraPath), and quits when that script ends. Quitting the app (logout, Activity Monitor) stops Astra too.

import AppKit
import ApplicationServices
import CoreGraphics

final class Launcher: NSObject, NSApplicationDelegate {
  private var childGroup: pid_t = 0
  private var exitSource: DispatchSourceProcess?

  func applicationDidFinishLaunching(_ notification: Notification) {
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
      NSApp.terminate(nil)
    }
    source.resume()
    exitSource = source
  }

  /** On quit, stop Astra's whole process tree (she runs in her own process group), then let the app go. */
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    // Checks the group, not just the script: anything it left behind (an orphaned Electron, say) is stopped too.
    if childGroup > 0, kill(-childGroup, 0) == 0 {
      kill(-childGroup, SIGTERM)
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [childGroup] in
        kill(-childGroup, SIGKILL)
        sender.reply(toApplicationShouldTerminate: true)
      }
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
app.setActivationPolicy(.accessory)
app.run()
