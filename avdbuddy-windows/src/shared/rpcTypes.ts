import type { RPCSchema, ElectrobunRPCSchema } from "electrobun/bun";

export interface AppRPCSchema extends ElectrobunRPCSchema {
  bun: RPCSchema<{
    requests: {
      getToolchainStatus: {
        params: Record<string, never>;
        response: unknown;
      };
      updateSDKPath: {
        params: { path: string | null };
        response: unknown;
      };
      getAutodetectedSDKPath: {
        params: Record<string, never>;
        response: string | null;
      };
      refreshEmulators: {
        params: Record<string, never>;
        response: unknown[];
      };
      getRunningEmulators: {
        params: Record<string, never>;
        response: string[];
      };
      launchEmulator: {
        params: { name: string };
        response: string;
      };
      stopEmulator: {
        params: { name: string };
        response: string;
      };
      deleteEmulator: {
        params: { name: string };
        response: string;
      };
      duplicateEmulator: {
        params: { name: string };
        response: string;
      };
      renameEmulator: {
        params: { oldName: string; newName: string };
        response: string;
      };
      getVersionFamilies: {
        params: { deviceType: string };
        response: unknown[];
      };
      getAvailableGoogleServices: {
        params: {
          versionIdentifier: string;
          deviceType: string;
        };
        response: string[];
      };
      getAvailableArchitectures: {
        params: {
          versionIdentifier: string;
          deviceType: string;
          googleServices: string;
        };
        response: string[];
      };
      getDeviceProfiles: {
        params: { deviceType: string };
        response: unknown[];
      };
      suggestName: {
        params: Record<string, never>;
        response: string;
      };
      createAVD: {
        params: { config: unknown };
        response: { success: boolean; output: string };
      };
      validateNewName: {
        params: { name: string };
        response: string | null;
      };
      validateRenameName: {
        params: { currentName: string; newName: string };
        response: string | null;
      };
    };
    messages: {
      createProgress: { output: string };
    };
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
}
