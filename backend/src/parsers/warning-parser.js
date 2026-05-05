import { XMLParser } from 'fast-xml-parser'
import warningTypes from '../../../shared/warning-types.js'
import { toArray, text, parseYmdhmToIso } from './parse-utils.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  isArray: (name) => name === "item"
});

function getItems(doc) {
  return toArray(doc?.response?.body?.items?.item || doc?.body?.items?.item || doc?.items?.item);
}

function decodeXmlEntities(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/&#xD;/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function resolveWarningType(rawType) {
  const raw = String(rawType || "").trim();
  const candidates = [raw];

  if (raw === "0") {
    candidates.push("00");
  }

  const stripped = raw.replace(/^0+/, "");
  if (stripped && stripped !== raw) {
    candidates.push(stripped);
  }

  for (const code of candidates) {
    if (warningTypes[code]) {
      return warningTypes[code];
    }
  }

  return {
    key: "UNKNOWN",
    name: "Unknown Warning"
  };
}

function parse(xmlString) {
  const document = parser.parse(xmlString);
  const items = getItems(document);

  const result = {
    type: "AIRPORT_WARNINGS",
    fetched_at: new Date().toISOString(),
    total_count: 0,
    airports: {}
  };

  for (const item of items) {
    const icao = text(item.icaoCode) || text(item.icao) || text(item.airportIcao);
    if (!icao) {
      continue;
    }

    const airportName = text(item.airportName) || icao;
    const wrngType = text(item.wrngType) || text(item.warningType) || "";
    const mapped = resolveWarningType(wrngType);

    const warning = {
      issued: parseYmdhmToIso(text(item.tm) || text(item.wrngIssueTime) || text(item.issued)) || null,
      wrng_type: wrngType,
      wrng_type_key: mapped.key,
      wrng_type_name: mapped.name,
      valid_start: parseYmdhmToIso(text(item.validTm1) || text(item.validStart) || text(item.wrngFrom)) || null,
      valid_end: parseYmdhmToIso(text(item.validTm2) || text(item.validEnd) || text(item.wrngTo)) || null,
      raw_message: decodeXmlEntities(text(item.wrngMsg) || text(item.warningMessage) || null)
    };

    if (!result.airports[icao]) {
      result.airports[icao] = {
        airport_name: airportName,
        warnings: []
      };
    }

    if (warning.wrng_type_key === "WIND_SHEAR") {
      const isDuplicate = result.airports[icao].warnings.some(existing => 
        existing.wrng_type_key === "WIND_SHEAR" &&
        existing.valid_start === warning.valid_start &&
        existing.valid_end === warning.valid_end
      );
      if (isDuplicate) {
        continue;
      }
    }

    result.airports[icao].warnings.push(warning);
    result.total_count += 1;
  }

  for (const icao of Object.keys(result.airports)) {
    result.airports[icao].warnings.sort((a, b) => {
      const at = a.issued || "";
      const bt = b.issued || "";
      return at.localeCompare(bt);
    });
  }

  return result;
}

export { parse }
export default { parse }
