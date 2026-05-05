import config from '../config.js'
import apiClient from '../api-client.js'
import store from '../store.js'
import tafParser from '../parsers/taf-parser.js'

async function processAll() {
  const result = {
    type: "TAF",
    fetched_at: new Date().toISOString(),
    airports: {}
  };

  const failedAirports = [];
  const airportErrors = {};

  for (const airport of config.airports) {
    try {
      const xml = await apiClient.fetch("taf", airport.icao);
      const parsed = tafParser.parse(xml);
      if (parsed) {
        result.airports[airport.icao] = parsed;
      }
    } catch (error) {
      failedAirports.push(airport.icao);
      airportErrors[airport.icao] = error.message || "Unknown error";
    }
  }

  if (failedAirports.length > 0) {
    store.mergeWithPrevious(result, "taf", failedAirports);
  }

  const saveResult = store.save("taf", result);
  return {
    type: "taf",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    total: Object.keys(result.airports).length,
    failedAirports,
    airportErrors
  };
}

export { processAll }
export default { processAll }
