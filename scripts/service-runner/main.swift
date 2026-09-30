// PawServiceRunner: invoke a macOS system service by name through
// NSPerformService — the same entry point AppKit uses when a Services menu
// item is clicked. Paw terminal uses this because Chromium never validates
// services (see render_widget_host_view_cocoa.mm validRequestorForSendType:),
// so macOS never dispatches Services keyboard shortcuts to Electron apps.
//
// Usage: PawServiceRunner <service-name>
// Optional input text is read from stdin and placed on a private pasteboard
// as plain text (string send-type services receive it as their input).
//
// Stays alive briefly after the call so pbs can complete the dispatch.

import Cocoa

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: PawServiceRunner <service-name>\n".data(using: .utf8)!)
    exit(2)
}

let serviceName = CommandLine.arguments[1]

let pasteboard = NSPasteboard(name: NSPasteboard.Name("paw-service-runner"))
pasteboard.clearContents()

// Read stdin without blocking forever if nothing is piped: only when stdin
// is not a TTY (i.e. the caller actually pipes data).
if isatty(STDIN_FILENO) == 0 {
    let input = FileHandle.standardInput.availableData
    if !input.isEmpty,
       let text = String(data: input, encoding: .utf8),
       !text.isEmpty {
        pasteboard.setString(text, forType: .string)
    }
}

let ok = NSPerformService(serviceName, pasteboard)
FileHandle.standardOutput.write((ok ? "ok\n" : "fail\n").data(using: .utf8)!)

// Give the pasteboard server a moment to deliver the service request.
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
    exit(ok ? 0 : 1)
}
CFRunLoopRun()
