import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNlsToken } from './aliyunNlsToken.js';

const REGION = process.env.ALIYUN_REGION || 'cn-shanghai';
function trimEnv(val) {
  return (val || '').trim().replace(/^[\"']|[\"']$/g, '');
}
// ASR 默认使用日语项目的 AppKey（兼容旧变量）
const APP_KEY = trimEnv(process.env.ALI_APP_KEY_JA || process.env.ALIYUN_APP_KEY_JA || process.env.ALI_APP_KEY || process.env.ALIYUN_APP_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', 'data', 'asr_tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const GATEWAY = REGION === 'cn-shanghai'
  ? 'https://nls-gateway-cn-shanghai.aliyuncs.com'
  : `https://nls-gateway-${REGION}.aliyuncs.com`;

if (!APP_KEY) {
  console.warn('[aliyunAsr] 未配置阿里云语音 AppKey（ALI_APP_KEY_JA/ALI_APP_KEY），ASR 将退化为返回空字符串。');
}

/**
 * 从 URL 下载音频（支持 Twilio Basic Auth）
 */
async function downloadToBuffer(recordingUrl, authHeader) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  const resp = await fetch(recordingUrl, { headers });
  if (!resp.ok) throw new Error(`download audio failed: ${resp.status}`);
  const arrBuf = await resp.arrayBuffer();
  return Buffer.from(arrBuf);
}

/**
 * 一句话识别：上传二进制音频，返回日文文本。
 * 支持格式：PCM、WAV、MP3、AAC 等；采样率 8000/16000。
 */
export async function transcribeJaFromUrl(recordingUrl, options = {}) {
  if (!recordingUrl) return '';
  if (!APP_KEY) return '';

  const authHeader = options.authHeader || null;

  try {
    const buf = await downloadToBuffer(recordingUrl, authHeader);
    const token = await getNlsToken();
    if (!token) {
      console.warn('[aliyunAsr] 未获取到 NLS Token，请配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET');
      return '';
    }

    const params = new URLSearchParams({
      appkey: APP_KEY,
      format: 'mp3',
      sample_rate: '16000',
      enable_punctuation_prediction: 'true',
      enable_inverse_text_normalization: 'true',
    });

    const url = `${GATEWAY}/stream/v1/asr?${params.toString()}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-NLS-Token': token,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buf.length),
      },
      body: buf,
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('[aliyunAsr] response not json', text?.slice(0, 200));
      return '';
    }

    if (data.status === 20000000 && data.result != null) {
      return String(data.result).trim();
    }
    console.warn('[aliyunAsr] asr failed', data.status, data.message);
    return '';
  } catch (e) {
    console.error('[aliyunAsr] transcribeJaFromUrl error', e.message);
    return '';
  }
}

/** 本地录音：一句话识别（上传 Buffer），返回文本（默认走日语项目） */
export async function transcribeJaFromBuffer(buf, options = {}) {
  if (!buf || buf.length === 0) return '';
  if (!APP_KEY) return '';
  const token = await getNlsToken();
  if (!token) return '';

  const format = (options.format || 'mp3').toLowerCase();
  const sampleRate = String(options.sample_rate || '16000');
  const params = new URLSearchParams({
    appkey: APP_KEY,
    format,
    sample_rate: sampleRate,
    enable_punctuation_prediction: 'true',
    enable_inverse_text_normalization: 'true',
  });

  try {
    const url = `${GATEWAY}/stream/v1/asr?${params.toString()}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-NLS-Token': token,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buf.length),
      },
      body: buf,
    });
    const text = await resp.text();
    const data = JSON.parse(text);
    if (data.status === 20000000 && data.result != null) return String(data.result).trim();
    return '';
  } catch (e) {
    console.error('[aliyunAsr] transcribeJaFromBuffer error', e.message);
    return '';
  }
}
