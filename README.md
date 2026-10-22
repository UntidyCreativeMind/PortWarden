# PortWarden

A web dashboard for a Linux host that shows every listening port (host processes and Docker containers), whether UFW allows it over TCP, UDP or both, and lets you allow or block ports from the browser.

## Install

```bash
git clone https://github.com/UntidyCreativeMind/PortWarden.git
cd PortWarden

# 1. Create a dedicated SSH key just for PortWarden
mkdir -p ssh
ssh-keygen -t ed25519 -N "" -f ssh/id_ed25519 -C portwarden

# 2. Start it
docker compose up -d --build

# 3. Get the generated admin password (printed once on first run)
docker logs portwarden
```

Open `http://<host>:9876`, log in as `admin`, and change the password under Settings. You can also set `ADMIN_PASSWORD` in `docker-compose.yml` before the first start.

## Host configuration

On the host being monitored, create a dedicated non-root user, authorize the key, and allow it to run only `ufw` and `ss` through sudo:

```bash
sudo adduser --disabled-password --gecos "" portwarden
sudo mkdir -p /home/portwarden/.ssh
sudo cp ssh/id_ed25519.pub /home/portwarden/.ssh/authorized_keys
sudo chown -R portwarden:portwarden /home/portwarden/.ssh
sudo chmod 700 /home/portwarden/.ssh && sudo chmod 600 /home/portwarden/.ssh/authorized_keys

# Add with: sudo visudo -f /etc/sudoers.d/portwarden
portwarden ALL=(ALL) NOPASSWD: /usr/sbin/ufw, /usr/sbin/ss
```

Then in PortWarden's Settings, set the SSH username to `portwarden` and the key path to `/root/.ssh/id_ed25519`.

## Using it

- **Sort**: click any column header. Click again to reverse the order.
- **Listening**: shows whether each port is listening on TCP, UDP or both.
- **UFW Allowed**: shows which protocols UFW currently allows for the port.
- **Allow / Block**: pick TCP, UDP or TCP + UDP, then click Allow or Block. Other protocols on that port are left alone.
- **Manual entry**: the last row opens a port that isn't listening yet.

## Backup and restore

Go to Settings, then Backup & Restore, and click **Download Backup** to save your custom port names and host connection settings as a JSON file. After a reinstall, upload that file under **Restore**:

- **Merge** keeps your existing names and overwrites names for ports that are in the backup.
- **Replace** deletes all existing names first.

Host connection settings are restored only if you tick the checkbox. Backups never contain the SSH password, login accounts or the token signing secret.

Custom names are also stored in the `portwarden-data` Docker volume, so they survive container rebuilds as long as you don't delete that volume.

## Security notes

- Login is rate-limited to 10 failed attempts per IP every 15 minutes.
- Passwords are hashed with PBKDF2-SHA512 at 310,000 iterations. Hashes from older versions are upgraded the next time you log in.
- The token signing secret is randomly generated and stored in the data volume, unless you set `JWT_SECRET`.
- The SSH host key is pinned the first time PortWarden connects. If the key changes later, PortWarden refuses to connect until you click Reset in Settings.
- The SSH password is never sent back to the browser.
- PortWarden reaches Docker through a read-only socket proxy, never the raw Docker socket.
- PortWarden serves plain HTTP. If you need to reach it from outside your LAN, put it behind a reverse proxy with TLS.
