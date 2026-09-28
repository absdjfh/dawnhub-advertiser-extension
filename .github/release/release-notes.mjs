import {execFileSync} from 'node:child_process';

const INCLUDE_DIRECTORIES = ['assets', 'components', 'entrypoints', 'host', 'utils'];
const EXCLUDED_PATH_SEGMENTS = ['__tests__'];

export function collectReleaseNotes(version) {
    return {
        version,
        publishedAt: new Date().toISOString().slice(0, 10),
        items: getReleaseCommits(resolveReleaseRange(version)).map(commit => commit.subject),
    };
}

function getReleaseCommits(range) {
    const output = runGit(['log', '--format=%x1e%an%x1f%s', '--name-only', range]);
    return parseCommits(output).filter(isUserFacingCommit);
}

function resolveReleaseRange(version) {
    const releaseTag = `v${version}`;
    if (hasGitRef(releaseTag)) {
        const previousTag = tryRunGit(['describe', '--tags', '--abbrev=0', `${releaseTag}^`]);
        return previousTag ? `${previousTag}..${releaseTag}` : releaseTag;
    }

    const previousTag = tryRunGit(['describe', '--tags', '--abbrev=0', 'HEAD']);
    return previousTag ? `${previousTag}..HEAD` : 'HEAD';
}

function parseCommits(output) {
    return output.split('\x1e').filter(record => record.trim()).map(record => {
        const [header = '', ...files] = record.trim().split('\n');
        const [author = '', subject = ''] = header.split('\x1f');
        if (!author || !subject) {
            throw new Error('Could not parse release-note commit metadata.');
        }
        return {author, subject, files: files.filter(Boolean)};
    });
}

function isUserFacingCommit(commit) {
    if (commit.author === 'github-actions[bot]' || commit.subject.toLowerCase().includes('chore')) {
        return false;
    }
    return commit.files.some(file =>
        !EXCLUDED_PATH_SEGMENTS.some(segment => file.includes(segment))
        && INCLUDE_DIRECTORIES.some(directory => file.startsWith(`${directory}/`)));
}

function hasGitRef(ref) {
    return tryRunGit(['rev-parse', '--verify', '--quiet', ref]) !== '';
}

function tryRunGit(args) {
    try {
        return runGit(args);
    } catch {
        return '';
    }
}

function runGit(args) {
    return execFileSync('git', args, {encoding: 'utf8'}).trim();
}
