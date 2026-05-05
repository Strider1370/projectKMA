import config from '../config.js'
import apiClient from '../api-client.js'
import store from '../store.js'
import metarParser from '../parsers/metar-parser.js'

async function processAll() {
  const result = {
    type: "METAR",
    fetched_at: new Date().toISOString(),
    airports: {}
  };

  const failedAirports = [];
  const airportErrors = {};

  for (const airport of config.airports) {
    try {
      const xml = await apiClient.fetch("metar", airport.icao);
      const parsed = metarParser.parse(xml);
      if (parsed) {
        result.airports[airport.icao] = parsed;
      }
    } catch (error) {
      failedAirports.push(airport.icao);
      airportErrors[airport.icao] = error.message || "Unknown error";
    }
  }

  if (failedAirports.length > 0) {
    store.mergeWithPrevious(result, "metar", failedAirports);
  }

  const airportObsTimes = {};
  for (const [icao, data] of Object.entries(result.airports)) {
    if (data?.header) {
      airportObsTimes[icao] = {
        observation_time: data.header.observation_time || null,
        report_type: data.header.report_type || null
      };
    }
  }

  const saveResult = store.save("metar", result);
  return {
    type: "metar",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    total: Object.keys(result.airports).length,
    failedAirports,
    airportErrors,
    airportObsTimes
  };
}

export { processAll }
export default { processAll }
