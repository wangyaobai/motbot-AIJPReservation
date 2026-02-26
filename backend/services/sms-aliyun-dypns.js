/**
 * 阿里云号码认证服务（dypnsapi）发送验证码
 * 使用 SendSmsVerifyCode 接口，与「短信服务 dysmsapi」不同，需在号码认证控制台使用赠送的签名与模板
 * 环境变量: ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_SMS_SIGN_NAME, ALIYUN_SMS_TEMPLATE_CODE
 * 签名与模板请从「号码认证服务」控制台获取：赠送签名配置、赠送模板配置
 * https://dypns.console.aliyun.com/smsCertParamsConfig/sign
 * https://dypns.console.aliyun.com/smsCertParamsConfig/template
 */
import crypto from 'crypto';
import https from 'https';

const CODE_EXPIRE_MINUTES = 5;
const ENDPOINT = 'dypnsapi.aliyuncs.com';

function rpcEncode(str) {
  const s = encodeURIComponent(str);
  return s.replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
}

function timestamp() {
  const d = new Date();
  const Y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, '0');
  const D = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D}T${h}:${m}:${s}Z`;
}

function buildRpcSignature(params, secret) {
  const keys = Object.keys(params).sort();
  const canonical = keys.map((k) => rpcEncode(k) + '=' + rpcEncode(params[k])).join('&');
  const stringToSign = 'POST&%2F&' + rpcEncode(canonical);
  const hmac = crypto.createHmac('sha1', secret + '&');
  hmac.update(stringToSign);
  return hmac.digest('base64');
}

/**
 * 发送验证码（号码认证服务 SendSmsVerifyCode）
 * 使用本方生成的 code 传入模板，校验仍由本服务在数据库中完成
 */
export async function sendVerificationCode(phone, code) {
  const accessKeyId = (process.env.ALIYUN_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim();
  const signName = (process.env.ALIYUN_SMS_SIGN_NAME || '').trim();
  const templateCode = (process.env.ALIYUN_SMS_TEMPLATE_CODE || '').trim();

  if (!accessKeyId || !accessKeySecret) {
    return { success: false, message: '未配置阿里云号码认证（AccessKey）' };
  }
  if (!signName || !templateCode) {
    return { success: false, message: '未配置 ALIYUN_SMS_SIGN_NAME 或 ALIYUN_SMS_TEMPLATE_CODE（请使用号码认证控制台赠送的签名与模板）' };
  }

  const phoneNumber = String(phone).replace(/\D/g, '');
  if (!phoneNumber || phoneNumber.length < 11) {
    return { success: false, message: '手机号无效' };
  }

  const templateParam = JSON.stringify({
    code,
    min: String(CODE_EXPIRE_MINUTES),
  });

  const params = {
    Action: 'SendSmsVerifyCode',
    Format: 'JSON',
    Version: '2017-05-25',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    Timestamp: timestamp(),
    SignatureNonce: crypto.randomBytes(16).toString('hex'),
    PhoneNumber: phoneNumber,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: templateParam,
    ValidTime: String(CODE_EXPIRE_MINUTES * 60),
    DuplicatePolicy: '1',
    Interval: '60',
  };

  params.Signature = buildRpcSignature(params, accessKeySecret);

  const body = Object.keys(params)
    .sort()
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: ENDPOINT,
        port: 443,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body, 'utf8'),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.Code === 'OK' && json.Success === true) {
              console.log('[号码认证] 验证码发送成功', { RequestId: json.RequestId, BizId: json.Model?.BizId });
              resolve({ success: true });
            } else {
              console.error('[号码认证] 发送失败', json);
              resolve({ success: false, message: json.Message || json.Code || '发送失败' });
            }
          } catch (e) {
            resolve({ success: false, message: e.message || '解析响应失败' });
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('号码认证请求异常:', err);
      resolve({ success: false, message: err.message || '请求异常' });
    });
    req.write(body, 'utf8');
    req.end();
  });
}
