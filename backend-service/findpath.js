import { NodeSSH } from 'node-ssh';
async function findAndDeploy() {
  const ssh = new NodeSSH();
  await ssh.connect({host: '82.25.109.136', username: 'root', password: 'Nk9698462253@'});
  
  // Find where the agent/timeguard frontend is served
  const r1 = await ssh.execCommand('pm2 show agent');
  console.log('Agent info:', r1.stdout.substring(0, 800));
  
  // Find nginx config to understand which folder serves port 5000
  const r2 = await ssh.execCommand('nginx -T 2>/dev/null | grep -A5 "listen 5000"');
  console.log('Nginx 5000:', r2.stdout);
  
  const r3 = await ssh.execCommand('ls /var/www/');
  console.log('WWW dirs:', r3.stdout);
  
  const r4 = await ssh.execCommand('ls /root/');
  console.log('Root dirs:', r4.stdout);
  
  ssh.dispose();
}
findAndDeploy().catch(console.error);
