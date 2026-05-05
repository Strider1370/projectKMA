import apiClient from '../api-client.js'
import store from '../store.js'
import warningParser from '../parsers/warning-parser.js'

async function process() {
  const xml = await apiClient.fetch("warning");
  const parsed = warningParser.parse(xml);
  const saveResult = store.save("warning", parsed);

  return {
    type: "warning",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    airports: Object.keys(parsed.airports || {}).length
  };
}

export { process }
export default { process }
