const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('================================================');
console.log('       TimeGuard Agent Uninstaller');
console.log('================================================\n');

console.log('Press any key to begin uninstallation...');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.once('data', () => {
  process.stdin.setRawMode(false);
  
  console.log('\nStarting uninstallation process...\n');

  // 1. Stop Watchdog
  try {
    console.log('[1/4] Stopping Watchdog services...');
    execSync('wmic process where "name=\'wscript.exe\' and commandline like \'%watchdog.vbs%\'" call terminate', { stdio: 'ignore' });
  } catch (e) {}

  // 2. Stop Main Agent
  try {
    console.log('[2/4] Terminating TimeGuard Agent processes...');
    execSync('taskkill /F /IM "TimeGuard.exe" /T', { stdio: 'ignore' });
    execSync('taskkill /F /IM "knockturn-employee-agent.exe" /T', { stdio: 'ignore' });
  } catch (e) {}

  // Wait briefly
  try { execSync('timeout /t 2 /nobreak > NUL'); } catch (e) {}

  // 3. Remove Startup Registry Keys
  try {
    console.log('[3/4] Removing startup registry keys...');
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "TimeGuard" /f', { stdio: 'ignore' });
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "knockturn-employee-agent" /f', { stdio: 'ignore' });
  } catch (e) {}

  // 4. Delete AppData
  console.log('[4/4] Cleaning up application data...');
  const deleteFolderRecursive = (dirPath) => {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFolderRecursive(curPath);
        } else {
          try { fs.unlinkSync(curPath); } catch (e) {}
        }
      });
      try { fs.rmdirSync(dirPath); } catch (e) {}
    }
  };

  const roamingPath = path.join(os.homedir(), 'AppData', 'Roaming');
  const appDataDirs = ['TimeGuard', 'knockturn-employee-agent', 'timeguard', 'newagent-main'];
  appDataDirs.forEach(dirName => {
    const targetDir = path.join(roamingPath, dirName);
    if (fs.existsSync(targetDir)) {
      console.log(`      -> Removing data at ${targetDir}`);
      deleteFolderRecursive(targetDir);
    }
  });

  const localProgramsPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs');
  appDataDirs.forEach(dirName => {
    const targetDir = path.join(localProgramsPath, dirName);
    if (fs.existsSync(targetDir)) {
      console.log(`      -> Removing installation at ${targetDir}`);
      deleteFolderRecursive(targetDir);
    }
  });

  console.log('\n================================================');
  console.log(' Uninstallation completed successfully!');
  console.log(' You may now safely close this window.');
  console.log('================================================\n');
  
  process.exit(0);
});
