// Set to the listing's URL once the extension has a Chrome Web Store page. Until then the store card says the
// listing is coming, so the page never links to a listing that doesn't exist yet.
const chromeStoreUrl = '';

const cards = [
    {id: 'chrome', title: 'Chrome Web Store', description: 'Install from the Chrome Web Store. Updates automatically.', storeUrl: chromeStoreUrl, primaryLabel: 'Add to Chrome'},
    {id: 'chrome', title: 'ZIP package', description: 'For installing by hand in Developer mode. Does not update automatically.', primaryLabel: 'Download ZIP'},
];

void loadDownloads();

async function loadDownloads() {
    const container = document.getElementById('downloads');
    const status = document.getElementById('release-status');
    try {
        const manifest = await fetchJson('releases.json');
        const downloads = manifest.downloads ?? {};
        container.replaceChildren(...cards.map(card => createCard(card, downloads[card.id])));
        status.textContent = downloads.chrome?.version ? `Version ${downloads.chrome.version}` : 'No release published yet';
        renderReleaseNotes(manifest.releaseNotes);
        renderHistory(manifest.history?.chrome ?? []);
    } catch (error) {
        console.error('Could not load download metadata.', error);
        container.replaceChildren(...cards.map(card => createCard(card)));
        status.textContent = 'Download metadata is temporarily unavailable.';
        document.getElementById('history').textContent = 'Previous versions are temporarily unavailable.';
        document.getElementById('release-notes').textContent = 'Release notes are temporarily unavailable.';
    }
}

function renderReleaseNotes(notes) {
    const container = document.getElementById('release-notes');
    const entries = Array.isArray(notes) ? notes.slice(0, 3) : [];
    if (!entries.length) {
        container.textContent = 'Release notes will appear here with the next release.';
        return;
    }
    container.replaceChildren(...entries.map(createReleaseNote));
}

function createReleaseNote(note) {
    const element = document.createElement('article');
    element.className = 'release-note';
    const date = formatReleaseDate(note.publishedAt);
    const items = Array.isArray(note.items) && note.items.length
        ? `<ul>${note.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '<p class="muted">No user-facing changes were recorded for this release.</p>';
    element.innerHTML = `<div class="release-note-heading"><h3>Version ${escapeHtml(note.version)}</h3>${date ? `<time datetime="${escapeHtml(note.publishedAt)}">${escapeHtml(date)}</time>` : ''}</div>${items}`;
    return element;
}

function formatReleaseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return '';
    const date = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(date);
}

function renderHistory(entries) {
    const element = document.createElement('section');
    element.className = 'history-group';
    const links = entries.length
        ? entries.map(entry => `<a href="${encodeURI(entry.file)}" download>v${escapeHtml(entry.version)}</a>`).join('')
        : '<span class="muted">No previous packages.</span>';
    element.innerHTML = `<h3>Chrome ZIP</h3><div class="history-links">${links}</div>`;
    document.getElementById('history').replaceChildren(element);
}

function createCard(card, release) {
    const element = document.createElement('article');
    element.className = 'download-card';
    const version = release?.version ? `<p class="version">Version ${escapeHtml(release.version)}</p>` : '';
    let primary;
    if (card.storeUrl) {
        primary = `<a class="button button-primary" href="${card.storeUrl}">${card.primaryLabel}</a>`;
    } else if (card.storeUrl === '') {
        primary = '<span class="button button-disabled">Listing coming soon</span>';
    } else if (release?.file) {
        primary = `<a class="button button-primary" href="${encodeURI(release.file)}" download>${card.primaryLabel}</a>`;
    } else {
        primary = '<span class="button button-disabled">Not available yet</span>';
    }
    element.innerHTML = `<h3>${card.title}</h3><p>${card.description}</p>${version}<div class="actions">${primary}</div>`;
    return element;
}

async function fetchJson(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
    return await response.json();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'})[character]);
}
