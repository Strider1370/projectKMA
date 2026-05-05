import path from 'path'
import apiClient from '../api-client.js'
import store from '../store.js'
import config from '../config.js'
import sigmetParser from '../parsers/sigmet-parser.js'

function mergeAdvisories(previous, incoming, nowMs) {
  const merged = new Map();

  for (const item of (previous || [])) {
    const endMs = new Date(item.valid_to).getTime();
    if (!Number.isFinite(endMs) || endMs <= nowMs) continue;
    merged.set(item.id, item);
  }

  for (const item of (incoming || [])) {
    const endMs = new Date(item.valid_to).getTime();
    if (!Number.isFinite(endMs) || endMs <= nowMs) continue;
    merged.set(item.id, item);
  }

  return Array.from(merged.values()).sort((a, b) =>
    new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime()
  );
}

async function process() {
  const previous = store.loadLatest(path.join(config.storage.base_path, "sigmet"));
  const nowMs = Date.now();

  const xml = await apiClient.fetch("sigmet");
  const incoming = sigmetParser.parse(xml);
  const items = mergeAdvisories(previous?.items, incoming, nowMs);

  const result = {
    type: "sigmet",
    fetched_at: new Date().toISOString(),
    items
  };

  const saveResult = store.save("sigmet", result);
  return {
    type: "sigmet",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    total: items.length,
    incoming: incoming.length,
    expired_removed: (previous?.items?.length || 0) + incoming.length - items.length,
  };
}

export { process }
export default { process }
