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

// ─── Find patched extension ───
function findPatchedExtension() {
  if (!fs.existsSync(ARC_USER_DATA)) {
    console.error('Could not find Arc User Data directory.');
    process.exit(1);
  }

  const profiles = requestedProfile
    ? [requestedProfile]
    : fs.readdirSync(ARC_USER_DATA).filter(d =>
        (d === 'Default' || /^Profile \d+$/.test(d)) &&
        fs.statSync(path.join(ARC_USER_DATA, d)).isDirectory()
      );

  for (const profile of profiles) {
    const extPath = path.join(ARC_USER_DATA, profile, 'Extensions', EXTENSION_ID);
    if (!fs.existsSync(extPath)) continue;

    const dirs = fs.readdirSync(extPath).filter(d =>
      fs.statSync(path.join(extPath, d)).isDirectory()
    );

    // Look for a backup directory
    const backupDir = dirs.find(d => d.endsWith('_backup'));
    if (!backupDir) continue;

    const versionName = backupDir.replace('_backup', '');
    const patchedDir = path.join(extPath, versionName);
    const fullBackupDir = path.join(extPath, backupDir);

    if (fs.existsSync(patchedDir) && fs.existsSync(fullBackupDir)) {
      return { profile, patchedDir, backupDir: fullBackupDir, versionName };
    }
  }

  return null;
}

const found = findPatchedExtension();

if (!found) {
  console.log('No patched Claude extension found. Nothing to uninstall.');
  process.exit(0);
}

console.log(`Found patched extension in profile: ${found.profile}`);
console.log(`  Patched: ${found.patchedDir}`);
console.log(`  Backup:  ${found.backupDir}`);
console.log('');
console.log('Restoring from backup...');

execSync(`rm -rf "${found.patchedDir}"`);
execSync(`cp -R "${found.backupDir}" "${found.patchedDir}"`);
execSync(`rm -rf "${found.backupDir}"`);

console.log('Restored original extension successfully.');
console.log('');
console.log('Next steps:');
console.log('  1. Open arc://extensions in Arc');
console.log('  2. Find the Claude extension and click Reload');
console.log('  3. Refresh any open tabs');
