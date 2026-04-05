const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const ARC_USER_DATA = path.join(os.homedir(), 'Library/Application Support/Arc/User Data');

// ─── CLI Flags ───
const args = process.argv.slice(2);
const profileFlag = args.find(a => a.startsWith('--profile='));
const requestedProfile = profileFlag ? profileFlag.split('=')[1] : null;

// ─── Profile Detection ───
function findExtensionDir() {
  if (!fs.existsSync(ARC_USER_DATA)) {
    console.error('Could not find Arc User Data directory.');
    console.error(`  Expected: ${ARC_USER_DATA}`);
    console.error('  Is Arc Browser installed?');
    process.exit(1);
  }

  // If user specified a profile, use it directly
  if (requestedProfile) {
    const extPath = path.join(ARC_USER_DATA, requestedProfile, 'Extensions', EXTENSION_ID);
    if (fs.existsSync(extPath)) {
      console.log(`Using requested profile: ${requestedProfile}`);
      return { profile: requestedProfile, path: extPath };
    }
    console.error(`Claude extension not found in profile "${requestedProfile}".`);
    console.error(`  Checked: ${extPath}`);
    process.exit(1);
  }

  // Auto-detect: read Local State for profile metadata
  let profileNames = [];
  const localStatePath = path.join(ARC_USER_DATA, 'Local State');
  if (fs.existsSync(localStatePath)) {
    try {
      const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      const infoCache = localState.profile?.info_cache || {};
      profileNames = Object.entries(infoCache).map(([name, info]) => ({
        name,
        activeTime: info.active_time || 0,
      }));
      // Sort by most recently active first
      profileNames.sort((a, b) => b.activeTime - a.activeTime);
    } catch (e) {
      console.warn('Could not parse Local State, falling back to directory scan.');
    }
  }

  // Fallback: scan for profile directories directly
  if (profileNames.length === 0) {
    const entries = fs.readdirSync(ARC_USER_DATA).filter(d => {
      return (d === 'Default' || /^Profile \d+$/.test(d)) &&
        fs.statSync(path.join(ARC_USER_DATA, d)).isDirectory();
    });
    profileNames = entries.map(name => ({ name, activeTime: 0 }));
  }

  // Search each profile for the Claude extension
  const found = [];
  const checked = [];
  for (const { name, activeTime } of profileNames) {
    const extPath = path.join(ARC_USER_DATA, name, 'Extensions', EXTENSION_ID);
    checked.push(name);
    if (fs.existsSync(extPath)) {
      found.push({ profile: name, path: extPath, activeTime });
    }
  }

  if (found.length === 0) {
    console.error('Could not find Claude extension in any Arc profile.');
    console.error(`  Profiles checked: ${checked.join(', ')}`);
    console.error('  Is the Claude extension installed from the Chrome Web Store?');
    console.error('  You can also specify a profile manually: node scripts/install.js --profile="Profile 1"');
    process.exit(1);
  }

  if (found.length > 1) {
    console.log(`Found Claude extension in ${found.length} profiles: ${found.map(f => f.profile).join(', ')}`);
    console.log(`Using most recently active: ${found[0].profile}`);
  }

  return found[0];
}

const extInfo = findExtensionDir();
const EXT_BASE_DIR = extInfo.path;
console.log(`Profile: ${extInfo.profile}`);

// Find the latest version folder like 1.0.63_0
const dirs = fs.readdirSync(EXT_BASE_DIR).filter(d =>
  fs.statSync(path.join(EXT_BASE_DIR, d)).isDirectory() && /^\d+\.\d+\.\d+_\d+$/.test(d)
);

if (dirs.length === 0) {
  console.error('No version directories found in the extension folder.');
  console.error(`  Path: ${EXT_BASE_DIR}`);
  process.exit(1);
}

dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
const latestVersion = dirs[dirs.length - 1];
const targetDir = path.join(EXT_BASE_DIR, latestVersion);

console.log(`Extension version: ${latestVersion}`);
console.log(`Extension path: ${targetDir}`);

// Verify expected files exist
const expectedFiles = ['manifest.json', 'service-worker-loader.js', 'sidepanel.html'];
for (const file of expectedFiles) {
  if (!fs.existsSync(path.join(targetDir, file))) {
    console.error(`Expected file "${file}" not found in extension directory.`);
    console.error('The extension structure may have changed. Please open an issue on GitHub.');
    process.exit(1);
  }
}

// ─── Backup ───
const backupDir = targetDir + '_backup';
if (!fs.existsSync(backupDir)) {
  console.log(`Creating backup at ${backupDir}...`);
  execSync(`cp -R "${targetDir}" "${backupDir}"`);
} else {
  console.log('Backup exists. Reverting to clean state before patching...');
  execSync(`rm -rf "${targetDir}"`);
  execSync(`cp -R "${backupDir}" "${targetDir}"`);
}

const srcDir = path.join(__dirname, '..', 'src');

// ─── Copy Custom Scripts ───
console.log('Injecting custom script assets...');
const assetsDir = path.join(targetDir, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

fs.copyFileSync(path.join(srcDir, 'claude-panel-injector.js'), path.join(assetsDir, 'claude-panel-injector.js'));
fs.copyFileSync(path.join(srcDir, 'viewport-override.js'), path.join(assetsDir, 'viewport-override.js'));
fs.copyFileSync(path.join(srcDir, 'zoom-service-worker.js'), path.join(assetsDir, 'zoom-service-worker.js'));
fs.copyFileSync(path.join(srcDir, 'tab-orchestrator.js'), path.join(assetsDir, 'tab-orchestrator.js'));
fs.copyFileSync(path.join(srcDir, 'native-bridge.js'), path.join(assetsDir, 'native-bridge.js'));

// ─── Patch manifest.json ───
console.log('Patching manifest.json...');
const manifestPath = path.join(targetDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

manifest.name = "Claude in Arc v0.1";

// Inject Content Scripts
manifest.content_scripts = manifest.content_scripts || [];
const injectorScript = {
  "matches": ["<all_urls>"],
  "js": ["assets/claude-panel-injector.js"],
  "run_at": "document_idle"
};
const overrideScript = {
  "matches": ["<all_urls>"],
  "js": ["assets/viewport-override.js"],
  "run_at": "document_start",
  "world": "MAIN"
};

const existingScripts = manifest.content_scripts.map(c => c.js && c.js[0]);
if (!existingScripts.includes("assets/claude-panel-injector.js")) manifest.content_scripts.push(injectorScript);
if (!existingScripts.includes("assets/viewport-override.js")) manifest.content_scripts.push(overrideScript);

// Add Permissions if needed
manifest.permissions = manifest.permissions || [];
if (!manifest.permissions.includes("scripting")) manifest.permissions.push("scripting");
if (!manifest.permissions.includes("tabs")) manifest.permissions.push("tabs");
if (!manifest.permissions.includes("tabGroups")) manifest.permissions.push("tabGroups");
if (!manifest.permissions.includes("nativeMessaging")) manifest.permissions.push("nativeMessaging");

// Add web_accessible_resources
manifest.web_accessible_resources = manifest.web_accessible_resources || [];
const warFound = manifest.web_accessible_resources.find(war => war.resources && war.resources.includes("sidepanel.html"));
if (!warFound) {
  manifest.web_accessible_resources.push({
    "matches": ["<all_urls>"],
    "resources": ["sidepanel.html", "assets/*", "public/*"]
  });
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// ─── Delete _metadata to bypass content verification ───
const metadataDir = path.join(targetDir, '_metadata');
if (fs.existsSync(metadataDir)) {
  fs.rmSync(metadataDir, { recursive: true });
  console.log('Removed _metadata (bypasses content verification for patched files).');
}

// ─── Patch service-worker-loader.js ───
console.log('Patching service-worker-loader.js...');
const swLoaderPath = path.join(targetDir, 'service-worker-loader.js');
if (fs.existsSync(swLoaderPath)) {
  let swLoader = fs.readFileSync(swLoaderPath, 'utf8');
  if (!swLoader.includes('zoom-service-worker.js')) {
    swLoader += "\nimport './assets/zoom-service-worker.js';\n";
  }
  if (!swLoader.includes('tab-orchestrator.js')) {
    swLoader += "import './assets/tab-orchestrator.js';\n";
  }
  if (!swLoader.includes('native-bridge.js')) {
    swLoader += "import './assets/native-bridge.js';\n";
  }
  fs.writeFileSync(swLoaderPath, swLoader);
} else {
  console.error('service-worker-loader.js not found! The background script structure may have changed.');
}

// ─── Patch sidepanel.html ───
console.log('Patching sidepanel.html for Cmd+E fix...');
const sidepanelPath = path.join(targetDir, 'sidepanel.html');
if (fs.existsSync(sidepanelPath)) {
  const fallbackJsContent = `
document.addEventListener("keydown", (e) => {
  const modifier = navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
  if (modifier && e.key.toLowerCase() === "e") {
    e.preventDefault();
    window.parent.postMessage({ type: "CLAUDE_ARC_TOGGLE_PANEL" }, "*");
  }
}, true);
`;
  fs.writeFileSync(path.join(assetsDir, 'cmd-e-fallback.js'), fallbackJsContent);

  let sidepanelHtml = fs.readFileSync(sidepanelPath, 'utf8');

  // Extract inline script to separate file for CSP compliance
  const inlineScriptMatch = sidepanelHtml.match(/<script>\s*\/\/(?:.|\n)*?<\/script>/i);
  if (inlineScriptMatch) {
    const scriptContent = inlineScriptMatch[0].replace('<script>', '').replace('</script>', '');
    fs.writeFileSync(path.join(assetsDir, 'theme-init.js'), scriptContent);
    sidepanelHtml = sidepanelHtml.replace(inlineScriptMatch[0], '<script src="/assets/theme-init.js"></script>');
  }

  const fallbackScript = `
    <!-- Arc Cmd+E Fallback for injected iframe focus -->
    <script src="/assets/cmd-e-fallback.js"></script>
  </body>`;

  if (!sidepanelHtml.includes('Arc Cmd+E Fallback')) {
    sidepanelHtml = sidepanelHtml.replace('</body>', fallbackScript);
  }
  fs.writeFileSync(sidepanelPath, sidepanelHtml);
} else {
  console.error('sidepanel.html not found!');
}

console.log('');
console.log('Patch completed successfully!');
console.log('');
console.log('Next steps:');
console.log('  1. Open arc://extensions in Arc');
console.log('  2. Find "Claude in Arc v0.1" and click Reload');
console.log('  3. Refresh any open tabs');
console.log('  4. Use Cmd+E or the extension icon to toggle the panel');
