import {copyFile, readFile, readdir, unlink, writeFile} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {HOSTED_RETAINED_VERSIONS} from './hosted-retention.mjs';
import {collectReleaseNotes} from './release-notes.mjs';

const MANIFEST_PATH = 'hosted/releases.json';
// Release notes are small text, so they keep a longer tail than the binaries.
const MAX_PREVIOUS_RELEASE_NOTES = 9;
const MAX_PREVIOUS_RELEASES = HOSTED_RETAINED_VERSIONS - 1;
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

await main();

async function main() {
    const manifest = await readManifest();
    if (readBooleanEnv('HOSTED_INCLUDE_CHROME')) {
        await replaceDownload(manifest, 'chrome', await publishFile('.output', name => name.endsWith('-chrome.zip')));
    }
    addReleaseNotes(manifest);
    await removeUnreferencedBinaries(manifest);

    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Updated ${MANIFEST_PATH}.`);
}

function addReleaseNotes(manifest) {
    manifest.releaseNotes ??= [];
    if (manifest.releaseNotes.some(notes => notes.version === packageJson.version)) {
        return;
    }
    manifest.releaseNotes.unshift(collectReleaseNotes(packageJson.version));
    manifest.releaseNotes.splice(MAX_PREVIOUS_RELEASE_NOTES + 1);
}

async function readManifest() {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    manifest.downloads ??= {};
    manifest.history ??= {};
    return manifest;
}

async function replaceDownload(manifest, browser, nextDownload) {
    manifest.history[browser] ??= [];
    const currentDownload = manifest.downloads[browser];
    if (currentDownload?.file && currentDownload.file !== nextDownload.file) {
        manifest.history[browser].unshift(currentDownload);
        manifest.history[browser] = manifest.history[browser].filter((download, index, downloads) =>
            downloads.findIndex(candidate => candidate.file === download.file) === index);
        const expiredDownloads = manifest.history[browser].splice(MAX_PREVIOUS_RELEASES);
        await Promise.all(expiredDownloads.map(download => removeHostedFile(download.file)));
    }
    manifest.downloads[browser] = nextDownload;
}

// Retention backstop: whatever the manifest no longer names is not served.
async function removeUnreferencedBinaries(manifest) {
    const referenced = new Set([
        ...Object.values(manifest.downloads),
        ...Object.values(manifest.history).flat(),
    ].map(download => download.file));
    for (const name of await readdir('hosted')) {
        if (name.endsWith('.zip') && !referenced.has(name)) {
            await removeHostedFile(name);
        }
    }
}

async function removeHostedFile(file) {
    if (!file) {
        return;
    }
    const hostedRoot = resolve('hosted');
    const hostedPath = resolve(hostedRoot, file);
    const hostedRelativePath = relative(hostedRoot, hostedPath);
    if (hostedRelativePath.startsWith('..') || isAbsolute(hostedRelativePath)) {
        throw new Error(`Refusing to remove a file outside hosted/: ${file}`);
    }
    try {
        await unlink(hostedPath);
        console.log(`Removed expired release ${hostedPath}.`);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

async function publishFile(outputDirectory, matches) {
    const fileName = await findOnlyFile(outputDirectory, matches);
    const hostedPath = join('hosted', fileName);
    await copyFile(join(outputDirectory, fileName), hostedPath);
    console.log(`Published ${hostedPath}.`);
    return {version: packageJson.version, file: fileName};
}

async function findOnlyFile(directory, matches) {
    const matchesFound = (await readdir(directory)).filter(matches);
    if (matchesFound.length !== 1) {
        throw new Error(`Expected exactly one matching file in ${directory}, found ${matchesFound.length}.`);
    }
    return matchesFound[0];
}

function readBooleanEnv(name) {
    return process.env[name] === 'true' || process.env[name] === '1';
}
