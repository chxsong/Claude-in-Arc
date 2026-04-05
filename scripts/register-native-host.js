/**
 * Registers the Claude Desktop native messaging host for Arc Browser.
 *
 * Chrome auto-discovers native hosts from its own NativeMessagingHosts directory,
 * but Arc requires manual registration in Arc's config directory.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const NATIVE_HOST_NAME = 'com.anthropic.claude_browser_extension';
const NATIVE_HOST_BINARY = '/Applications/Claude.app/Contents/Helpers/chrome-native-host';

// Extension IDs that are allowed to connect
const ALLOWED_ORIGINS = [
  'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/', // Claude in Chrome (Web Store)
  'chrome-extension://dihbgbndebgnbjfmelmegjepbnkhlgni/', // Claude Desktop extension
  'chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf/'  // Claude alternate
];

const ARC_NATIVE_HOSTS_DIR = path.join(
  os.homedir(),
  'Library/Application Support/Arc/NativeMessagingHosts'
);

const CHROME_NATIVE_HOSTS_DIR = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome/NativeMessagingHosts'
);

const manifest = {
  name: NATIVE_HOST_NAME,
  description: 'Claude Browser Extension Native Host',
  path: NATIVE_HOST_BINARY,
  type: 'stdio',
  allowed_origins: ALLOWED_ORIGINS
};

// ─── Pre-flight checks ───

if (!fs.existsSync(NATIVE_HOST_BINARY)) {
  console.error('Claude Desktop native host binary not found.');
  console.error(`  Expected: ${NATIVE_HOST_BINARY}`);
  console.error('  Is Claude Desktop installed? Download from https://claude.ai/download');
  process.exit(1);
}

const manifestJson = JSON.stringify(manifest, null, 2);
const manifestFileName = `${NATIVE_HOST_NAME}.json`;

let registered = 0;

// Register for Arc
if (!fs.existsSync(ARC_NATIVE_HOSTS_DIR)) {
  fs.mkdirSync(ARC_NATIVE_HOSTS_DIR, { recursive: true });
}
const arcManifestPath = path.join(ARC_NATIVE_HOSTS_DIR, manifestFileName);
fs.writeFileSync(arcManifestPath, manifestJson);
console.log(`Registered native host for Arc:`);
console.log(`  ${arcManifestPath}`);
registered++;

// Also register for Chrome if the directory exists
if (fs.existsSync(path.dirname(CHROME_NATIVE_HOSTS_DIR))) {
  if (!fs.existsSync(CHROME_NATIVE_HOSTS_DIR)) {
    fs.mkdirSync(CHROME_NATIVE_HOSTS_DIR, { recursive: true });
  }
  const chromeManifestPath = path.join(CHROME_NATIVE_HOSTS_DIR, manifestFileName);
  // Don't overwrite if it already exists (Claude Desktop may have set it up)
  if (!fs.existsSync(chromeManifestPath)) {
    fs.writeFileSync(chromeManifestPath, manifestJson);
    console.log(`Registered native host for Chrome:`);
    console.log(`  ${chromeManifestPath}`);
    registered++;
  } else {
    console.log('Chrome native host already registered (skipped).');
  }
}

console.log('');
console.log(`Registered in ${registered} browser(s).`);
console.log('Restart Arc for the native host to be detected.');
