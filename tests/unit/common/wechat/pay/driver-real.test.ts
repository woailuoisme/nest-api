import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signMessage } from '@/common/wechat/pay/crypto/signer';
import { buildVerifyMessage } from '@/common/wechat/pay/crypto/verifier';
import { RealWepayDriver } from '@/common/wechat/pay/drivers/real.driver';
import { WEPAY_BILL_READY_RETRY_DELAY_MS, WEPAY_HEADERS } from '@/common/wechat/pay/wepay.constants';
import { isWepayRetryable, WepayException } from '@/common/wechat/pay/wepay.exception';

/** 与驱动配置一致的公钥 ID（应答头 serial 必须匹配） */
const PUBLIC_KEY_ID = 'PUB_KEY_ID_TEST';
/** 应答固定 nonce，便于构造签名 */
const RESPONSE_NONCE = 'RESPONSE_NONCE';
const API_V3_KEY = 'x'.repeat(32);

let privateKey: KeyObject;
let otherPrivateKey: KeyObject;
let publicKeyPem: string;
let driver: RealWepayDriver;

/** 构造伪造的 fetch 应答对象（文本与二进制共用同一缓冲区，保证两处视图一致） */
function fakeResponse(body: string | Buffer, status: number, headers: Record<string, string> = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    text: async () => buffer.toString('utf8'),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null },
  } as unknown as Response;
}

/** 构造携带合法应答签名的 200 应答 */
function signedResponse(bodyText: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return fakeResponse(bodyText, 200, {
    [WEPAY_HEADERS.TIMESTAMP]: timestamp,
    [WEPAY_HEADERS.NONCE]: RESPONSE_NONCE,
    [WEPAY_HEADERS.SERIAL]: PUBLIC_KEY_ID,
    [WEPAY_HEADERS.SIGNATURE]: signMessage(buildVerifyMessage(timestamp, RESPONSE_NONCE, bodyText), privateKey),
  });
}

/** 读取 fetch mock 首次调用的 URL 与请求头 */
function readRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, body: init.body as string, headers: init.headers as Record<string, string> };
}

/** 将 UTC 偏移后的时间格式化为 yyyy-MM-DD */
function formatBillDate(offsetMs: number): string {
  const date = new Date(Date.now() + offsetMs);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** 已就绪且在可下载范围内的账单日期（2 天前） */
function readyBillDate(): string {
  return formatBillDate(-2 * 24 * 60 * 60 * 1000);
}

/** 当日账单必然未就绪（需次日北京时间 10:00 后） */
function todayBillDate(): string {
  return formatBillDate(0);
}

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  otherPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
});

beforeEach(() => {
  driver = new RealWepayDriver({
    appid: 'wx-test-appid',
    mchid: '1900000001',
    serialNo: 'MCH-SERIAL-001',
    privateKey,
    apiV3Key: API_V3_KEY,
    notifyUrl: 'https://api.test/v1/payments/wepay/notify',
    publicKeyPem,
    publicKeyId: PUBLIC_KEY_ID,
    logger: new Logger('RealWepayDriverTest'),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('微信支付 v3 real 驱动', () => {
  it('下单应携带 Authorization 签名头并返回 code_url', async () => {
    const fetchMock = vi.fn(async () => signedResponse(JSON.stringify({ code_url: 'weixin://wxpay/pr=MOCK' })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await driver.createNative({
      outTradeNo: 'ORDER-1',
      description: '测试商品',
      amount: { total: 100 },
    });

    expect(result.codeUrl).toBe('weixin://wxpay/pr=MOCK');
    const { url, body, headers } = readRequest(fetchMock);
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    expect(headers.Authorization).toContain('WECHATPAY2-SHA256-RSA2048');
    expect(headers.Authorization).toContain('mchid="1900000001"');
    expect(headers.Authorization).toContain('serial_no="MCH-SERIAL-001"');
    expect(JSON.parse(body)).toMatchObject({
      appid: 'wx-test-appid',
      mchid: '1900000001',
      out_trade_no: 'ORDER-1',
      notify_url: 'https://api.test/v1/payments/wepay/notify',
    });
  });

  it('单次调用传入的 notifyUrl 应覆盖全局默认回调地址', async () => {
    const fetchMock = vi.fn(async () => signedResponse(JSON.stringify({ code_url: 'weixin://x' })));
    vi.stubGlobal('fetch', fetchMock);

    await driver.createNative({
      outTradeNo: 'ORDER-2',
      description: '测试商品',
      amount: { total: 100 },
      notifyUrl: 'https://override.test/notify',
    });

    expect(JSON.parse(readRequest(fetchMock).body).notify_url).toBe('https://override.test/notify');
  });

  it('缺少回调地址时应明确报错而非静默发出无效请求', async () => {
    const bareDriver = new RealWepayDriver({
      appid: 'wx-test-appid',
      mchid: '1900000001',
      serialNo: 'MCH-SERIAL-001',
      privateKey,
      apiV3Key: API_V3_KEY,
      publicKeyPem,
      publicKeyId: PUBLIC_KEY_ID,
      logger: new Logger('RealWepayDriverTest'),
    });
    vi.stubGlobal('fetch', vi.fn());

    const error = (await bareDriver
      .createNative({ outTradeNo: 'ORDER-3', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_NOTIFY_URL_MISSING');
  });

  it.each([
    // [错误码, 微信应答状态码（官方标注）, 期望映射到本服务的状态]
    // 公共错误码
    ['PARAM_ERROR', 400, 400],
    ['INVALID_REQUEST', 400, 400],
    ['SIGN_ERROR', 401, 401],
    ['SYSTEM_ERROR', 500, 500],
    // 商户、AppID 与权限（MCH_NOT_EXISTS 在各接口标注不同，见下方专项用例）
    ['APPID_MCHID_NOT_MATCH', 400, 400],
    ['MCH_NOT_EXISTS', 400, 400],
    ['NO_AUTH', 403, 403],
    ['NOAUTH', 403, 403],
    // 交易与订单状态
    ['ORDER_CLOSED', 400, 400],
    ['ORDER_PAID', 400, 400],
    ['OUT_TRADE_NO_USED', 403, 403],
    ['RULE_LIMIT', 403, 403],
    ['TRADE_ERROR', 403, 403],
    // 账户侧
    ['ACCOUNT_ERROR', 403, 403],
    ['NOT_ENOUGH', 403, 403],
    ['USER_ACCOUNT_ABNORMAL', 403, 403],
    // 资源不存在
    ['RESOURCE_NOT_EXISTS', 404, 404],
    ['ORDER_NOT_EXIST', 404, 404],
    ['USER_NOT_EXISTS', 404, 404],
    // 账单
    ['NO_STATEMENT_EXIST', 400, 400],
    ['STATEMENT_CREATING', 400, 400],
    // 频率限制
    ['FREQUENCY_LIMITED', 429, 429],
  ])('微信错误码 %s（应答 %i）应映射为 HTTP %i', async (code, upstreamStatus, expectedStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(JSON.stringify({ code, message: '失败', detail: { field: 'amount' } }), upstreamStatus),
      ),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-4', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error).toBeInstanceOf(WepayException);
    expect(error.wepayCode).toBe(code);
    expect(error.getStatus()).toBe(expectedStatus);
    expect(error.message).toContain('字段 amount');
  });

  it('同一错误码应严格遵循官方在各接口的状态标注（MCH_NOT_EXISTS：下单 400 / 退款 404）', async () => {
    const body = JSON.stringify({ code: 'MCH_NOT_EXISTS', message: '商户号不存在' });

    // 下单接口：官方标注 400
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(body, 400)),
    );
    const placeOrder = (await driver
      .createNative({ outTradeNo: 'ORDER-15', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(placeOrder.wepayCode).toBe('MCH_NOT_EXISTS');
    expect(placeOrder.getStatus()).toBe(400);

    // 退款接口：官方标注 404
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(body, 404)),
    );
    const applyRefund = (await driver
      .refund({ outRefundNo: 'REFUND-9', outTradeNo: 'ORDER-15', amount: { refund: 100, total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(applyRefund.wepayCode).toBe('MCH_NOT_EXISTS');
    expect(applyRefund.getStatus()).toBe(404);
  });

  it('未收录的错误码应透传微信应答状态，不做本地改写', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(JSON.stringify({ code: 'BRAND_NEW_CODE', message: '未知' }), 403)),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-16', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('BRAND_NEW_CODE');
    expect(error.getStatus()).toBe(403);
  });

  it('应答签名不匹配时应拒绝该应答', async () => {
    const bodyText = JSON.stringify({ code_url: 'weixin://forged' });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(bodyText, 200, {
          [WEPAY_HEADERS.TIMESTAMP]: timestamp,
          [WEPAY_HEADERS.NONCE]: RESPONSE_NONCE,
          [WEPAY_HEADERS.SERIAL]: PUBLIC_KEY_ID,
          // 使用非微信侧密钥伪造签名
          [WEPAY_HEADERS.SIGNATURE]: signMessage(
            buildVerifyMessage(timestamp, RESPONSE_NONCE, bodyText),
            otherPrivateKey,
          ),
        }),
      ),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-5', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_RESPONSE_SIGNATURE_INVALID');
  });

  it('请求超时应转译为 504 网关超时', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-6', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_TIMEOUT');
    expect(error.getStatus()).toBe(504);
  });

  it('网络异常应转译为 502 网关错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-7', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_NETWORK_ERROR');
    expect(error.getStatus()).toBe(502);
  });

  it('合法回调应通过验签并解密出业务资源', async () => {
    const { encryptAesGcmResource } = await import('@/common/wechat/pay/crypto/cipher');
    const resource = { out_trade_no: 'ORDER-8', transaction_id: 'TX-8', trade_state: 'SUCCESS' };
    const envelope = {
      id: 'notify-8',
      create_time: '2026-01-01T00:00:00+08:00',
      event_type: 'TRANSACTION.SUCCESS',
      resource_type: 'encrypt-resource',
      summary: '支付成功',
      resource: encryptAesGcmResource(JSON.stringify(resource), API_V3_KEY, 'transaction'),
    };
    const rawBody = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const payload = await driver.verifyAndDecryptNotify(
      {
        timestamp,
        nonce: RESPONSE_NONCE,
        serial: PUBLIC_KEY_ID,
        signature: signMessage(buildVerifyMessage(timestamp, RESPONSE_NONCE, rawBody), privateKey),
      },
      rawBody,
    );

    expect(payload).toMatchObject({
      id: 'notify-8',
      eventType: 'TRANSACTION.SUCCESS',
      summary: '支付成功',
      resource,
    });
  });

  it('回调报文被篡改时应验签失败并返回 401', async () => {
    const rawBody = JSON.stringify({ id: 'notify-9', resource: { ciphertext: 'x' } });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signMessage(buildVerifyMessage(timestamp, RESPONSE_NONCE, rawBody), privateKey);

    const error = (await driver
      .verifyAndDecryptNotify({ timestamp, nonce: RESPONSE_NONCE, serial: PUBLIC_KEY_ID, signature }, `${rawBody} `)
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_NOTIFY_SIGNATURE_INVALID');
    expect(error.getStatus()).toBe(401);
  });

  it('回调缺少签名头应返回 400，时间戳越界应视为重放', async () => {
    const missing = (await driver
      .verifyAndDecryptNotify({ nonce: 'nonce' }, '{}')
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(missing.wepayCode).toBe('WEPAY_NOTIFY_HEADERS_MISSING');
    expect(missing.getStatus()).toBe(400);

    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const staleBody = '{}';
    const replay = (await driver
      .verifyAndDecryptNotify(
        {
          timestamp: staleTimestamp,
          nonce: RESPONSE_NONCE,
          serial: PUBLIC_KEY_ID,
          signature: signMessage(buildVerifyMessage(staleTimestamp, RESPONSE_NONCE, staleBody), privateKey),
        },
        staleBody,
      )
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(replay.wepayCode).toBe('WEPAY_NOTIFY_TIMESTAMP_INVALID');
    expect(replay.getStatus()).toBe(400);
  });

  it('公钥模式下健康检查应报告 up 且不发起外部请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const health = await driver.checkHealth();

    expect(health).toMatchObject({ status: 'up', driver: 'real', certificateMode: 'public-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('账单下载地址缺失时应经退避重试后以 400 报告未就绪', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => signedResponse(JSON.stringify({})));
    vi.stubGlobal('fetch', fetchMock);

    const pending = driver
      .downloadTradeBill({ billDate: readyBillDate(), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException) as unknown as Promise<WepayException>;
    await vi.advanceTimersByTimeAsync(WEPAY_BILL_READY_RETRY_DELAY_MS * 5);
    const error = await pending;

    expect(error.wepayCode).toBe('WEPAY_BILL_NOT_READY');
    // 与官方 NO_STATEMENT_EXIST / STATEMENT_CREATING 的 400 语义保持一致
    expect(error.getStatus()).toBe(400);
    // 首次 + WEPAY_BILL_READY_RETRIES(3) 次长间隔退避
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('账单生成中应长间隔退避重试，就绪后签名下载并校验摘要', async () => {
    vi.useFakeTimers();
    const billContent = ',商户订单号\n,MOCK-ORDER-1\n';
    const hashValue = createHash('sha1').update(billContent).digest('hex');
    let urlAttempts = 0;
    let downloadUrl: string | undefined;
    let downloadAuthHeader: string | undefined;

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('billdownload')) {
        downloadUrl = url;
        downloadAuthHeader = (init.headers as Record<string, string>).Authorization;
        return fakeResponse(billContent, 200);
      }
      urlAttempts += 1;
      if (urlAttempts === 1) {
        return fakeResponse(JSON.stringify({ code: 'STATEMENT_CREATING', message: '账单生成中' }), 400);
      }
      return signedResponse(
        JSON.stringify({
          hash_type: 'SHA1',
          hash_value: hashValue,
          download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = driver.downloadTradeBill({ billDate: readyBillDate(), billType: 'ALL' });
    await vi.advanceTimersByTimeAsync(WEPAY_BILL_READY_RETRY_DELAY_MS * 2);
    const content = await pending;

    // 第 1 次未就绪 → 退避后第 2 次拿到下载凭据 → 第 3 次下载账单文件
    expect(urlAttempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(content).toBe(billContent);

    // 官方要求对 download_url 的 path + query 按 APIv3 标准签名后携带 Authorization 请求
    expect(downloadUrl).toBe('https://api.mch.weixin.qq.com/v3/billdownload/file?token=x');
    expect(downloadAuthHeader).toContain('WECHATPAY2-SHA256-RSA2048');
  });

  it('tar_type=GZIP 时应解压后再以解压内容的摘要校验完整性', async () => {
    const billContent = ',商户订单号\n,MOCK-ORDER-1\n';
    // 官方口径：hash_value 是「原始账单（gzip 需要解压缩）」的摘要值
    const hashValue = createHash('sha1').update(billContent).digest('hex');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('billdownload')) {
        return fakeResponse(gzipSync(Buffer.from(billContent, 'utf8')), 200);
      }
      return signedResponse(
        JSON.stringify({
          hash_type: 'SHA1',
          hash_value: hashValue,
          download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x&tar_type=gzip',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const content = await driver.downloadTradeBill({
      billDate: readyBillDate(),
      billType: 'ALL',
      tarType: 'GZIP',
    });

    expect(content).toBe(billContent);
  });

  it('账单摘要不匹配时应拒绝该文件而非交给业务侧', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('billdownload')) {
        return fakeResponse(',商户订单号\n,MOCK-ORDER-1\n', 200);
      }
      return signedResponse(
        JSON.stringify({
          hash_type: 'SHA1',
          hash_value: '0000000000000000000000000000000000000000',
          download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const error = (await driver
      .downloadTradeBill({ billDate: readyBillDate(), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_BILL_HASH_MISMATCH');
    expect(error.getStatus()).toBe(502);
  });

  it('申请账单应答缺少 hash_type / hash_value 时应以应答异常上报', async () => {
    const downloadUrl = 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x';

    // 仅缺 hash_value：无摘要则无法校验完整性
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => signedResponse(JSON.stringify({ hash_type: 'SHA1', download_url: downloadUrl }))),
    );
    const missingHashValue = (await driver
      .downloadTradeBill({ billDate: readyBillDate(), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(missingHashValue.wepayCode).toBe('WEPAY_INVALID_RESPONSE');
    expect(missingHashValue.message).toContain('hash_value');

    // 连 hash_type 一并缺失
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => signedResponse(JSON.stringify({ download_url: downloadUrl }))),
    );
    const missingHashType = (await driver
      .downloadTradeBill({ billDate: readyBillDate(), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(missingHashType.wepayCode).toBe('WEPAY_INVALID_RESPONSE');
    expect(missingHashType.message).toContain('hash_type');
  });

  it('账单文件不存在属确定性结果，不应触发退避重试', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(JSON.stringify({ code: 'NO_STATEMENT_EXIST', message: '账单文件不存在' }), 400),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = (await driver
      .downloadTradeBill({ billDate: readyBillDate(), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('NO_STATEMENT_EXIST');
    expect(error.getStatus()).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('账单日尚未到就绪时刻时应本地拦截且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = (await driver
      .downloadFundFlowBill({ billDate: todayBillDate(), accountType: 'BASIC' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_BILL_NOT_READY');
    expect(error.getStatus()).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('账单日期格式非法时应本地拦截且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = (await driver
      .downloadTradeBill({ billDate: '2026/01/01', billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_BILL_DATE_INVALID');
    expect(error.getStatus()).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('账单日期超出可下载回溯范围时应本地拦截且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = (await driver
      .downloadTradeBill({ billDate: formatBillDate(-200 * 24 * 60 * 60 * 1000), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_BILL_DATE_OUT_OF_RANGE');
    expect(error.getStatus()).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('申请退款应命中退款接口并解析退款结果', async () => {
    const fetchMock = vi.fn(async () =>
      signedResponse(
        JSON.stringify({
          out_refund_no: 'REFUND-1',
          refund_id: 'RID-1',
          out_trade_no: 'ORDER-1',
          status: 'SUCCESS',
          success_time: '2026-01-01T00:00:00+08:00',
          amount: { total: 100, refund: 100 },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await driver.refund({
      outRefundNo: 'REFUND-1',
      outTradeNo: 'ORDER-1',
      reason: '用户取消',
      amount: { refund: 100, total: 100 },
    });

    expect(result).toMatchObject({ outRefundNo: 'REFUND-1', refundId: 'RID-1', status: 'SUCCESS' });
    expect(result.amount).toEqual({ total: 100, refund: 100 });
    expect(readRequest(fetchMock).url).toBe('https://api.mch.weixin.qq.com/v3/refund/domestic/refunds');
  });

  it('退款回调地址应回退全局配置，且允许单次覆盖', async () => {
    const fetchMock = vi.fn(async () => signedResponse(JSON.stringify({ out_refund_no: 'R', status: 'PROCESSING' })));
    vi.stubGlobal('fetch', fetchMock);

    await driver.refund({ outRefundNo: 'REFUND-2', outTradeNo: 'ORDER-1', amount: { refund: 100, total: 100 } });
    expect(JSON.parse(readRequest(fetchMock).body).notify_url).toBe('https://api.test/v1/payments/wepay/notify');

    fetchMock.mockClear();
    await driver.refund({
      outRefundNo: 'REFUND-3',
      outTradeNo: 'ORDER-1',
      amount: { refund: 100, total: 100 },
      notifyUrl: 'https://override.test/refund-notify',
    });
    expect(JSON.parse(readRequest(fetchMock).body).notify_url).toBe('https://override.test/refund-notify');
  });

  it('退款缺少交易标识时应在发起请求前本地拦截', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = (await driver
      .refund({ outRefundNo: 'REFUND-4', amount: { refund: 100, total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_REFUND_TARGET_MISSING');
    expect(error.getStatus()).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('退款金额非法或超过订单总额时应在发起请求前本地拦截', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const zeroAmount = (await driver
      .refund({ outRefundNo: 'REFUND-5', outTradeNo: 'ORDER-1', amount: { refund: 0, total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(zeroAmount.wepayCode).toBe('WEPAY_REFUND_AMOUNT_INVALID');
    expect(zeroAmount.getStatus()).toBe(400);

    const exceeded = (await driver
      .refund({ outRefundNo: 'REFUND-6', outTradeNo: 'ORDER-1', amount: { refund: 101, total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(exceeded.wepayCode).toBe('WEPAY_REFUND_AMOUNT_EXCEEDED');
    expect(exceeded.getStatus()).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('按商户退款单号查询退款应命中查询接口', async () => {
    const fetchMock = vi.fn(async () =>
      signedResponse(JSON.stringify({ out_refund_no: 'REFUND-7', status: 'PROCESSING' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await driver.queryRefund('REFUND-7');

    expect(result.status).toBe('PROCESSING');
    expect(readRequest(fetchMock).url).toBe('https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/REFUND-7');
  });

  it('错误应答中的字段级定位信息应被结构化保留', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(
          JSON.stringify({
            code: 'PARAM_ERROR',
            message: '参数错误',
            detail: { field: 'amount.total', value: '0', issue: '必须大于 0', location: 'body' },
          }),
          400,
        ),
      ),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-9', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.detail).toEqual({
      field: 'amount.total',
      value: '0',
      issue: '必须大于 0',
      location: 'body',
    });
    expect(error.message).toContain('字段 amount.total');
  });

  it('上游返回非 JSON 的网关应答时应转译为可重试的通用错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse('<html>502 Bad Gateway</html>', 502)),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-10', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_HTTP_ERROR');
    expect(error.getStatus()).toBe(502);
    expect(isWepayRetryable(error)).toBe(true);
  });

  it('2xx 应答缺少必需字段时应以应答异常上报而非把 undefined 流入业务', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => signedResponse(JSON.stringify({}))),
    );

    const error = (await driver
      .createNative({ outTradeNo: 'ORDER-11', description: '测试商品', amount: { total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_INVALID_RESPONSE');
    expect(error.getStatus()).toBe(502);
    expect(error.message).toContain('code_url');
  });

  it.each([
    ['PARAM_ERROR', false],
    ['INVALID_REQUEST', false],
    ['SIGN_ERROR', false],
    ['ORDER_CLOSED', false],
    ['NOT_ENOUGH', false],
    ['RESOURCE_NOT_EXISTS', false],
    ['NO_AUTH', false],
    ['SYSTEM_ERROR', true],
    ['FREQUENCY_LIMITED', true],
    ['WEPAY_TIMEOUT', true],
    ['WEPAY_NETWORK_ERROR', true],
    ['WEPAY_HTTP_ERROR', true],
  ])('错误码 %s 的可重试性应为 %s', async (code, retryable) => {
    expect(isWepayRetryable(new WepayException(code, 'x'))).toBe(retryable);
  });

  it('查询类操作遇到不可重试错误时不应重试，遇到系统异常应重试到上限', async () => {
    const nonRetryable = vi.fn(async () =>
      fakeResponse(JSON.stringify({ code: 'ORDER_CLOSED', message: '订单已关闭' }), 400),
    );
    vi.stubGlobal('fetch', nonRetryable);
    await driver.queryByOutTradeNo('ORDER-12').catch(() => undefined);
    expect(nonRetryable).toHaveBeenCalledTimes(1);

    const retryable = vi.fn(async () =>
      fakeResponse(JSON.stringify({ code: 'SYSTEM_ERROR', message: '系统异常' }), 500),
    );
    vi.stubGlobal('fetch', retryable);
    await driver.queryByOutTradeNo('ORDER-13').catch(() => undefined);
    // 首次 + WEPAY_READ_RETRIES(2) 次重试
    expect(retryable).toHaveBeenCalledTimes(3);
  });

  it('写操作即使遇到系统异常也不应自动重试', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(JSON.stringify({ code: 'SYSTEM_ERROR', message: '系统异常' }), 500),
    );
    vi.stubGlobal('fetch', fetchMock);

    await driver
      .refund({ outRefundNo: 'REFUND-8', outTradeNo: 'ORDER-14', amount: { refund: 100, total: 100 } })
      .catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
