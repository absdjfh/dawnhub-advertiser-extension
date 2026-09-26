import nodemailer from 'nodemailer';
import {readFile} from 'node:fs/promises';
import packageJson from '../../package.json' with {type: 'json'};
import {collectUnreleasedNotes} from './release-notes.mjs';

const PRODUCT_NAME = 'Dawnhub Advertiser Tools';
const SITE_URL = 'https://dawn-adv-tools.rolich.net';
const DOWNLOADS_URL = `${SITE_URL}/downloads.html`;

await main();

// Every channel is optional and independent: email goes out only when the
// SMTP secrets and a recipient (RELEASE_NOTES_EMAIL_TO) are configured, and
// Discord only when DISCORD_WEBHOOK_URL is, so neither is assumed.
async function main() {
    const notes = process.env.PREVIEW
        ? collectUnreleasedNotes(packageJson.version)
        : await getPublishedReleaseNotes();
    if (!notes || notes.items.length === 0) {
        console.log('No release-note commits found; skipping notifications.');
        return;
    }
    const subject = `${PRODUCT_NAME} ${packageJson.version} release notes`;
    const changelogLines = notes.items.map(item => `- ${item}`);
    const text = [
        'Changelog:',
        ...changelogLines,
        'Chrome Web Store installs update automatically; no action is needed.',
        `For a manual install, download the latest package from ${DOWNLOADS_URL}`,
    ].join('\n');
    if (process.env.PREVIEW) {
        console.log(text);
        console.log('\nDiscord preview:\n');
        console.log(buildDiscordDescription(changelogLines));
        return;
    }
    const html = [
        '<p>Changelog:</p>',
        '<ul>',
        ...notes.items.map(item => `<li>${escapeHtml(item)}</li>`),
        '</ul>',
        '<p>Chrome Web Store installs update automatically; no action is needed.</p>',
        `<p>For a manual install, download the latest package from <a href="${DOWNLOADS_URL}">${PRODUCT_NAME} downloads</a>.</p>`,
    ].join('\n');
    const sent = [await sendEmail(subject, text, html), await sendDiscord(subject, changelogLines)].filter(Boolean);
    console.log(sent.length > 0 ? `Release notes sent via ${sent.join(' and ')}.` : 'No notification channel is configured; nothing was sent.');
}

async function getPublishedReleaseNotes() {
    const manifest = JSON.parse(await readFile('hosted/releases.json', 'utf8'));
    return manifest.releaseNotes?.find(notes => notes.version === packageJson.version);
}

async function sendEmail(subject, text, html) {
    const recipient = process.env.RELEASE_NOTES_EMAIL_TO;
    const smtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'];
    if (!recipient || smtp.some(name => !process.env[name])) {
        console.log('Email is not configured (RELEASE_NOTES_EMAIL_TO and SMTP secrets); skipping email.');
        return null;
    }
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    });
    const info = await transporter.sendMail({
        from: `"${PRODUCT_NAME}" <${process.env.SMTP_USER}>`,
        to: recipient,
        subject,
        text,
        html,
    });
    console.log('Message sent:', info.messageId);
    return 'email';
}

async function sendDiscord(subject, changelogLines) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.log('Discord webhook is not configured; skipping Discord notification.');
        return null;
    }
    const payload = {
        username: PRODUCT_NAME,
        embeds: [
            {
                title: subject,
                color: 8150271,
                description: buildDiscordDescription(changelogLines),
            },
        ],
    };
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to send Discord notification: ${response.status} ${response.statusText} ${errorBody}`);
    }
    console.log('Discord notification sent.');
    return 'Discord';
}

function buildDiscordDescription(changelogLines) {
    const description = [
        '**Changelog**',
        ...changelogLines,
        '',
        'Chrome Web Store installs update automatically.',
        `Manual downloads: ${DOWNLOADS_URL}`,
    ].join('\n');
    if (description.length <= 4096) {
        return description;
    }
    return `${description.slice(0, 4093)}...`;
}

function escapeHtml(value) {
    const entities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
    return value.replace(/[&<>"']/g, character => entities[character]);
}
