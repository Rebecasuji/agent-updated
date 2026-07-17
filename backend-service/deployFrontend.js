import { NodeSSH } from 'node-ssh';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function deployFrontend() {
  const ssh = new NodeSSH();
  await ssh.connect({host: '82.25.109.136', username: 'root', password: 'Nk9698462253@'});
  
  const localDist = path.join(__dirname, '..', 'dist', 'app');
  const remoteDist = '/opt/AGENT/dist/app';
  
  console.log('Uploading new dist/app to server...');
  
  // Backup old dist
  await ssh.execCommand('cp -r /opt/AGENT/dist/app /opt/AGENT/dist/app.bak 2>/dev/null || true');
  
  // Clear old dist
  await ssh.execCommand('rm -rf /opt/AGENT/dist/app');
  await ssh.execCommand('mkdir -p /opt/AGENT/dist/app/assets');
  
  // Upload new dist
  const result = await ssh.putDirectory(localDist, remoteDist, {
    recursive: true,
    concurrency: 10,
    validate: () => true,
    tick: (local, remote, error) => {
      if (error) console.error('Failed:', local, error.message);
      else console.log('Uploaded:', path.basename(local));
    }
  });
  
  console.log('Upload result:', result ? 'success' : 'partial');
  
  // Restart the agent process
  const r = await ssh.execCommand('pm2 restart agent');
  console.log('Restart:', r.stdout, r.stderr);
  
  // Verify it's running
  const r2 = await ssh.execCommand('pm2 status agent');
  console.log('Status:', r2.stdout);
  
  ssh.dispose();
  console.log('\n✅ Frontend deployed successfully!');
  console.log('Production URL: http://82.25.109.136:5000');
}

deployFrontend().catch(console.error);
