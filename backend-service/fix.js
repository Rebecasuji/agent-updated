import { NodeSSH } from 'node-ssh';
async function fix() {
  const ssh = new NodeSSH();
  await ssh.connect({host: '82.25.109.136', username: 'root', password: 'Nk9698462253@'});
  await ssh.execCommand("sed -i \"s|'..', '.env'|'.env'|g\" /root/backend-service/db.js");
  await ssh.execCommand('pm2 restart timeguard-archiver');
  console.log("Fixed db.js and restarted PM2");
  const r = await ssh.execCommand('pm2 logs timeguard-archiver --lines 10 --nostream');
  console.log(r.stdout, r.stderr);
  ssh.dispose();
}
fix().catch(console.error);
