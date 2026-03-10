import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RPCClient = require('@alicloud/pop-core').RPCClient;

/**
 * 阿里云智能语音 NLS 鉴权 Token 获取（CreateToken），使用官方 pop-core SDK。
 * 环境变量：ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET（可与短信共用）、ALIYUN_REGION
 */
function trimEnv(val) {
  return (val || '').trim().replace(/^["']|["']$/g, '');
}
const REGION = trimEnv(process.env.ALIYUN_REGION) || 'cn-shanghai';
const ACCESS_KEY_ID = trimEnv(process.env.ALIYUN_ACCESS_KEY_ID);
const ACCESS_KEY_SECRET = trimEnv(process.env.ALIYUN_ACCESS_KEY_SECRET);

const META_ENDPOINT =
  REGION === 'cn-shanghai'
    ? 'https://nls-meta.cn-shanghai.aliyuncs.com'
    : `https://nls-meta.${REGION}.aliyuncs.com`;

let client = null;
function getClient() {
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) return null;
  if (!client) {
    client = new RPCClient({
      endpoint: META_ENDPOINT,
      apiVersion: '2019-02-28',
      accessKeyId: ACCESS_KEY_ID,
      accessKeySecret: ACCESS_KEY_SECRET,
    });
  }
  return client;
}

let cachedToken = null;
let cachedExpire = 0;

/**
 * 获取 NLS Token，带内存缓存（过期前 5 分钟刷新）。
 * @returns {Promise<string|null>}
 */
export async function getNlsToken() {
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExpire > now + 300) {
    return cachedToken;
  }

  const c = getClient();
  if (!c) return null;

  try {
    const result = await c.request('CreateToken', { RegionId: REGION });
    const tokenObj = result?.Token || result?.token;
    const id = tokenObj?.Id ?? tokenObj?.id;
    const expire = tokenObj?.ExpireTime ?? tokenObj?.expireTime;
    if (id && expire) {
      cachedToken = String(id);
      cachedExpire = Number(expire);
      return cachedToken;
    }
    console.error('[aliyunNlsToken] unexpected response', result);
    return null;
  } catch (e) {
    console.error('[aliyunNlsToken] CreateToken error', e.message, e.code || '', e.data || '');
    return null;
  }
}
