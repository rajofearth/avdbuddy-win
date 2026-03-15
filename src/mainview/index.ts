import { Electroview } from "electrobun/view";

interface EmulatorInstance {
  id: string;
  name: string;
  apiLevel: number | null;
  deviceType: string;
  colorSeed: string;
  isRunning: boolean;
  isDeleting: boolean;
}

interface VersionFamily {
  id: string;
  title: string;
  subtitle: string | null;
  releases: VersionRelease[];
  defaultReleaseIdentifier: string | null;
}

interface VersionRelease {
  versionIdentifier: string;
  title: string;
  subtitle: string | null;
  images: unknown[];
  isPreview: boolean;
  installedCount: number;
}

type DeviceType = "phone" | "foldable" | "tablet" | "wearOS" | "desktop" | "tv" | "automotive" | "xr";

const DEVICE_TYPES: { id: DeviceType; label: string; icon: string }[] = [
  { id: "phone", label: "Phone", icon: "📱" },
  { id: "foldable", label: "Foldable", icon: "📖" },
  { id: "tablet", label: "Tablet", icon: "📲" },
  { id: "wearOS", label: "Wear OS", icon: "⌚" },
  { id: "desktop", label: "Desktop", icon: "🖥️" },
  { id: "tv", label: "TV", icon: "📺" },
  { id: "automotive", label: "Automotive", icon: "🚗" },
  { id: "xr", label: "XR", icon: "🥽" },
];

const DEVICE_TYPE_ICONS: Record<string, string> = {
  phone: "📱", tablet: "📲", foldable: "📖", wearOS: "⌚",
  desktop: "🖥️", tv: "📺", automotive: "🚗", xr: "🥽", unknown: "📱",
};

const API_NAMES: Record<number, string> = {
  36: "Android 16", 35: "Android 15", 34: "Android 14", 33: "Android 13",
  32: "Android 12L", 31: "Android 12", 30: "Android 11", 29: "Android 10",
  28: "Android 9", 27: "Android 8.1", 26: "Android 8.0", 25: "Android 7.1",
  24: "Android 7.0",
};

const TOOL_LABELS: Record<string, string> = {
  java: "Java 17+",
  sdkManager: "sdkmanager",
  avdManager: "avdmanager",
  emulator: "emulator",
  adb: "adb",
};

const GRADIENT_PALETTES = [
  ["#667eea", "#764ba2"], ["#f093fb", "#f5576c"], ["#4facfe", "#00f2fe"],
  ["#43e97b", "#38f9d7"], ["#fa709a", "#fee140"], ["#a18cd1", "#fbc2eb"],
  ["#fccb90", "#d57eeb"], ["#e0c3fc", "#8ec5fc"], ["#f5576c", "#ff9a9e"],
  ["#667eea", "#43e97b"], ["#48c6ef", "#6f86d6"], ["#feada6", "#f5efef"],
];

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function getGradient(seed: string): string[] {
  return GRADIENT_PALETTES[hashCode(seed) % GRADIENT_PALETTES.length]!;
}

function detailText(em: EmulatorInstance): string {
  if (!em.apiLevel) return "Unknown";
  const name = API_NAMES[em.apiLevel] ?? `API ${em.apiLevel}`;
  return `${name} · API ${em.apiLevel}`;
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

let emulators: EmulatorInstance[] = [];
let selectedNames = new Set<string>();
let contextTarget: string | null = null;
let wizardStep = 0;
let wizardDeviceType: DeviceType = "phone";
let wizardName = "";
let wizardFamilies: VersionFamily[] = [];
let wizardSelectedFamilyID: string | null = null;
let wizardSelectedVersionID: string | null = null;
let isCreating = false;
let isSDKSetupRunning = false;

const rpcConfig = Electroview.defineRPC({
  maxRequestTime: Infinity,
  handlers: {
    requests: {},
    messages: {
      createProgress: ({ output }: { output: string }) => {
        const el = document.getElementById("create-output");
        if (el) { el.textContent += output; el.scrollTop = el.scrollHeight; }
      },
      sdkSetupProgress: ({ output }: { output: string }) => {
        appendSDKSetupOutput(output);
      },
    },
  },
} as any);

const electroview = new Electroview({ rpc: rpcConfig });
const rpc = (electroview as any).rpc;

async function init() {
  setupEventListeners();
  await loadEmulators();
  startPolling();
}

async function loadEmulators() {
  try {
    emulators = await rpc.request.refreshEmulators({});
    renderEmulators();
  } catch (e: any) {
    console.error("Failed to load emulators:", e);
  }
}

function renderEmulators() {
  const grid = document.getElementById("emulator-grid")!;
  const empty = document.getElementById("empty-state")!;
  const count = document.getElementById("emulator-count")!;

  if (emulators.length === 0) {
    grid.classList.add("hidden");
    empty.classList.remove("hidden");
    count.textContent = "";
    return;
  }

  empty.classList.add("hidden");
  grid.classList.remove("hidden");
  count.textContent = `${emulators.length} emulator${emulators.length === 1 ? "" : "s"}`;

  grid.innerHTML = emulators.map((em) => {
    const [c1, c2] = getGradient(em.colorSeed || em.name);
    const icon = DEVICE_TYPE_ICONS[em.deviceType] || "📱";
    const cls = ["emulator-card", selectedNames.has(em.name) ? "selected" : "", em.isDeleting ? "deleting" : ""].filter(Boolean).join(" ");

    return `<div class="${cls}" data-name="${em.name}">
      <div class="card-artwork" style="background:linear-gradient(135deg,${c1},${c2})">
        <div class="card-icon">${em.isRunning ? "⚡" : icon}</div>
        ${em.isRunning ? '<div class="card-running-badge"><span class="running-dot"></span>Running</div>' : ""}
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(em.name)}</div>
        <div class="card-detail">${detailText(em)}</div>
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll<HTMLElement>(".emulator-card").forEach((card) => {
    const name = card.dataset["name"]!;
    card.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (selectedNames.has(name)) selectedNames.delete(name); else selectedNames.add(name);
      } else selectedNames = new Set([name]);
      renderEmulators();
    });
    card.addEventListener("dblclick", async () => {
      const em = emulators.find((e) => e.name === name);
      if (!em || em.isRunning) return;
      try { await rpc.request.launchEmulator({ name }); await loadEmulators(); }
      catch (e: any) { showStatus(`Launch failed: ${e}`, "error"); }
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      contextTarget = name;
      showContextMenu(e.clientX, e.clientY, emulators.find((em) => em.name === name)!);
    });
  });
}

function showContextMenu(x: number, y: number, em: EmulatorInstance) {
  const menu = document.getElementById("context-menu")!;
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
  const launchBtn = menu.querySelector('[data-action="launch"]') as HTMLButtonElement;
  const stopBtn = menu.querySelector('[data-action="stop"]') as HTMLButtonElement;
  launchBtn.disabled = em.isRunning;
  stopBtn.disabled = !em.isRunning;
  launchBtn.classList.toggle("hidden", em.isRunning);
  stopBtn.classList.toggle("hidden", !em.isRunning);
}

function hideContextMenu() { document.getElementById("context-menu")!.classList.add("hidden"); }

function showStatus(message: string, type: "info" | "error" | "success" = "info") {
  const banner = document.getElementById("status-banner")!;
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 4000);
}

function showModal(id: string) { document.getElementById(id)!.classList.remove("hidden"); }
function hideModal(id: string) { document.getElementById(id)!.classList.add("hidden"); }

function appendSDKSetupOutput(output: string) {
  const el = document.getElementById("sdk-setup-output");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent += output;
  el.scrollTop = el.scrollHeight;
}

function clearSDKSetupOutput() {
  const el = document.getElementById("sdk-setup-output");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function setSDKSetupBusy(isBusy: boolean) {
  isSDKSetupRunning = isBusy;
  const buttonIDs = ["btn-auto-setup-sdk", "btn-save-sdk", "btn-detect-sdk"];
  for (const id of buttonIDs) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = isBusy;
  }

  const pathInput = document.getElementById("sdk-path-input") as HTMLInputElement | null;
  if (pathInput) pathInput.disabled = isBusy;

  document.querySelectorAll<HTMLButtonElement>("#sdk-modal [data-close]").forEach((button) => {
    button.disabled = isBusy;
  });
}

function renderSDKStatus(status: any) {
  (document.getElementById("sdk-path-input") as HTMLInputElement).value = status.sdkPath;
  renderToolStates(status.toolStates);
  document.getElementById("sdk-status-message")!.textContent = status.summary;
}

function setupEventListeners() {
  document.getElementById("btn-refresh")!.addEventListener("click", loadEmulators);
  document.getElementById("btn-settings")!.addEventListener("click", openSDKSetup);
  document.getElementById("btn-create")!.addEventListener("click", openCreateWizard);
  document.getElementById("btn-create-empty")!.addEventListener("click", openCreateWizard);

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetID = (btn as HTMLElement).dataset["close"]!;
      if (targetID === "sdk-modal" && isSDKSetupRunning) {
        showStatus("Wait for Android SDK setup to finish.", "info");
        return;
      }
      hideModal(targetID);
    });
  });

  document.addEventListener("click", (e) => {
    if (!document.getElementById("context-menu")!.contains(e.target as Node)) hideContextMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
      if (!isCreating && !isSDKSetupRunning) {
        document.querySelectorAll(".modal-overlay:not(.hidden)").forEach((m) => hideModal(m.id));
      }
    }
    if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      selectedNames = new Set(emulators.map((e) => e.name));
      renderEmulators();
    }
    if (e.key === "Delete" && selectedNames.size > 0) confirmDelete([...selectedNames]);
  });

  document.querySelectorAll(".context-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = (item as HTMLElement).dataset["action"]!;
      if (contextTarget) handleContextAction(action, contextTarget);
      hideContextMenu();
    });
  });

  document.getElementById("btn-save-sdk")!.addEventListener("click", saveSDKPath);
  document.getElementById("btn-detect-sdk")!.addEventListener("click", detectSDKPath);
  document.getElementById("btn-auto-setup-sdk")!.addEventListener("click", autoSetupSDK);
  document.getElementById("btn-suggest-name")!.addEventListener("click", suggestName);
  document.getElementById("btn-wizard-next")!.addEventListener("click", wizardNext);
  document.getElementById("btn-wizard-back")!.addEventListener("click", wizardBack);
  document.getElementById("btn-rename-confirm")!.addEventListener("click", doRename);
  document.getElementById("btn-delete-confirm")!.addEventListener("click", doDelete);

  document.getElementById("main-content")!.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".emulator-card") && (target.id === "main-content" || target.id === "emulator-grid" || target.closest("#main-content"))) {
      if (!target.closest(".emulator-card")) { selectedNames.clear(); renderEmulators(); }
    }
  });
}

async function handleContextAction(action: string, name: string) {
  try {
    switch (action) {
      case "launch": await rpc.request.launchEmulator({ name }); showStatus(`Launched ${name}.`, "success"); break;
      case "stop": await rpc.request.stopEmulator({ name }); showStatus(`Stopped ${name}.`, "success"); break;
      case "duplicate": { const n = await rpc.request.duplicateEmulator({ name }); showStatus(`Duplicated as ${n}.`, "success"); break; }
      case "rename": openRenameModal(name); return;
      case "delete": confirmDelete([name]); return;
    }
    await loadEmulators();
  } catch (e: any) { showStatus(`${action} failed: ${e}`, "error"); }
}

async function openSDKSetup() {
  showModal("sdk-modal");
  try {
    const status = await rpc.request.getToolchainStatus({});
    renderSDKStatus(status);
    if (!isSDKSetupRunning) clearSDKSetupOutput();
  } catch (e: any) { console.error("Failed to load SDK status:", e); }
}

function renderToolStates(states: any[]) {
  document.getElementById("sdk-tool-list")!.innerHTML = states.map((s: any) => {
    const ok = s.validationStatus.kind === "available";
    const issue = s.validationStatus.kind === "missing" ? "Not found" : s.validationStatus.kind === "unsupported" ? s.validationStatus.message : "";
    const label = TOOL_LABELS[s.tool] ?? s.tool;
    return `<div class="tool-item">
      <span class="tool-status ${ok ? "ok" : "error"}">${ok ? "✓" : "✗"}</span>
      <span class="tool-name">${label}</span>
      ${issue ? `<span class="tool-issue">${escapeHtml(issue)}</span>` : ""}
    </div>`;
  }).join("");
}

async function saveSDKPath() {
  const path = (document.getElementById("sdk-path-input") as HTMLInputElement).value.trim();
  try {
    const status = await rpc.request.updateSDKPath({ path: path || null });
    renderSDKStatus(status);
    if (status.isConfigured) { hideModal("sdk-modal"); showStatus("Android SDK configured.", "success"); await loadEmulators(); }
  } catch (e: any) { showStatus(`Failed: ${e}`, "error"); }
}

async function detectSDKPath() {
  try {
    const path = await rpc.request.getAutodetectedSDKPath({});
    if (path) (document.getElementById("sdk-path-input") as HTMLInputElement).value = path;
    else showStatus("Could not detect SDK path.", "info");
  } catch (e: any) { showStatus(`Detection failed: ${e}`, "error"); }
}

async function autoSetupSDK() {
  if (isSDKSetupRunning) return;

  clearSDKSetupOutput();
  appendSDKSetupOutput("Starting Android SDK setup...\n");
  setSDKSetupBusy(true);

  const path = (document.getElementById("sdk-path-input") as HTMLInputElement).value.trim();
  try {
    const result = await rpc.request.autoSetupSDK({ path: path || null });
    renderSDKStatus(result.status);
    showStatus("Android SDK installed and configured.", "success");
    await loadEmulators();
  } catch (e: any) {
    const message = e?.message ?? String(e);
    document.getElementById("sdk-status-message")!.textContent = message;
    appendSDKSetupOutput(`\nError: ${message}\n`);
    showStatus(`Auto setup failed: ${message}`, "error");
  } finally {
    setSDKSetupBusy(false);
  }
}

async function openCreateWizard() {
  wizardStep = 0; wizardDeviceType = "phone"; wizardName = ""; wizardFamilies = [];
  wizardSelectedFamilyID = null; wizardSelectedVersionID = null; isCreating = false;
  showModal("create-modal");
  renderWizardStep(); renderDeviceTypes();
}

function renderWizardStep() {
  ["step-device-type","step-name","step-version","step-customize","step-creating"].forEach((id, i) => {
    document.getElementById(id)!.classList.toggle("hidden", i !== wizardStep);
  });
  document.querySelectorAll(".step-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === Math.min(wizardStep, 3));
    dot.classList.toggle("completed", i < wizardStep);
  });
  const backBtn = document.getElementById("btn-wizard-back")!;
  const nextBtn = document.getElementById("btn-wizard-next")!;
  backBtn.classList.toggle("hidden", wizardStep === 0 || wizardStep === 4);
  nextBtn.textContent = wizardStep === 3 ? "Create" : "Next";
  nextBtn.classList.toggle("hidden", wizardStep === 4);
  if (wizardStep === 3) loadCustomizationOptions();
}

function renderDeviceTypes() {
  const grid = document.getElementById("device-type-grid")!;
  grid.innerHTML = DEVICE_TYPES.map((dt) =>
    `<button class="device-type-btn ${dt.id === wizardDeviceType ? "selected" : ""}" data-type="${dt.id}">
      <span class="device-type-icon">${dt.icon}</span><span>${dt.label}</span>
    </button>`
  ).join("");
  grid.querySelectorAll<HTMLElement>(".device-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => { wizardDeviceType = btn.dataset["type"] as DeviceType; renderDeviceTypes(); });
  });
}

async function suggestName() {
  try {
    wizardName = await rpc.request.suggestName({});
    (document.getElementById("avd-name-input") as HTMLInputElement).value = wizardName;
    document.getElementById("name-validation")!.textContent = "";
  } catch { /* ignore */ }
}

async function loadVersionFamilies() {
  const container = document.getElementById("version-families")!;
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
  document.getElementById("version-releases")!.innerHTML = "";
  try {
    wizardFamilies = await rpc.request.getVersionFamilies({ deviceType: wizardDeviceType });
    renderVersionFamilies();
  } catch (e: any) {
    container.innerHTML = `<div style="padding:14px;color:var(--danger)">Failed to load: ${e}</div>`;
  }
}

function renderVersionFamilies() {
  const container = document.getElementById("version-families")!;
  if (wizardFamilies.length === 0) { container.innerHTML = '<div style="padding:14px;color:var(--text-secondary)">No versions available</div>'; return; }
  if (!wizardSelectedFamilyID) wizardSelectedFamilyID = wizardFamilies[0]!.id;

  container.innerHTML = wizardFamilies.map((f) =>
    `<div class="version-family-item ${f.id === wizardSelectedFamilyID ? "selected" : ""}" data-id="${f.id}">
      <div class="version-family-title">${escapeHtml(f.title)}</div>
      ${f.subtitle ? `<div class="version-family-subtitle">${escapeHtml(f.subtitle)}</div>` : ""}
    </div>`
  ).join("");

  container.querySelectorAll<HTMLElement>(".version-family-item").forEach((item) => {
    item.addEventListener("click", () => {
      wizardSelectedFamilyID = item.dataset["id"]!;
      wizardSelectedVersionID = null;
      renderVersionFamilies();
      renderVersionReleases();
    });
  });
  renderVersionReleases();
}

function renderVersionReleases() {
  const container = document.getElementById("version-releases")!;
  const family = wizardFamilies.find((f) => f.id === wizardSelectedFamilyID);
  if (!family) { container.innerHTML = ""; return; }
  if (!wizardSelectedVersionID && family.defaultReleaseIdentifier) wizardSelectedVersionID = family.defaultReleaseIdentifier;

  container.innerHTML = family.releases.map((r) =>
    `<div class="version-release-item ${r.versionIdentifier === wizardSelectedVersionID ? "selected" : ""}" data-id="${r.versionIdentifier}">
      <div class="version-release-title">${escapeHtml(r.title)}</div>
      ${r.subtitle ? `<div class="version-release-subtitle">${escapeHtml(r.subtitle)}</div>` : ""}
      ${r.installedCount > 0 ? '<div class="version-release-installed">Installed</div>' : ""}
    </div>`
  ).join("");

  container.querySelectorAll<HTMLElement>(".version-release-item").forEach((item) => {
    item.addEventListener("click", () => { wizardSelectedVersionID = item.dataset["id"]!; renderVersionReleases(); });
  });
}

async function loadCustomizationOptions() {
  try {
    const profiles = await rpc.request.getDeviceProfiles({ deviceType: wizardDeviceType });
    const profileSelect = document.getElementById("select-profile") as HTMLSelectElement;
    profileSelect.innerHTML = profiles.map((p: any) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

    if (wizardSelectedVersionID) {
      const services: string[] = await rpc.request.getAvailableGoogleServices({ versionIdentifier: wizardSelectedVersionID, deviceType: wizardDeviceType });
      const googleSelect = document.getElementById("select-google") as HTMLSelectElement;
      const labels: Record<string, string> = { none: "No Google services", googleAPIs: "Google APIs", googlePlay: "Google Play" };
      googleSelect.innerHTML = services.map((s) => `<option value="${s}">${labels[s] ?? s}</option>`).join("");
      if (services.length > 0) {
        googleSelect.value = services.includes("googlePlay") ? "googlePlay" : services[0]!;
        await loadArchitectures(googleSelect.value);
      }
      googleSelect.onchange = async () => { await loadArchitectures(googleSelect.value); };
    }
  } catch (e: any) { console.error("Failed to load options:", e); }
}

async function loadArchitectures(googleServices: string) {
  if (!wizardSelectedVersionID) return;
  try {
    const archs: string[] = await rpc.request.getAvailableArchitectures({ versionIdentifier: wizardSelectedVersionID, deviceType: wizardDeviceType, googleServices });
    (document.getElementById("select-arch") as HTMLSelectElement).innerHTML = archs.map((a) => `<option value="${a}">${a}</option>`).join("");
  } catch { /* ignore */ }
}

async function wizardNext() {
  if (wizardStep === 0) {
    wizardStep = 1;
    if (!wizardName) { try { wizardName = await rpc.request.suggestName({}); } catch { wizardName = "My_Emulator"; } }
    (document.getElementById("avd-name-input") as HTMLInputElement).value = wizardName;
    renderWizardStep(); return;
  }
  if (wizardStep === 1) {
    wizardName = (document.getElementById("avd-name-input") as HTMLInputElement).value.trim();
    const v = await rpc.request.validateNewName({ name: wizardName });
    document.getElementById("name-validation")!.textContent = v ?? "";
    if (v) return;
    wizardStep = 2; renderWizardStep(); await loadVersionFamilies(); return;
  }
  if (wizardStep === 2) {
    if (!wizardSelectedVersionID) { showStatus("Please select an Android version.", "info"); return; }
    wizardStep = 3; renderWizardStep(); return;
  }
  if (wizardStep === 3) await startCreation();
}

function wizardBack() {
  if (wizardStep > 0 && wizardStep < 4) { wizardStep--; renderWizardStep(); if (wizardStep === 0) renderDeviceTypes(); }
}

async function startCreation() {
  isCreating = true; wizardStep = 4; renderWizardStep();
  document.getElementById("create-output")!.textContent = "";

  const profileSelect = document.getElementById("select-profile") as HTMLSelectElement;
  const googleSelect = document.getElementById("select-google") as HTMLSelectElement;
  const archSelect = document.getElementById("select-arch") as HTMLSelectElement;
  const ramSelect = document.getElementById("select-ram") as HTMLSelectElement;
  const storageSelect = document.getElementById("select-storage") as HTMLSelectElement;
  const sdCardSelect = document.getElementById("select-sdcard") as HTMLSelectElement;
  const frameCheck = document.getElementById("check-device-frame") as HTMLInputElement;

  const ramMap: Record<string, number | null> = { recommended: null, gb2: 2048, gb4: 4096, gb8: 8192 };
  const storageMap: Record<string, string> = { gb8: "8GB", gb16: "16GB", gb32: "32GB", gb64: "64GB" };
  const sdCardMap: Record<string, string | null> = { none: null, gb2: "2048M", gb4: "4096M", gb8: "8192M" };

  const tagMap: Record<string, string> = { none: "default", googleAPIs: "google_apis", googlePlay: "google_apis_playstore" };
  const abiMap: Record<string, string> = { arm64: "arm64-v8a", x86_64: "x86_64", x86: "x86", armv7: "armeabi-v7a" };

  let hash = 0;
  for (let i = 0; i < wizardName.length; i++) hash = (hash * 31 + wizardName.charCodeAt(i)) | 0;

  const config = {
    packagePath: `system-images;${wizardSelectedVersionID};${tagMap[googleSelect.value] ?? googleSelect.value};${abiMap[archSelect.value] ?? archSelect.value}`,
    avdName: wizardName,
    deviceProfileID: profileSelect.value,
    ramMB: ramMap[ramSelect.value] ?? null,
    storage: storageMap[storageSelect.value] ?? "16GB",
    sdCard: sdCardMap[sdCardSelect.value] ?? null,
    showDeviceFrame: frameCheck.checked,
    colorSeed: Math.abs(hash).toString(36),
  };

  try {
    const result = await rpc.request.createAVD({ config });
    if (result.success) {
      showStatus(`Created ${wizardName}.`, "success"); hideModal("create-modal");
      await loadEmulators(); selectedNames = new Set([wizardName]); renderEmulators();
    } else {
      document.getElementById("create-output")!.textContent += `\n\nError: ${result.output}`;
      wizardStep = 3; renderWizardStep(); showStatus(result.output, "error");
    }
  } catch (e: any) { showStatus(`Create failed: ${e}`, "error"); wizardStep = 3; renderWizardStep(); }
  finally { isCreating = false; }
}

let renameTarget: string | null = null;

function openRenameModal(name: string) {
  renameTarget = name;
  (document.getElementById("rename-input") as HTMLInputElement).value = name;
  document.getElementById("rename-validation")!.textContent = "";
  showModal("rename-modal");
}

async function doRename() {
  if (!renameTarget) return;
  const newName = (document.getElementById("rename-input") as HTMLInputElement).value.trim();
  const v = await rpc.request.validateRenameName({ currentName: renameTarget, newName });
  document.getElementById("rename-validation")!.textContent = v ?? "";
  if (v) return;
  try {
    await rpc.request.renameEmulator({ oldName: renameTarget, newName });
    hideModal("rename-modal"); showStatus(`Renamed to ${newName}.`, "success"); await loadEmulators();
  } catch (e: any) { showStatus(`Rename failed: ${e}`, "error"); }
}

let deleteTargets: string[] = [];

function confirmDelete(names: string[]) {
  deleteTargets = names;
  document.getElementById("delete-message")!.textContent = names.length === 1
    ? `Are you sure you want to delete "${names[0]}"?`
    : `Are you sure you want to delete ${names.length} emulators?`;
  showModal("delete-modal");
}

async function doDelete() {
  hideModal("delete-modal");
  for (const name of deleteTargets) {
    try { await rpc.request.deleteEmulator({ name }); showStatus(`Deleted ${name}.`, "success"); }
    catch (e: any) { showStatus(`Delete failed: ${e}`, "error"); }
  }
  selectedNames.clear(); await loadEmulators();
}

function startPolling() {
  setInterval(async () => {
    try {
      const running: string[] = await rpc.request.getRunningEmulators({});
      const runningSet = new Set(running);
      let changed = false;
      for (const em of emulators) {
        const was = em.isRunning;
        em.isRunning = runningSet.has(em.name);
        if (was !== em.isRunning) changed = true;
      }
      if (changed) renderEmulators();
    } catch { /* ignore */ }
  }, 3000);
}

document.addEventListener("DOMContentLoaded", init);
