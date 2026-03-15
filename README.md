# AvdBuddy

![AvdBuddy](./avdbuddy.jpg)

AvdBuddy is a desktop app for managing Android Virtual Devices on Windows and Linux without going through Android Studio.

It focuses on the common emulator workflow:
- browse your existing AVDs from a visual home screen
- launch an emulator with a double click
- create new AVDs through a guided wizard
- duplicate, rename, and delete AVDs
- download Android system images and required SDK packages when needed

## What It Does

AvdBuddy reads your Android SDK and local AVD setup, then gives you a faster UI for:
- viewing all AVDs in one place
- distinguishing them visually with stable per-device gradients
- creating phones, tablets, foldables, TVs, Wear OS, desktop, automotive, and XR emulators
- selecting Android versions, variants, architecture, storage, RAM, SD card, and Google Play services options

## Platform Support

AvdBuddy is intended for:
- Windows
- Linux

## Requirements

To build and run AvdBuddy from source, you need:
- [Bun](https://bun.sh)
- Java 17 or newer

Android SDK setup is optional up front. AvdBuddy can help bootstrap the command-line tools and base emulator packages from inside the app.

To use AvdBuddy with Android emulators, you ultimately need:
- Android SDK command-line tools
- `avdmanager`
- `sdkmanager`
- Android Emulator
- `adb`

AvdBuddy looks for the SDK in:
- `ANDROID_SDK_ROOT`
- `ANDROID_HOME`
- on Windows: `%LOCALAPPDATA%\Android\Sdk`
- on Linux: `~/Android/Sdk`
- on Linux: `~/Android/sdk`

It reads AVDs from the standard Android user configuration location for your platform.

## Getting Started

Install dependencies:

```/dev/null/README.md#L1-3
bun install
```

Start the app in development mode:

```/dev/null/README.md#L1-3
bun start
```

For hot reload development:

```/dev/null/README.md#L1-3
bun dev
```

## Development

Run the type checker:

```/dev/null/README.md#L1-3
bun run typecheck
```

Run the test suite:

```/dev/null/README.md#L1-3
bun test
```

Build the desktop app:

```/dev/null/README.md#L1-3
bun run build
```

## Project Structure

```/dev/null/tree.txt#L1-13
src/
├── bun/                    # Main process (Bun backend)
│   ├── index.ts            # App entry, RPC handlers, window creation
│   ├── models/             # Data types, device profiles, version catalog
│   └── services/           # SDK locator, config parser, emulator manager
├── mainview/               # Browser UI (HTML/CSS/TypeScript)
│   ├── index.html          # App shell with modals and views
│   ├── index.css           # App styling
│   └── index.ts            # Frontend logic, state management, RPC calls
└── shared/
    └── rpcTypes.ts         # Shared RPC type definitions

tests/                      # Bun test suite
```

## Architecture

- **Backend**: the Bun process handles Android SDK interactions, including locating tools, parsing `sdkmanager --list` output, managing AVD files, reading `config.ini`, and launching emulators.
- **Frontend**: the native webview UI is built with HTML, CSS, and TypeScript.
- **RPC**: typed RPC connects the Bun backend and the webview frontend, including support for streaming progress updates during SDK setup and AVD creation.

## License

[MIT](./LICENSE)