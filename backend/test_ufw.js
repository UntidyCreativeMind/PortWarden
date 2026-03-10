const ufwOutput = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere
[ 3] 80/tcp (v6)                ALLOW IN    Anywhere (v6)`;

function parseUFWStatus(output) {
    const lines = output.split('\n');
    const rules = [];

    for (const line of lines) {
        let match = line.match(/^\[\s*(\d+)\]\s+(.*?)\s+(ALLOW IN|DENY IN|REJECT IN|LIMIT IN)\s+(.*)$/);
        if (match) {
            console.log("MATCH", match[1], match[2], match[3], match[4])
        } else {
            const m2 = line.match(/^\[\s*(\d+)\]\s+(\S+)\s+([A-Z\s]+)\s+(.*)$/);
            console.log("OLD MATCH", m2)
        }
    }
}
parseUFWStatus(ufwOutput);
