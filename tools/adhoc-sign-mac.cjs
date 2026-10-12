// Universal merging changes Mach-O binaries. Re-sign locally so Apple Silicon
// can execute them. Ad-hoc signing is NOT Developer ID signing or notarization.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', [
    '--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', appPath,
  ], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
