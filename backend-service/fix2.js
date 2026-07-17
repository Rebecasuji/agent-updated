import { NodeSSH } from 'node-ssh';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fix() {
  const ssh = new NodeSSH();
  await ssh.connect({host: '82.25.109.136', username: 'root', password: 'Nk9698462253@'});
  
  const envData = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const lines = envData.split('\n');
  const envObj = { PORT: 5001 };
  for(const line of lines) {
    const idx = line.indexOf('=');
    if(idx > 0) {
      envObj[line.substring(0, idx).trim()] = line.substring(idx+1).trim();
    }
  }
  
  const ecosystem = `module.exports = {
    apps: [{
      name: 'timeguard-archiver',
      script: 'index.js',
      env: ${JSON.stringify(envObj, null, 2)}
    }]
  };`;
  
  fs.writeFileSync(path.join(__dirname, 'ecosystem.config.cjs'), ecosystem);
  await ssh.putFile(path.join(__dirname, 'ecosystem.config.cjs'), '/root/backend-service/ecosystem.config.cjs');
  await ssh.execCommand('pm2 delete timeguard-archiver');
  await ssh.execCommand('pm2 start ecosystem.config.cjs', { cwd: '/root/backend-service' });
  await ssh.execCommand('pm2 save');
  
  console.log("Fixed PM2 with ecosystem.config.cjs");
  const r = await ssh.execCommand('pm2 logs timeguard-archiver --lines 10 --nostream');
  console.log(r.stdout, r.stderr);
  ssh.dispose();
}
fix().catch(console.error);
