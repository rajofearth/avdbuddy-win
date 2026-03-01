import AppKit
import SwiftUI

struct StatusBanner: View {
    let title: String
    let message: String
    let tint: Color
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var dismissAction: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(tint)
                .frame(width: 10, height: 10)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.link)
            }

            if let dismissAction {
                Button {
                    dismissAction()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.92))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(0.18), lineWidth: 1)
        )
        .frame(maxWidth: 520)
    }
}

struct AndroidSDKSetupSheet: View {
    @ObservedObject var manager: EmulatorManager
    @Environment(\.dismiss) private var dismiss
    @State private var sdkPath: String

    init(manager: EmulatorManager) {
        self.manager = manager
        _sdkPath = State(initialValue: manager.toolchainStatus.sdkPath)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            pathEditor
            validationList
            footer
        }
        .padding(24)
        .frame(width: 560)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(manager.isToolchainConfigured ? "Android SDK Settings" : "Set Up Android SDK")
                .font(.system(size: 24, weight: .bold, design: .rounded))

            Text("AvdBuddy uses your Android SDK to load Android versions, create AVDs, and launch emulators.")
                .font(.callout)
                .foregroundStyle(.secondary)

            if let detected = detectedPath, detected != sdkPath {
                Button("Use detected path") {
                    sdkPath = detected
                }
                .buttonStyle(.link)
            }
        }
    }

    private var pathEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Android SDK Location")
                .font(.system(size: 13, weight: .semibold))

            HStack(spacing: 10) {
                TextField("/Users/you/Library/Android/sdk", text: $sdkPath)
                    .textFieldStyle(.roundedBorder)

                Button("Browse...") {
                    if let selectedPath = selectSDKPath() {
                        sdkPath = selectedPath
                    }
                }
            }

            Text(pathStatusMessage)
                .font(.system(size: 12))
                .foregroundStyle(validationStatus.isConfigured ? Color.green : Color.secondary)
        }
    }

    private var validationList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Tool Validation")
                .font(.system(size: 13, weight: .semibold))

            ForEach(validationStatus.toolStates) { state in
                HStack(alignment: .top, spacing: 10) {
                    Circle()
                        .fill(state.isAvailable ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                        .padding(.top, 5)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(state.tool.title)
                            .font(.system(size: 13, weight: .medium))
                        Text(state.path)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.75))
        )
    }

    private var footer: some View {
        HStack {
            if !validationStatus.isConfigured {
                Text(validationStatus.summary)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button("Cancel") {
                dismiss()
            }

            Button(manager.isToolchainConfigured ? "Save" : "Continue") {
                manager.updateSDKPath(sdkPath)
                if manager.isToolchainConfigured {
                    manager.statusMessage = "Android SDK updated."
                    dismiss()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!validationStatus.isConfigured)
        }
    }

    private var validationStatus: AndroidToolchainStatus {
        AndroidSDKLocator.toolchainStatus(
            preferredSDKPath: sdkPath,
            fileManager: FileManager()
        )
    }

    private var detectedPath: String? {
        manager.autodetectedSDKPath
    }

    private var pathStatusMessage: String {
        if validationStatus.isConfigured {
            return "All required tools were found in this SDK."
        }
        return "Choose the Android SDK folder that contains cmdline-tools, emulator, and platform-tools."
    }

    private func selectSDKPath() -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Select SDK"
        if !sdkPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            panel.directoryURL = URL(fileURLWithPath: sdkPath)
        }
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
}
