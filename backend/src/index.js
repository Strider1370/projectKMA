import cron from 'node-cron'
import config from './config.js'
import store from './store.js'
import stats from './stats.js'
import metarProcessor from './processors/metar-processor.js'
import tafProcessor from './processors/taf-processor.js'
import warningProcessor from './processors/warning-processor.js'
import sigmetProcessor from './processors/sigmet-processor.js'
import airmetProcessor from './processors/airmet-processor.js'
import sigwxLowProcessor from './processors/sigwx-low-processor.js'
import amosProcessor from './processors/amos-processor.js'
import lightningProcessor from './processors/lightning-processor.js'
import radarEchoProcessor from './processors/radar-echo-processor.js'
import adsbProcessor from './processors/adsb-processor.js'
import satelliteProcessor from './processors/satellite-processor.js'
import groundForecastProcessor from './processors/ground-forecast-processor.js'
import environmentProcessor from './processors/environment-processor.js'

const locks = { metar: false, taf: false, warning: false, sigmet: false, airmet: false, sigwx_low: false, amos: false, lightning: false, radar_echo: false, adsb: false, satellite: false, ground_forecast: false, environment: false };

async function runWithLock(type, job) {
  if (locks[type]) {
    console.warn(`${type}: skipped (already running)`);
    return;
  }

  locks[type] = true;
  try {
    const result = await job();
    console.log(`[${new Date().toISOString()}] ${type}:`, result);
    stats.recordSuccess(type, result);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${type} failed:`, error.message);
    stats.recordFailure(type, error.message);
  } finally {
    locks[type] = false;
  }
}

async function main() {
  store.ensureDirectories(config.storage.base_path);
  store.initFromFiles(config.storage.base_path);
  stats.initFromFile(config.storage.base_path);

  console.log("Scheduler started");

  cron.schedule(config.schedule.metar_interval, () => runWithLock("metar", metarProcessor.processAll));
  cron.schedule(config.schedule.taf_interval, () => runWithLock("taf", tafProcessor.processAll));
  cron.schedule(config.schedule.warning_interval, () => runWithLock("warning", warningProcessor.process));
  cron.schedule(config.schedule.sigmet_interval, () => runWithLock("sigmet", sigmetProcessor.process));
  cron.schedule(config.schedule.airmet_interval, () => runWithLock("airmet", airmetProcessor.process));
  cron.schedule(config.schedule.sigwx_low_interval, () => runWithLock("sigwx_low", sigwxLowProcessor.process));
  cron.schedule(config.schedule.amos_interval, () => runWithLock("amos", amosProcessor.process));
  cron.schedule(config.schedule.lightning_interval, () => runWithLock("lightning", lightningProcessor.process));
  cron.schedule(config.schedule.radar_echo_interval, () => runWithLock("radar_echo", radarEchoProcessor.process));
  cron.schedule(config.schedule.adsb_interval, () => runWithLock("adsb", adsbProcessor.process));
  cron.schedule(config.schedule.satellite_interval, () => runWithLock("satellite", satelliteProcessor.process));
  cron.schedule(config.schedule.ground_forecast_interval, () => runWithLock("ground_forecast", groundForecastProcessor.process));
  cron.schedule(config.schedule.environment_interval, () => runWithLock("environment", environmentProcessor.process));

  // 서버 시작 직후 1회 즉시 수집
  console.log("Running initial data collection...");
  await Promise.allSettled([
    runWithLock("metar", metarProcessor.processAll),
    runWithLock("taf", tafProcessor.processAll),
    runWithLock("warning", warningProcessor.process),
    runWithLock("sigmet", sigmetProcessor.process),
    runWithLock("airmet", airmetProcessor.process),
    runWithLock("sigwx_low", sigwxLowProcessor.process),
    runWithLock("amos", amosProcessor.process),
    runWithLock("lightning", lightningProcessor.process),
    runWithLock("radar_echo", radarEchoProcessor.process),
    runWithLock("adsb", adsbProcessor.process),
    runWithLock("satellite", satelliteProcessor.process),
    runWithLock("ground_forecast", groundForecastProcessor.process),
    runWithLock("environment", environmentProcessor.process),
  ]);
  console.log("Initial data collection complete.");
}

const __filename = new URL(import.meta.url).pathname
if (process.argv[1] && (__filename === process.argv[1] || __filename.endsWith(process.argv[1]))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main, runWithLock }
export default { main, runWithLock }
