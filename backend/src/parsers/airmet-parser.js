import advisoryParser from './iwxxm-advisory-parser.js'

function parse(xmlString, options) {
  return advisoryParser.parse(xmlString, "airmet", options);
}

export { parse }
export default { parse }
