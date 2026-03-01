import Foundation
import Testing
@testable import AvdBuddy

struct EmulatorManagerTests {
    @Test @MainActor
    func loadsSystemImagesFromSDKManagerList() async throws {
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        runner.handler = { command in
            if command.arguments == ["--list"] {
                return CommandResult(exitCode: 0, stdout: sdkManagerListFixture, stderr: "")
            }
            return CommandResult(exitCode: 0, stdout: "", stderr: "")
        }

        let manager = EmulatorManager(runner: runner, fileManager: FileManager(), sdkPath: sdkRoot.path)
        let images = try await manager.loadSystemImages()

        #expect(images.contains(where: { $0.packagePath == "system-images;android-36;google_apis_playstore;arm64-v8a" && !$0.isInstalled }))
        #expect(images.contains(where: { $0.packagePath == "system-images;android-35;google_apis;arm64-v8a" && $0.isInstalled }))
    }

    @Test @MainActor
    func createsResolvedAVDUsingSelectedSystemImageAndWritesConfig() async throws {
        let tempDirectory = try temporaryAVDRoot()
        defer { try? FileManager().removeItem(at: tempDirectory.deletingLastPathComponent()) }
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        runner.handler = { command in
            if command.executable == "\(sdkRoot.path)/cmdline-tools/latest/bin/avdmanager",
               command.arguments.starts(with: ["create", "avd"]) {
                let name = command.arguments[command.arguments.firstIndex(of: "-n")! + 1]
                let avdDirectory = tempDirectory.appendingPathComponent("\(name).avd")
                try? FileManager().createDirectory(at: avdDirectory, withIntermediateDirectories: true)
                let config = """
                avd.ini.displayname=\(name)
                hw.lcd.width=1080
                hw.lcd.height=2400
                """
                try? config.write(to: avdDirectory.appendingPathComponent("config.ini"), atomically: true, encoding: .utf8)
                let ini = """
                path=\(avdDirectory.path)
                path.rel=avd/\(name).avd
                target=android-36
                """
                try? ini.write(to: tempDirectory.appendingPathComponent("\(name).ini"), atomically: true, encoding: .utf8)
            }
            return CommandResult(exitCode: 0, stdout: "", stderr: "")
        }

        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: sdkRoot.path,
            avdRootOverride: tempDirectory
        )

        let configuration = CreateAVDResolvedConfiguration(
            packagePath: "system-images;android-36;google_apis_playstore;arm64-v8a",
            avdName: "Pixel_36_Play",
            deviceProfileID: "pixel_9",
            ramMB: 4096,
            storage: "32GB",
            sdCard: "2048M",
            colorSeed: "abcdef123456"
        )
        let didCreate = await manager.createAVD(from: configuration)

        #expect(didCreate)
        #expect(runner.commands.count == 2)
        #expect(runner.commands[0].executable == "\(sdkRoot.path)/cmdline-tools/latest/bin/sdkmanager")
        #expect(runner.commands[0].arguments == ["--install", "system-images;android-36;google_apis_playstore;arm64-v8a"])
        #expect(runner.commands[1].arguments == [
            "create", "avd",
            "-n", "Pixel_36_Play",
            "-k", "system-images;android-36;google_apis_playstore;arm64-v8a",
            "-d", "pixel_9",
            "-c", "2048M"
        ])

        let configContents = try String(contentsOf: tempDirectory.appendingPathComponent("Pixel_36_Play.avd/config.ini"))
        #expect(configContents.contains("hw.ramSize=4096"))
        #expect(configContents.contains("disk.dataPartition.size=32GB"))
        #expect(configContents.contains("avdbuddy.color.seed=abcdef123456"))
        #expect(manager.lastCreatedEmulatorName == "Pixel_36_Play")
    }

    @Test @MainActor
    func rejectsDuplicateCreateNameBeforeRunningCommands() async throws {
        let tempDirectory = try temporaryAVDRoot()
        defer { try? FileManager().removeItem(at: tempDirectory.deletingLastPathComponent()) }

        try createAVDFixture(named: "Pixel_Phone", at: tempDirectory, target: "android-36")
        let runner = MockRunner()
        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: "/sdk",
            avdRootOverride: tempDirectory
        )

        manager.refreshEmulators()

        let validation = manager.validationMessageForCreateName("Pixel_Phone")

        #expect(validation == "An emulator named Pixel_Phone already exists.")
        #expect(runner.commands.isEmpty)
    }

    @Test @MainActor
    func launchesEmulatorUsingPlayCommand() async throws {
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: sdkRoot.path
        )

        await manager.launch(EmulatorInstance(id: "a", name: "Pixel_API_24", apiLevel: 24))

        #expect(runner.commands.count == 1)
        #expect(runner.commands[0].executable == "\(sdkRoot.path)/emulator/emulator")
        #expect(runner.commands[0].arguments == ["-avd", "Pixel_API_24"])
        #expect(runner.commands[0].waitForExit == false)
    }

    @Test @MainActor
    func deletesEmulatorUsingDeleteCommand() async throws {
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: sdkRoot.path
        )

        await manager.delete(EmulatorInstance(id: "a", name: "Pixel_API_24", apiLevel: 24))

        #expect(runner.commands.count == 1)
        #expect(runner.commands[0].executable == "\(sdkRoot.path)/cmdline-tools/latest/bin/avdmanager")
        #expect(runner.commands[0].arguments == ["delete", "avd", "-n", "Pixel_API_24"])
    }

    @Test @MainActor
    func stopsRunningEmulatorUsingAdbKill() async throws {
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        runner.handler = { command in
            if command.arguments == ["devices"] {
                return CommandResult(
                    exitCode: 0,
                    stdout: "List of devices attached\nemulator-5554\tdevice\n\n",
                    stderr: ""
                )
            }
            if command.arguments == ["-s", "emulator-5554", "shell", "getprop", "ro.boot.qemu.avd_name"] {
                return CommandResult(exitCode: 0, stdout: "Pixel_API_24\n", stderr: "")
            }
            if command.arguments == ["-s", "emulator-5554", "emu", "avd", "name"] {
                return CommandResult(exitCode: 0, stdout: "Pixel_API_24\n", stderr: "")
            }
            return CommandResult(exitCode: 0, stdout: "", stderr: "")
        }

        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: sdkRoot.path
        )

        await manager.stop(EmulatorInstance(id: "a", name: "Pixel_API_24", apiLevel: 24))

        #expect(runner.commands.count == 5)
        #expect(runner.commands[0].executable == "\(sdkRoot.path)/platform-tools/adb")
        #expect(runner.commands[0].arguments == ["devices"])
        #expect(runner.commands[1].arguments == ["-s", "emulator-5554", "shell", "getprop", "ro.boot.qemu.avd_name"])
        #expect(runner.commands[2].arguments == ["-s", "emulator-5554", "emu", "kill"])
        #expect(runner.commands[3].arguments == ["devices"])
        #expect(runner.commands[4].arguments == ["-s", "emulator-5554", "shell", "getprop", "ro.boot.qemu.avd_name"])
    }

    @Test @MainActor
    func refreshRunningStatesTracksRunningAvdNames() async throws {
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        runner.handler = { command in
            if command.arguments == ["devices"] {
                return CommandResult(
                    exitCode: 0,
                    stdout: "List of devices attached\nemulator-5554\tdevice\n\n",
                    stderr: ""
                )
            }
            if command.arguments == ["-s", "emulator-5554", "shell", "getprop", "ro.boot.qemu.avd_name"] {
                return CommandResult(exitCode: 0, stdout: "Pixel_API_24\n", stderr: "")
            }
            if command.arguments == ["-s", "emulator-5554", "emu", "avd", "name"] {
                return CommandResult(exitCode: 0, stdout: "Pixel_API_24\n", stderr: "")
            }
            return CommandResult(exitCode: 0, stdout: "", stderr: "")
        }

        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: sdkRoot.path
        )

        manager.refreshRunningStates()

        #expect(manager.runningEmulatorNames.contains("Pixel_API_24"))
    }

    @Test @MainActor
    func killAllStopsEveryRunningEmulator() async throws {
        let sdkRoot = try temporarySDKRoot()
        defer { try? FileManager().removeItem(at: sdkRoot) }
        try createSDKToolchainFixture(at: sdkRoot)

        let runner = MockRunner()
        runner.handler = { command in
            if command.arguments == ["devices"] {
                return CommandResult(
                    exitCode: 0,
                    stdout: "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n\n",
                    stderr: ""
                )
            }
            if command.arguments == ["-s", "emulator-5554", "shell", "getprop", "ro.boot.qemu.avd_name"] {
                return CommandResult(exitCode: 0, stdout: "Pixel_API_24\n", stderr: "")
            }
            if command.arguments == ["-s", "emulator-5556", "shell", "getprop", "ro.boot.qemu.avd_name"] {
                return CommandResult(exitCode: 0, stdout: "Pixel_Tablet_35\n", stderr: "")
            }
            return CommandResult(exitCode: 0, stdout: "", stderr: "")
        }

        let manager = EmulatorManager(
            runner: runner,
            fileManager: FileManager(),
            sdkPath: sdkRoot.path
        )

        await manager.killAllRunningEmulators()

        #expect(runner.commands.count == 5)
        #expect(runner.commands[0].arguments == ["devices"])
        #expect(runner.commands[1].arguments == ["-s", "emulator-5554", "shell", "getprop", "ro.boot.qemu.avd_name"])
        #expect(runner.commands[2].arguments == ["-s", "emulator-5556", "shell", "getprop", "ro.boot.qemu.avd_name"])
        #expect(runner.commands[3].arguments == ["-s", "emulator-5554", "emu", "kill"])
        #expect(runner.commands[4].arguments == ["-s", "emulator-5556", "emu", "kill"])
    }

    @Test @MainActor
    func duplicatesEmulatorByCopyingDirectoryAndIni() async throws {
        let tempDirectory = try temporaryAVDRoot()
        defer { try? FileManager().removeItem(at: tempDirectory.deletingLastPathComponent()) }

        try createAVDFixture(named: "Pixel_API_24", at: tempDirectory, target: "android-24")
        let manager = EmulatorManager(
            runner: MockRunner(),
            fileManager: FileManager(),
            sdkPath: "/sdk",
            avdRootOverride: tempDirectory
        )

        manager.refreshEmulators()
        await manager.duplicate(EmulatorInstance(id: "Pixel_API_24", name: "Pixel_API_24", apiLevel: 24))

        let duplicatedINI = tempDirectory.appendingPathComponent("Pixel_API_24_Copy.ini")
        let duplicatedDirectory = tempDirectory.appendingPathComponent("Pixel_API_24_Copy.avd")

        #expect(FileManager().fileExists(atPath: duplicatedINI.path))
        #expect(FileManager().fileExists(atPath: duplicatedDirectory.path))

        let duplicatedINIContents = try String(contentsOf: duplicatedINI)
        #expect(duplicatedINIContents.contains("path.rel=avd/Pixel_API_24_Copy.avd"))
        #expect(duplicatedINIContents.contains("target=android-24"))

        let duplicatedConfigContents = try String(contentsOf: duplicatedDirectory.appendingPathComponent("config.ini"))
        #expect(duplicatedConfigContents.contains("avdbuddy.color.seed=\(EmulatorInstance.fallbackColorSeed(for: "Pixel_API_24_Copy"))"))
    }

    @Test @MainActor
    func refreshLoadsPersistedColorSeedFromConfig() async throws {
        let tempDirectory = try temporaryAVDRoot()
        defer { try? FileManager().removeItem(at: tempDirectory.deletingLastPathComponent()) }

        try createAVDFixture(
            named: "Pixel_API_24",
            at: tempDirectory,
            target: "android-24",
            colorSeed: "feedbeef"
        )
        let manager = EmulatorManager(
            runner: MockRunner(),
            fileManager: FileManager(),
            sdkPath: "/sdk",
            avdRootOverride: tempDirectory
        )

        manager.refreshEmulators()

        #expect(manager.emulators.first?.colorSeed == "feedbeef")
    }

    @Test @MainActor
    func renamesEmulatorByMovingDirectoryAndIni() async throws {
        let tempDirectory = try temporaryAVDRoot()
        defer { try? FileManager().removeItem(at: tempDirectory.deletingLastPathComponent()) }

        try createAVDFixture(named: "Pixel_API_24", at: tempDirectory, target: "android-24")
        let manager = EmulatorManager(
            runner: MockRunner(),
            fileManager: FileManager(),
            sdkPath: "/sdk",
            avdRootOverride: tempDirectory
        )

        manager.refreshEmulators()
        await manager.rename(EmulatorInstance(id: "Pixel_API_24", name: "Pixel_API_24", apiLevel: 24), to: "Pixel_API_24_Renamed")

        let oldINI = tempDirectory.appendingPathComponent("Pixel_API_24.ini")
        let oldDirectory = tempDirectory.appendingPathComponent("Pixel_API_24.avd")
        let renamedINI = tempDirectory.appendingPathComponent("Pixel_API_24_Renamed.ini")
        let renamedDirectory = tempDirectory.appendingPathComponent("Pixel_API_24_Renamed.avd")

        #expect(!FileManager().fileExists(atPath: oldINI.path))
        #expect(!FileManager().fileExists(atPath: oldDirectory.path))
        #expect(FileManager().fileExists(atPath: renamedINI.path))
        #expect(FileManager().fileExists(atPath: renamedDirectory.path))

        let renamedINIContents = try String(contentsOf: renamedINI)
        #expect(renamedINIContents.contains("path.rel=avd/Pixel_API_24_Renamed.avd"))
        #expect(renamedINIContents.contains("target=android-24"))
    }
}

private let sdkManagerListFixture = """
Installed packages:
  Path                                                                               | Version | Description                                                     | Location
  system-images;android-35;google_apis;arm64-v8a                                     | 9       | Google APIs ARM 64 v8a System Image                             | system-images/android-35/google_apis/arm64-v8a

Available Packages:
  Path                                                                               | Version | Description                                                     | Location
  system-images;android-35;google_apis;arm64-v8a                                     | 9       | Google APIs ARM 64 v8a System Image                             | system-images/android-35/google_apis/arm64-v8a
  system-images;android-36;google_apis_playstore;arm64-v8a                           | 7       | Google Play ARM 64 v8a System Image                             | system-images/android-36/google_apis_playstore/arm64-v8a
"""

private func temporaryAVDRoot() throws -> URL {
    let baseDirectory = FileManager().temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let avdRoot = baseDirectory.appendingPathComponent("avd")
    try FileManager().createDirectory(at: avdRoot, withIntermediateDirectories: true)
    return avdRoot
}

private func temporarySDKRoot() throws -> URL {
    let sdkRoot = FileManager().temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager().createDirectory(at: sdkRoot, withIntermediateDirectories: true)
    return sdkRoot
}

private func createSDKToolchainFixture(at sdkRoot: URL) throws {
    let fileManager = FileManager()
    let relativePaths = [
        "cmdline-tools/latest/bin/sdkmanager",
        "cmdline-tools/latest/bin/avdmanager",
        "emulator/emulator",
        "platform-tools/adb"
    ]

    for relativePath in relativePaths {
        let fileURL = sdkRoot.appendingPathComponent(relativePath)
        try fileManager.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "#!/bin/sh\n".write(to: fileURL, atomically: true, encoding: .utf8)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fileURL.path)
    }
}

private func createAVDFixture(named name: String, at avdRoot: URL, target: String, colorSeed: String? = nil) throws {
    let fileManager = FileManager()
    let directoryURL = avdRoot.appendingPathComponent("\(name).avd")
    try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)

    let iniContents = """
    avd.ini.encoding=UTF-8
    path=\(directoryURL.path)
    path.rel=avd/\(name).avd
    target=\(target)
    """
    try iniContents.write(to: avdRoot.appendingPathComponent("\(name).ini"), atomically: true, encoding: .utf8)

    let configContents = """
    avd.ini.displayname=\(name)
    target=\(target)
    hw.lcd.width=1080
    hw.lcd.height=2400
    \(colorSeed.map { "avdbuddy.color.seed=\($0)" } ?? "")
    """
    try configContents.write(to: directoryURL.appendingPathComponent("config.ini"), atomically: true, encoding: .utf8)
}

final class MockRunner: CommandRunning, @unchecked Sendable {
    var commands: [Command] = []
    var handler: ((Command) -> CommandResult)?

    func run(_ command: Command) throws -> CommandResult {
        commands.append(command)
        if let handler {
            return handler(command)
        }
        return CommandResult(exitCode: 0, stdout: "", stderr: "")
    }
}
