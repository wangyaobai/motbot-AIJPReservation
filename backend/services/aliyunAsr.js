import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getNlsToken } from './aliyunNlsToken.js';

const REGION = process.env.ALIYUN_REGION || 'cn-shanghai';
function trimEnv(val) {
  return (val || '').trim().replace(/^[\"']|[\"']$/g, '');
}
function getAppKeyByLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (l === 'en') return trimEnv(process.env.ALI_APP_KEY_EN || process.env.ALIYUN_APP_KEY_EN || '');
  if (l === 'ja') return trimEnv(process.env.ALI_APP_KEY_JA || process.env.ALIYUN_APP_KEY_JA || '');
  return '';
}

// 兼容旧变量（不推荐）：未分语言时使用
function getLegacyAppKey() {
  return trimEnv(process.env.ALI_APP_KEY || process.env.ALIYUN_APP_KEY || '');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', 'data', 'asr_tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const GATEWAY = REGION === 'cn-shanghai'
  ? 'https://nls-gateway-cn-shanghai.aliyuncs.com'
  : `https://nls-gateway-${REGION}.aliyuncs.com`;

if (!getAppKeyByLang('ja') && !getAppKeyByLang('en') && !getLegacyAppKey()) {
  console.warn('[aliyunAsr] 未配置阿里云语音 AppKey（ALI_APP_KEY_JA/ALI_APP_KEY_EN/ALI_APP_KEY），ASR 将退化为返回空字符串。');
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
 * 将任意格式音频转为 16000Hz 单声道 MP3，以兼容阿里云 ASR。
 * @param {Buffer} inputBuf - 原始音频
 * @param {string} inputExt - 输入格式扩展名，如 'webm'、'mp3'、'ogg'、'wav'
 * @returns {Promise<Buffer>} 16k 单声道 MP3
 */
export async function convertTo16kMp3(inputBuf, inputExt = 'webm') {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1',
      '-f', 'mp3', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`));
    });
    proc.on('error', reject);
    proc.stdin.write(inputBuf);
    proc.stdin.end();
  });
}

/**
 * 使用 ffmpeg 将音频转为 16000Hz 单声道，以兼容阿里云 ASR（仅支持 8000/16000Hz）。
 * Twilio MP3 录音常为 22050Hz，直接上传会报 40000009。
 */
async function resampleTo16k(buf) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1',
      '-f', 'mp3', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`));
    });
    proc.on('error', reject);
    proc.stdin.write(buf);
    proc.stdin.end();
  });
}

/**
 * 一句话识别：上传二进制音频，返回日文文本。
 * 支持格式：PCM、WAV、MP3、AAC 等；采样率 8000/16000。
 */
export async function transcribeJaFromUrl(recordingUrl, options = {}) {
  return transcribeFromUrl(recordingUrl, { ...options, lang: 'ja' });
}

export async function transcribeEnFromUrl(recordingUrl, options = {}) {
  return transcribeFromUrl(recordingUrl, { ...options, lang: 'en' });
}

export async function transcribeFromUrl(recordingUrl, options = {}) {
  if (!recordingUrl) return '';
  const lang = (options.lang || 'ja').toString().toLowerCase();
  const appKey = getAppKeyByLang(lang) || getLegacyAppKey();
  if (!appKey) return '';

  const authHeader = options.authHeader || null;
  const format = (options.format || 'mp3').toLowerCase();
  let sampleRate = String(options.sample_rate || '16000');

  try {
    let buf = await downloadToBuffer(recordingUrl, authHeader);
    // Twilio MP3 常为 22050Hz，阿里云 ASR 仅支持 8000/16000，需 ffmpeg 重采样
    try {
      buf = await resampleTo16k(buf);
      sampleRate = '16000';
    } catch (e) {
      console.warn('[aliyunAsr] resample failed, skip ASR (install ffmpeg on server):', e.message);
      return '';
    }
    const token = await getNlsToken();
    if (!token) {
      console.warn('[aliyunAsr] 未获取到 NLS Token，请配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET');
      return '';
    }

    const params = new URLSearchParams({
      appkey: appKey,
      format,
      sample_rate: sampleRate,
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
    console.error('[aliyunAsr] transcribeFromUrl error', e.message);
    return '';
  }
}

/** 本地录音：一句话识别（上传 Buffer），返回文本（默认走日语项目） */
export async function transcribeJaFromBuffer(buf, options = {}) {
  return transcribeFromBuffer(buf, { ...options, lang: 'ja' });
}

export async function transcribeEnFromBuffer(buf, options = {}) {
  return transcribeFromBuffer(buf, { ...options, lang: 'en' });
}

export async function transcribeFromBuffer(buf, options = {}) {
  if (!buf || buf.length === 0) return '';
  const lang = (options.lang || 'ja').toString().toLowerCase();
  const appKey = getAppKeyByLang(lang) || getLegacyAppKey();
  if (!appKey) return '';
  const token = await getNlsToken();
  if (!token) return '';

  const format = (options.format || 'mp3').toLowerCase();
  const sampleRate = String(options.sample_rate || '16000');
  const params = new URLSearchParams({
    appkey: appKey,
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
    console.error('[aliyunAsr] transcribeFromBuffer error', e.message);
    return '';
  }
}
