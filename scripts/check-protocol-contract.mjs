import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const frontendRoot = path.join(root, 'frontend');
const serviceFile = path.join(root, 'src/main/java/com/jootm2/server/service/GameService.java');

function walk(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
            files.push(full);
        }
    }
    return files;
}

const sources = walk(frontendRoot);
const sent = new Map();
const sendPattern = /\.send\(\s*(['"])([^'"]+)\1/g;

for (const file of sources) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(sendPattern)) {
        const message = match[2];
        const line = content.slice(0, match.index).split('\n').length;
        const relative = path.relative(root, file).replaceAll(path.sep, '/');
        const list = sent.get(message) || [];
        list.push(relative + ':' + line);
        sent.set(message, list);
    }
}

const service = fs.readFileSync(serviceFile, 'utf8');
const handled = new Set(
    [...service.matchAll(/case\s+"([^"]+)"\s*:/g)].map(match => match[1])
);

const missing = [...sent.keys()].filter(message => !handled.has(message)).sort();
if (missing.length) {
    for (const message of missing) {
        process.stderr.write('No GameService handler for "' + message + '": '
            + sent.get(message).join(', ') + '\n');
    }
    process.exitCode = 1;
} else {
    process.stdout.write('Protocol contract passed: ' + sent.size
        + ' client request types have server handlers.\n');
}
