import { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
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
      createAVD: async ({ config }: any) =>
        await createAVD(config, (chunk: string) => {
          try {
            (rpc as any).send?.createProgress?.({ output: chunk });
          } catch {
            // view not ready
          }
        }),
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

console.log("AvdBuddy started!");
