# PortWarden

A web dashboard for a Linux host that shows every listening port (host processes and Docker containers), whether UFW allows it over TCP, UDP or both, and lets you allow or block ports from the browser.

## Install (Portainer)

1. In Portainer, go to **Stacks**, click **Add stack**, choose **Web editor**, and paste in [`docker-compose.yml`](docker-compose.yml). You don't need to set any environment variables.
2. Deploy the stack.
3. Open the `portwarden` container's **Logs** in Portainer. On first run it prints a generated password for the `admin` user.
4. Open `http://<host>:9876`, log in as `admin`, and change the password under Settings.

The compose file builds the image straight from GitHub. It currently points at the `v0.2` branch; change `#v0.2` to `#main` once it's merged. To pick up new commits, delete the old `portwarden` image under **Images**, then redeploy the stack so it rebuilds.

Without Portainer, the same file works with `docker compose up -d --build`.

## Host configuration

PortWarden generates its own SSH key on first start and keeps it in its data volume. To let it connect to the host:

1. In PortWarden, go to **Settings** and copy the **PortWarden Public Key**.
2. On the host, create a dedicated non-root user, authorize that key, and allow the user to run only `ufw` and `ss` through sudo:

```bash
sudo adduser --disabled-password --gecos "" portwarden
sudo mkdir -p /home/portwarden/.ssh
echo 'PASTE-THE-PUBLIC-KEY-HERE' | sudo tee /home/portwarden/.ssh/authorized_keys
sudo chown -R portwarden:portwarden /home/portwarden/.ssh
sudo chmod 700 /home/portwarden/.ssh && sudo chmod 600 /home/portwarden/.ssh/authorized_keys

# Add with: sudo visudo -f /etc/sudoers.d/portwarden
portwarden ALL=(ALL) NOPASSWD: /usr/sbin/ufw, /usr/sbin/ss
```

3. Back in Settings, set the SSH username to `portwarden`, leave the key path as the generated key, and save.

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

Host connection settings are restored only if you tick the checkbox. Backups never contain the SSH password, the SSH private key, login accounts or the token signing secret. If you delete the data volume, PortWarden generates a new SSH key, and you will need to add its public key to the host again.

Custom names are also stored in the `portwarden-data` Docker volume, so they survive container rebuilds as long as you don't delete that volume.

## Security notes

- Login is rate-limited to 10 failed attempts per IP every 15 minutes.
- Passwords are hashed with PBKDF2-SHA512 at 310,000 iterations. Hashes from older versions are upgraded the next time you log in.
- The token signing secret is randomly generated and stored in the data volume.
- The SSH host key is pinned the first time PortWarden connects. If the key changes later, PortWarden refuses to connect until you click Reset in Settings.
- The SSH password is never sent back to the browser.
- PortWarden reaches Docker through a read-only socket proxy, never the raw Docker socket.
- PortWarden serves plain HTTP. If you need to reach it from outside your LAN, put it behind a reverse proxy with TLS.

## Optional environment variables

You don't need any of these. They're only for overriding defaults:

| Variable | Default |
| --- | --- |
| `ADMIN_PASSWORD` | Random password, printed in the logs on first run only |
| `JWT_SECRET` | Random secret, stored in the data volume |
| `HOST_IP` | `172.17.0.1`. Only used for the first-run default; you can also change it in Settings |
| `DOCKER_HOST` | The local socket if it's mounted, otherwise `docker-proxy:2375` |
