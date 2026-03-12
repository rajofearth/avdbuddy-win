# AvdBuddy — Windows / Cross-Platform Edition

A cross-platform desktop app for managing Android Virtual Devices without Android Studio. Built with [Electrobun](https://github.com/blackboardsh/electrobun) (Bun + native web views).

This is the cross-platform companion to the native macOS [AvdBuddy](../README.md) app, sharing the same feature set and clean UI design.

## Features

- Browse existing AVDs with visual gradient cards
- Launch, stop, duplicate, rename, and delete emulators
- Create new AVDs through a guided wizard (device type → name → Android version → customizations)
- Supports all device types: Phone, Foldable, Tablet, Wear OS, Desktop, TV, Automotive, XR
- Android SDK auto-detection plus one-click setup on Linux and Windows
- Running emulator status polling
- Light, minimal UI matching the macOS version

## Requirements

- [Bun](https://bun.sh) runtime
- Java 17 or newer is optional up front; AvdBuddy can install and manage a compatible Java runtime for Linux and Windows during Auto Setup
- Android SDK is optional up front; AvdBuddy can bootstrap the command-line tools and base emulator packages from the SDK setup modal

## Getting Started

```bash
cd avdbuddy-windows
bun install
bun start
```

For hot-reload development:

```bash
bun dev
```

## Project Structure

```
src/
├── bun/                    # Main process (Bun backend)
│   ├── index.ts            # App entry, RPC handlers, window creation
│   ├── models/             # Data types, device profiles, version catalog
│   └── services/           # SDK locator, config parser, emulator manager
├── mainview/               # Browser UI (HTML/CSS/TypeScript)
│   ├── index.html          # App shell with all modals and views
│   ├── index.css           # Light-mode minimal styling
│   └── index.ts            # Frontend logic, state management, RPC calls
└── shared/
    └── rpcTypes.ts          # Shared RPC type definitions
```

## Architecture

- **Backend** (Bun process): Handles all Android SDK interactions via shell commands — locating tools, parsing `sdkmanager --list` output, managing AVD files, reading `config.ini`, and launching emulators.
- **Frontend** (WebView): Renders the UI using vanilla HTML/CSS/TypeScript with card-based emulator grid, modal dialogs (SDK setup, create wizard, rename, delete), and context menus.
- **RPC**: Electrobun's typed RPC bridges the Bun backend and browser frontend, enabling the UI to call backend functions and receive streaming create progress.

## License

[MIT](../LICENSE)
