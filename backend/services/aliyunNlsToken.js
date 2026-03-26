import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RPCClient = require('@alicloud/pop-core').RPCClient;

/**
 * 阿里云智能语音 NLS 鉴权 Token 获取（CreateToken），使用官方 pop-core SDK。
 * 环境变量：ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET（可与短信共用）、ALIYUN_REGION
 *
 * 凭证在每次请求时从 process.env 读取；Key 变更后会重建 RPCClient，避免仍用已禁用旧 Key。
 * 注意：若 PM2 / 系统环境变量里已存在 ALIYUN_ACCESS_KEY_ID，dotenv 默认不会覆盖，请删掉旧值或改 ecosystem。
 */
function trimEnv(val) {
  return (val || '').trim().replace(/^["']|["']$/g, '');
}

function getRegion() {
  return trimEnv(process.env.ALIYUN_REGION) || 'cn-shanghai';
}

function metaEndpoint(region) {
  return region === 'cn-shanghai'
    ? 'https://nls-meta.cn-shanghai.aliyuncs.com'
    : `https://nls-meta.${region}.aliyuncs.com`;
}

let client = null;
let clientKeyFingerprint = '';

function getClient() {
  const accessKeyId = trimEnv(process.env.ALIYUN_ACCESS_KEY_ID);
  const accessKeySecret = trimEnv(process.env.ALIYUN_ACCESS_KEY_SECRET);
  if (!accessKeyId || !accessKeySecret) return null;

  const fp = `${accessKeyId}\0${accessKeySecret}`;
  if (client && clientKeyFingerprint === fp) return client;

  clientKeyFingerprint = fp;
  // pop-core 依赖的 httpx 默认仅 3s，ECS/跨境网络易 ReadTimeout(3000)
  const httpTimeout = (() => {
    const n = parseInt(process.env.ALIYUN_NLS_HTTP_TIMEOUT_MS, 10);
    if (Number.isFinite(n) && n >= 5000 && n <= 120000) return n;
    return 25000;
  })();
  client = new RPCClient({
    endpoint: metaEndpoint(getRegion()),
    apiVersion: '2019-02-28',
    accessKeyId,
    accessKeySecret,
    opts: { timeout: httpTimeout },
  });
  return client;
}

/** Key 轮换或报错后丢弃 client，下次用当前 env 重建 */
function resetClient() {
  client = null;
  clientKeyFingerprint = '';
}

let cachedToken = null;
let cachedExpire = 0;

/**
 * 获取 NLS Token，带内存缓存（过期前 5 分钟刷新）。
 * @returns {Promise<string|null>}
 */
export async function getNlsToken() {
  const accessKeyId = trimEnv(process.env.ALIYUN_ACCESS_KEY_ID);
  const accessKeySecret = trimEnv(process.env.ALIYUN_ACCESS_KEY_SECRET);
  if (!accessKeyId || !accessKeySecret) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExpire > now + 300) {
    return cachedToken;
  }

  const c = getClient();
  if (!c) return null;

  try {
    const result = await c.request('CreateToken', { RegionId: getRegion() });
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
    const code = e.code || e.data?.Code || '';
    console.error('[aliyunNlsToken] CreateToken error', e.message, code, e.data || '');
    if (
      String(code).includes('Inactive') ||
      String(code).includes('InvalidAccessKeyId') ||
      String(e.message || '').includes('disabled')
    ) {
      resetClient();
      cachedToken = null;
      cachedExpire = 0;
      console.error(
        '[aliyunNlsToken] 当前 AccessKey 已被禁用或未生效。请检查：1) 控制台该 Key 为「启用」2) .env 已换为新 Key 且无重复旧行 3) pm2 env 未残留旧 ALIYUN_ACCESS_KEY_ID（可用 pm2 env 0 查看）',
      );
    }
    return null;
  }
}
