const output = `State      Recv-Q Send-Q      Local Address:Port                        Peer Address:Port
LISTEN     0      128             127.0.0.1:6010                                   *:*                   users:(("sshd",pid=123,fd=4))
LISTEN     0      128             127.0.0.1:6011                                   *:*                   users:(("sshd",pid=124,fd=4))
LISTEN     0      128                     *:22                                     *:*                   users:(("sshd",pid=900,fd=3))
LISTEN     0      50              127.0.0.1:53                                     *:*                   users:(("dnsmasq",pid=800,fd=5))
LISTEN     0      128                    :::22                                    :::*                   users:(("sshd",pid=900,fd=4))`;

const lines = output.split('\n').filter(l => l.trim() !== '' && !l.includes('State'));
const ports = [];

for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    // ubuntu 14.04 ss doesn't always have Netid column reliably if run without right flags or old version
    // Let's print parts to see
    console.log(parts);
}
