// lib/vvStore.js
//
// WhatsApp strips mediaKey/url out of a View-Once message whenever it is
// embedded as a `quotedMessage` (i.e. when someone replies to it). So to
// download a view-once image/video/audio after the fact, we need the
// ORIGINAL message exactly as it was first received — that copy still has
// the full media info.
//
// This module keeps a small in-memory cache of recent incoming messages,
// keyed by their WhatsApp message id (`key.id`, also called "stanzaId"
// when referenced from a reply's contextInfo). index.js saves every
// message here as soon as it arrives; commands/vv.js reads it back using
// the stanzaId of whatever message the user replied to.
//
// Limitation: this only works for messages the bot was online to receive.
// If the bot was offline/restarted when the view-once message arrived,
// it will not be in this cache.

const store = new Map();
const MAX_SIZE = 500; // keep memory usage bounded

function save(msg) {
    try {
        if (!msg?.key?.id) return;
        store.set(msg.key.id, msg);

        if (store.size > MAX_SIZE) {
            const oldestKey = store.keys().next().value;
            store.delete(oldestKey);
        }
    } catch (e) {
        // never let caching errors break message handling
    }
}

function get(id) {
    if (!id) return null;
    return store.get(id) || null;
}

// Har wrapper (ephemeral / view-once V1, V2, V2Extension / documentWithCaption)
// utar kar andar ka asal message deta hai.
function unwrap(message) {
    let cur = message;
    const keys = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
    for (let i = 0; i < 6 && cur; i++) {
        const k = keys.find((x) => cur[x]?.message);
        if (!k) break;
        cur = cur[k].message;
    }
    return cur;
}

module.exports = { save, get, unwrap };
