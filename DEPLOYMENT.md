# DEPLOYMENT.md - AWS EC2 Free-Tier Deployment (PM2 + Nginx)

Deploy IT Monitor on a single free-tier EC2 instance at zero cost. Also applies to any
Ubuntu VM (NIC cloud VM, departmental server, etc.).

## Architecture

```
Internet ──► Nginx :80/:443 ──► Node/PM2 :3000 (Express + Socket.io)
                                   │
                                   └──► MongoDB Atlas M0 (free)  [recommended]
                                        or local mongod on the same VM
```

## 0. What you need

- An AWS account (free tier: 750 h/month of `t2.micro`/`t3.micro` for 12 months)
- A MongoDB Atlas M0 cluster (free forever tier) - see SETUP.md §1, choose region
  `ap-south-1` (Mumbai)
- Optionally a domain/subdomain (e.g. `status.example.in`) for HTTPS

## 1. Launch the instance

1. EC2 -> Launch instance -> **Ubuntu Server 24.04 LTS**, type **t3.micro** (or t2.micro).
2. Storage: 8-16 GB gp3 (free tier covers 30 GB).
3. Security group inbound rules:
   - `22` (SSH) - your IP only
   - `80` (HTTP) - anywhere
   - `443` (HTTPS) - anywhere
   - do **not** open 3000 or 27017 publicly.
4. Create/download a key pair and connect:
   ```bash
   ssh -i itm-key.pem ubuntu@<EC2_PUBLIC_IP>
   ```

## 2. Install runtime

```bash
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
sudo npm install -g pm2
```

(If you prefer MongoDB on the VM instead of Atlas, install per SETUP.md §1 Option B -
on a 1 GB t2.micro prefer Atlas: mongod is memory-hungry.)

## 3. Deploy the app

```bash
cd /opt && sudo mkdir itm && sudo chown ubuntu:ubuntu itm
git clone <repo-url> itm && cd itm
npm install --omit=dev

cp .env.example .env
nano .env
```

Production `.env` essentials:

```ini
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/itmonitor
SIMULATE_CHECKS=false
MONITOR_ENABLED=true
ADMIN_API_KEY=<generate: openssl rand -hex 24>
SMTP_HOST=smtp-relay.brevo.com     # or your NIC/departmental SMTP relay
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
ALERT_EMAIL_TO=noc@department.example.in
```

Seed the endpoint catalogue (no fabricated demo history in production):

```bash
npm run seed:endpoints
npm run verify:endpoints        # sanity: how many respond from this network
```

## 4. Run under PM2

```bash
pm2 start server.js --name it-monitor --time --max-memory-restart 300M
pm2 save
pm2 startup systemd             # run the printed sudo command to enable boot persistence
```

Useful PM2 commands: `pm2 status` · `pm2 logs it-monitor` · `pm2 reload it-monitor`
(zero-downtime after `git pull`) · `pm2 monit`.

> Run a **single instance** (no `-i max` cluster mode): the cron scheduler must not run
> in multiple processes, and Socket.io would need a Redis adapter in cluster mode. One
> instance comfortably monitors hundreds of endpoints.

## 5. Nginx reverse proxy (with websockets)

`sudo nano /etc/nginx/sites-available/it-monitor`:

```nginx
server {
    listen 80;
    server_name status.example.in;    # or _ for IP-only access

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        # websocket upgrade for Socket.io
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/it-monitor /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Free HTTPS (Let's Encrypt)

With a domain pointed at the instance:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d status.example.in
```

Auto-renewal is installed by default (`systemctl list-timers | grep certbot`).

## 7. Hardening checklist (government deployment)

- [ ] `ADMIN_API_KEY` set; consider IP-allow-listing `/api/services` POST/PUT/DELETE at Nginx
- [ ] Put the ops pages behind departmental SSO / VPN if required; keep `/` public
- [ ] `ufw allow 22,80,443/tcp && ufw enable` (or rely on the security group)
- [ ] Atlas: restrict network access to the EC2 elastic IP
- [ ] `pm2 install pm2-logrotate` to cap log growth
- [ ] Unattended security updates: `sudo dpkg-reconfigure -plow unattended-upgrades`
- [ ] Point an external uptime checker at `/api/health` (who watches the watcher?)

## 8. Updating

```bash
cd /opt/itm
git pull
npm install --omit=dev
pm2 reload it-monitor
```

## 9. Costs

| Item | Cost |
|---|---|
| EC2 t3.micro (free tier, 12 months) | Rs. 0 (then ~$8/mo) |
| MongoDB Atlas M0 | Rs. 0 (permanent free tier) |
| Let's Encrypt TLS | Rs. 0 |
| Brevo SMTP (300 emails/day) | Rs. 0 |
| OSM map tiles (light usage, attributed) | Rs. 0 |
| **Total** | **Rs. 0** |
