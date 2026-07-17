import { NodeSSH } from 'node-ssh';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ssh = new NodeSSH();

async function deploy() {
  console.log('Connecting to server...');
  await ssh.connect({
    host: '82.25.109.136',
    username: 'root',
    password: 'Nk9698462253@'
  });
  console.log('Connected!');

  const localDir = __dirname;
  const remoteDir = '/root/backend-service';

  console.log('Uploading files...');
  await ssh.putDirectory(localDir, remoteDir, {
    recursive: true,
    concurrency: 10,
    validate: (itemPath) => {
      const base = path.basename(itemPath);
      return base !== 'node_modules' && base !== 'backups' && base !== '.git';
    },
    tick: (localPath, remotePath, error) => {
      if (error) {
        console.error('Failed to upload', localPath, error);
      }
    }
  });
  console.log('Uploading .env...');
  await ssh.putFile(path.join(__dirname, '..', '.env'), '/root/backend-service/.env');
  console.log('Upload complete!');

  console.log('Installing dependencies on server...');
  const res1 = await ssh.execCommand('npm install', { cwd: remoteDir });
  console.log('npm install:', res1.stdout, res1.stderr);
  
  // Fix db.js to look for .env in current dir instead of ..
  await ssh.execCommand('sed -i "s|..\\/\\.env|\\.env|g" /root/backend-service/db.js', { cwd: remoteDir });
  await ssh.execCommand('sed -i "s|..\\/\\.env|\\.env|g" /root/backend-service/index.js', { cwd: remoteDir });

  console.log('Starting service with PM2...');
  await ssh.execCommand('npm install -g pm2', { cwd: remoteDir });
  const res2 = await ssh.execCommand('pm2 restart timeguard-archiver || PORT=5001 pm2 start index.js --name "timeguard-archiver"', { cwd: remoteDir });
  console.log('pm2 start:', res2.stdout, res2.stderr);

  await ssh.execCommand('pm2 save', { cwd: remoteDir });
  console.log('Deployment completely finished!');
  ssh.dispose();
}

deploy().catch(err => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
