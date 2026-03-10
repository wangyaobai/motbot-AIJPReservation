import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNlsToken } from './aliyunNlsToken.js';

const REGION = process.env.ALIYUN_REGION || 'cn-shanghai';

function trimEnv(val) {
  return (val || '').trim().replace(/^[\"']|[\"']$/g, '');
}

function getAppKeyByLang(lang) {
  const l = (lang || 'ja').toLowerCase();
  if (l === 'en') return trimEnv(process.env.ALI_APP_KEY_EN || process.env.ALIYUN_APP_KEY_EN);
  return trimEnv(process.env.ALI_APP_KEY_JA || process.env.ALIYUN_APP_KEY_JA || process.env.ALI_APP_KEY || process.env.ALIYUN_APP_KEY);
}

function getVoiceByLang(lang) {
  const l = (lang || 'ja').toLowerCase();
  if (l === 'en') return trimEnv(process.env.ALIYUN_TTS_VOICE_EN);
  return trimEnv(process.env.ALIYUN_TTS_VOICE_JA || process.env.ALIYUN_TTS_VOICE);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ttsDir = path.join(__dirname, '..', 'public', 'tts');
if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir, { recursive: true });

const GATEWAY = REGION === 'cn-shanghai'
  ? 'https://nls-gateway-cn-shanghai.aliyuncs.com'
  : `https://nls-gateway-${REGION}.aliyuncs.com`;

// 未配置时，会在 synthesizeJaToUrl / synthesizeEnToUrl 中直接返回空字符串

function genFileName() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `tts-ja-${ts}-${rand}.mp3`;
}

/**
 * 日语 TTS：将文本合成为音频并写入 public/tts，返回可公网访问的 URL。
 * @param {string} text - 日文文本
 * @param {string} baseUrl - 站点 BASE_URL（如 https://xxx.com）
 * @returns {Promise<string>} 音频 URL 或空字符串
 */
export async function synthesizeJaToUrl(text, baseUrl) {
  return synthesizeToUrl({ text, baseUrl, lang: 'ja' });
}

export async function synthesizeEnToUrl(text, baseUrl) {
  return synthesizeToUrl({ text, baseUrl, lang: 'en' });
}

async function synthesizeToUrl({ text, baseUrl, lang }) {
  if (!text || !text.trim()) return '';
  const appKey = getAppKeyByLang(lang);
  const voice = getVoiceByLang(lang);
  if (!appKey) {
    console.warn('[aliyunTts] AppKey 未配置', lang);
    return '';
  }
  if (!baseUrl) {
    console.warn('[aliyunTts] synthesizeJaToUrl 需要 baseUrl 以生成完整音频 URL');
    return '';
  }

  try {
    const token = await getNlsToken();
    if (!token) {
      console.warn('[aliyunTts] 未获取到 NLS Token');
      return '';
    }

    const paramsObj = {
      appkey: appKey,
      text: text.trim(),
      format: 'mp3',
      sample_rate: '16000',
      speech_rate: '0',
      volume: '50',
    };
    if (voice) paramsObj.voice = voice;
    const params = new URLSearchParams(paramsObj);

    const url = `${GATEWAY}/stream/v1/tts?${params.toString()}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'X-NLS-Token': token },
    });

    if (!resp.ok) {
      console.warn('[aliyunTts] tts request failed', resp.status, await resp.text().catch(() => ''));
      return '';
    }

    const ct = resp.headers.get('content-type') || '';
    // 有些错误会返回 200 但内容是 JSON/文本（不是音频）
    if (/application\/json|text\/plain|text\/html/i.test(ct)) {
      const maybeText = await resp.text().catch(() => '');
      console.warn('[aliyunTts] unexpected content-type', ct, maybeText.slice(0, 200));
      return '';
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return '';

    const fileName = genFileName();
    const filePath = path.join(ttsDir, fileName);
    fs.writeFileSync(filePath, buf);

    const safeBase = baseUrl.replace(/\/$/, '');
    return `${safeBase}/tts/${fileName}`;
  } catch (e) {
    console.error('[aliyunTts] synthesizeJaToUrl error', e.message);
    return '';
  }
}
