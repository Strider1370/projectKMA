import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadDotenv(startDir) {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    const envPath = path.join(dir, '.env')
    if (fs.existsSync(envPath)) { dotenv.config({ path: envPath }); return }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}
loadDotenv(__dirname)

const projectRoot = path.resolve(__dirname, '../..')

function resolveDataPath(dataPath) {
  if (!dataPath) {
    return path.join(projectRoot, 'backend', 'data')
  }
  return path.isAbsolute(dataPath) ? dataPath : path.resolve(projectRoot, dataPath)
}

export const airports = [
  { icao: 'RKSI', name: 'Incheon International Airport', lat: 37.4602, lon: 126.4407, amos_stn: null },
  { icao: 'RKSS', name: 'Gimpo International Airport', lat: 37.5586, lon: 126.7906, amos_stn: null },
  { icao: 'RKPC', name: 'Jeju International Airport', lat: 33.5104, lon: 126.4929, amos_stn: null },
  { icao: 'RKPK', name: 'Gimhae International Airport', lat: 35.1795, lon: 128.9382, amos_stn: null },
  { icao: 'RKJB', name: 'Muan International Airport', lat: 34.9914, lon: 126.3828, amos_stn: null },
  { icao: 'RKNY', name: 'Yangyang International Airport', lat: 38.0613, lon: 128.6692, amos_stn: null },
  { icao: 'RKPU', name: 'Ulsan Airport', lat: 35.5935, lon: 129.3518, amos_stn: null },
  { icao: 'RKJY', name: 'Yeosu Airport', lat: 34.8424, lon: 127.6162, amos_stn: null },
]

export const api = {
  base_url: process.env.API_BASE_URL || 'https://apihub.kma.go.kr/api/typ02/openApi',
  lightning_url: process.env.LIGHTNING_API_URL || 'https://apihub.kma.go.kr/api/typ01/url/lgt_pnt.php',
  amos_url: process.env.AMOS_API_URL || 'https://apihub.kma.go.kr/api/typ01/url/amos.php',
  sigwx_low_url: process.env.SIGWX_LOW_API_URL || 'https://apihub.kma.go.kr/api/typ01/url/amo_sigwx.php',
  radar_url: process.env.RADAR_API_URL || 'https://apihub.kma.go.kr/api/typ04/url/rdr_cmp_file.php',
  airkorea_pm_url: process.env.AIRKOREA_PM_URL || 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty',
  kma_uv_url: process.env.KMA_UV_URL || 'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm_uv.php',
  endpoints: {
    metar: '/AmmIwxxmService/getMetar',
    taf: '/AmmIwxxmService/getTaf',
    warning: '/AmmService/getWarning',
    sigmet: '/AmmIwxxmService/getSigmet',
    airmet: '/AmmIwxxmService/getAirmet',
  },
  auth_key: process.env.KMA_AUTH_KEY || process.env.API_AUTH_KEY || '',
  airkorea_key: process.env.AIRKOREA_API_KEY || '',
  kma_uv_key: process.env.KMA_UV_API_KEY || process.env.API_AUTH_KEY || '',
  default_params: { pageNo: 1, numOfRows: 10, dataType: 'XML' },
  timeout_ms: 10000,
  max_retries: 3,
}

export const environment = {
  timeout_ms: 15000,
  pm_station_by_airport: {
    RKSI: '운서',
    RKSS: '공항대로',
    RKPC: '연동',
    RKPK: '삼락동',
    RKJB: '무안읍',
    RKNY: '양양읍',
    RKPU: '송정동',
    RKJY: '율촌면',
  },
  uv_station_by_airport: {
    RKSI: { stn: 112, name: '인천' },
    RKSS: { stn: 108, name: '서울' },
    RKPC: { stn: 185, name: '고산' },
    RKPK: { stn: 159, name: '부산' },
    RKJB: { stn: 165, name: '목포' },
    RKNY: { stn: 105, name: '강릉' },
    RKPU: { stn: 152, name: '울산' },
    RKJY: { stn: 165, name: '목포' },
  },
}

export const ground_forecast = {
  timeout_ms: 15000,
  short_endpoint: '/VilageFcstMsgService/getLandFcst',
  mid_land_endpoint: '/MidFcstInfoService/getMidLandFcst',
  mid_temp_endpoint: '/MidFcstInfoService/getMidTa',
  quality_drop_tolerance: 0,
  airports: {
    RKSS: { short_reg_id: '11B20102', mid_land_reg_id: '11B00000', mid_temp_reg_id: '11B20102' },
    RKSI: { short_reg_id: '11B20201', mid_land_reg_id: '11B00000', mid_temp_reg_id: '11B20201' },
    RKPC: { short_reg_id: '11G00201', mid_land_reg_id: '11G00000', mid_temp_reg_id: '11G00201' },
    RKJY: { short_reg_id: '11F20401', mid_land_reg_id: '11F20000', mid_temp_reg_id: '11F20401' },
    RKJB: { short_reg_id: '21F20804', mid_land_reg_id: '11F20000', mid_temp_reg_id: '21F20804' },
    RKPU: { short_reg_id: '11H20101', mid_land_reg_id: '11H20000', mid_temp_reg_id: '11H20101' },
    RKNY: { short_reg_id: '11D20403', mid_land_reg_id: '11D20000', mid_temp_reg_id: '11D20403' },
    RKPK: { short_reg_id: '11H20304', mid_land_reg_id: '11H20000', mid_temp_reg_id: '11H20304' },
  },
}

export const lightning = {
  range_km: 32,
  itv_minutes: 5,
  nationwide: {
    lat: 36.2,
    lon: 127.8,
    range_km: 800,
  },
  zones: {
    alert: 8,
    danger: 16,
    caution: 32,
  },
}

export const amos = {
  dtm_minutes: 60,
  timeout_ms: 12000,
  stale_tolerance_minutes: 60,
}

export const radar_echo = {
  cmp: (process.env.RADAR_CMP_TYPE || 'hsr').toLowerCase(),
  delay_minutes: 10,
  max_images: 36,
  range_km: 100,
  crop_size: 200,
  timeout_ms: 30000,
}

export const satellite = {
  url: process.env.SATELLITE_API_URL || 'https://apihub.kma.go.kr/api/typ05/api/GK2A/LE1B',
  fog_url: process.env.SATELLITE_FOG_API_URL || 'https://apihub.kma.go.kr/api/typ05/api/GK2A/LE2',
  channel: (process.env.SATELLITE_CHANNEL || 'IR105').toUpperCase(),
  fog_product: 'FOG',
  region: (process.env.SATELLITE_REGION || 'KO').toUpperCase(),
  delay_minutes: 20,
  max_frames: 18,
  timeout_ms: 30000,
}

export const adsb = {
  url: process.env.ADSB_API_URL || 'https://opensky-network.org/api/states/all',
  timeout_ms: 20000,
  max_history_frames: 36,
  bounds: {
    lamin: Number(process.env.ADSB_LAMIN || 30),
    lamax: Number(process.env.ADSB_LAMAX || 39),
    lomin: Number(process.env.ADSB_LOMIN || 124),
    lomax: Number(process.env.ADSB_LOMAX || 134),
  },
}

export const schedule = {
  metar_interval: '*/10 * * * *',
  taf_interval: '*/30 * * * *',
  warning_interval: '*/5 * * * *',
  sigmet_interval: '*/5 * * * *',
  airmet_interval: '*/5 * * * *',
  sigwx_low_interval: '5 5,11,17,23 * * *',
  amos_interval: '*/10 * * * *',
  lightning_interval: '*/5 * * * *',
  radar_echo_interval: '*/5 * * * *',
  satellite_interval: '*/10 * * * *',
  adsb_interval: '*/5 * * * *',
  ground_forecast_interval: '30 6,11,18,23 * * *',
  environment_interval: '10 * * * *',
}

export const storage = {
  base_path: resolveDataPath(process.env.DATA_PATH),
  max_files_per_category: 10,
  max_files_by_type: {
    lightning: 48,
  },
}

export default {
  api,
  airports,
  environment,
  ground_forecast,
  lightning,
  amos,
  radar_echo,
  satellite,
  adsb,
  schedule,
  storage,
}
