import { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  getToolchainStatus,
  getAutodetectedSDKPath,
  updateSDKPath,
  invalidateImageCache,
  refreshEmulators,
  getRunningEmulators,
  launchEmulator,
  stopEmulator,
  deleteEmulator,
  duplicateEmulator,
  renameEmulator,
  getVersionFamilies,
  createAVD,
  loadSystemImages,
  validateNewName,
  validateRenameName,
} from "./services/emulatorManager.ts";
import { autoSetupAndroidSDK } from "./services/androidSdkInstaller.ts";
import { getProfileOptions, randomSuggestedName } from "./models/deviceProfiles.ts";
import {
  availableGoogleServiceOptions,
  availableArchitectures,
} from "./services/systemImageCatalog.ts";
import type { CreateAVDDeviceType, GoogleServicesOption } from "./models/types.ts";

const DEBUG_LOG_PATH = "/opt/cursor/logs/debug.log";

function errorData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split(/\r?\n/).slice(0, 8),
    };
  }
  return {
    message: String(error),
  };
}

function writeDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  const entry = {
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  try {
    mkdirSync(dirname(DEBUG_LOG_PATH), { recursive: true });
    appendFileSync(DEBUG_LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {
    // Debug logging must never break app startup.
  }
  try {
    console.error("[AvdBuddyDebug]", JSON.stringify(entry));
  } catch {
    // Ignore console serialization issues.
  }
}

// #region agent log
writeDebugLog("A", "bun/index.ts:startup", "Main process bootstrap started", {
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
});
// #endregion

process.on("uncaughtException", (error) => {
  // #region agent log
  writeDebugLog("A", "bun/index.ts:uncaughtException", "Uncaught exception reached main process", errorData(error));
  // #endregion
});

process.on("unhandledRejection", (reason) => {
  // #region agent log
  writeDebugLog("B", "bun/index.ts:unhandledRejection", "Unhandled promise rejection reached main process", errorData(reason));
  // #endregion
});

const rpc = defineElectrobunRPC("bun" as const, {
  handlers: {
    requests: {
      getToolchainStatus: () => getToolchainStatus(),
      updateSDKPath: ({ path }: any) => updateSDKPath(path),
      autoSetupSDK: async ({ path }: any) => {
        const result = await autoSetupAndroidSDK(path, (chunk: string) => {
          try {
            (rpc as any).send?.sdkSetupProgress?.({ output: chunk });
          } catch {
            // view not ready
          }
        });
        invalidateImageCache();
        return {
          ...result,
          status: updateSDKPath(result.sdkPath),
        };
      },
      getAutodetectedSDKPath: () => getAutodetectedSDKPath(),
      refreshEmulators: async () => {
        const emulators = refreshEmulators();
        try {
          const running = await getRunningEmulators();
          return emulators.map((e) => ({
            ...e,
            isRunning: running.has(e.name),
          }));
        } catch {
          return emulators;
        }
      },
      getRunningEmulators: async () => {
        const running = await getRunningEmulators();
        return [...running];
      },
      launchEmulator: async ({ name }: any) => await launchEmulator(name),
      stopEmulator: async ({ name }: any) => await stopEmulator(name),
      deleteEmulator: async ({ name }: any) => await deleteEmulator(name),
      duplicateEmulator: ({ name }: any) => duplicateEmulator(name),
      renameEmulator: ({ oldName, newName }: any) =>
        renameEmulator(oldName, newName),
      getVersionFamilies: async ({ deviceType }: any) =>
        await getVersionFamilies(deviceType as CreateAVDDeviceType),
      getAvailableGoogleServices: async ({
        versionIdentifier,
        deviceType,
      }: any) => {
        const images = await loadSystemImages();
        const filtered = images.filter(
          (i) => i.versionIdentifier === versionIdentifier
        );
        if (filtered.length === 0) return [];
        return availableGoogleServiceOptions(
          {
            versionIdentifier,
            title: "",
            subtitle: null,
            images: filtered,
            isPreview: false,
            installedCount: 0,
          },
          deviceType as CreateAVDDeviceType
        );
      },
      getAvailableArchitectures: async ({
        versionIdentifier,
        deviceType,
        googleServices,
      }: any) => {
        const images = await loadSystemImages();
        const filtered = images.filter(
          (i) => i.versionIdentifier === versionIdentifier
        );
        if (filtered.length === 0) return [];
        return availableArchitectures(
          {
            versionIdentifier,
            title: "",
            subtitle: null,
            images: filtered,
            isPreview: false,
            installedCount: 0,
          },
          deviceType as CreateAVDDeviceType,
          googleServices as GoogleServicesOption
        );
      },
      getDeviceProfiles: ({ deviceType }: any) =>
        getProfileOptions(deviceType as CreateAVDDeviceType),
      suggestName: () => randomSuggestedName(),
      createAVD: async ({ config }: any) => {
        // #region agent log
        writeDebugLog("D", "bun/index.ts:createAVD.entry", "RPC createAVD started", {
          avdName: config?.avdName ?? null,
          packagePath: config?.packagePath ?? null,
          deviceProfileID: config?.deviceProfileID ?? null,
        });
        // #endregion
        try {
          return await createAVD(config, (chunk: string) => {
            try {
              (rpc as any).send?.createProgress?.({ output: chunk });
            } catch {
              // view not ready
            }
          });
        } catch (error) {
          // #region agent log
          writeDebugLog("D", "bun/index.ts:createAVD.error", "RPC createAVD threw", {
            avdName: config?.avdName ?? null,
            packagePath: config?.packagePath ?? null,
            ...errorData(error),
          });
          // #endregion
          return {
            success: false,
            output:
              error instanceof Error
                ? error.message
                : String(error),
          };
        }
      },
      validateNewName: ({ name }: any) => validateNewName(name),
      validateRenameName: ({ currentName, newName }: any) =>
        validateRenameName(currentName, newName),
    } as any,
    messages: {},
  },
} as any);

const mainWindow = new BrowserWindow({
  title: "AvdBuddy",
  url: "views://mainview/index.html",
  frame: {
    width: 1100,
    height: 750,
    x: 150,
    y: 100,
  },
  rpc,
});

// #region agent log
writeDebugLog("C", "bun/index.ts:mainWindow.created", "Main window created", {
  windowId: mainWindow.id,
  webviewId: mainWindow.webviewId,
  url: "views://mainview/index.html",
});
// #endregion

mainWindow.on("close", () => {
  // #region agent log
  writeDebugLog("C", "bun/index.ts:mainWindow.close", "Main window close event fired", {
    windowId: mainWindow.id,
    webviewId: mainWindow.webviewId,
  });
  // #endregion
});

mainWindow.webview.on("dom-ready", () => {
  // #region agent log
  writeDebugLog("C", "bun/index.ts:webview.domReady", "Main window webview reached dom-ready", {
    windowId: mainWindow.id,
    webviewId: mainWindow.webviewId,
  });
  // #endregion
});

console.log("AvdBuddy started!");
