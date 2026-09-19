import type {
  CreatePlainQrCodeInput,
  CreateQrCodeInput,
  CreateUnlimitedQrCodeInput,
  MsgSecCheckInput,
  SendSubscribeMessageInput,
} from './interfaces/miniprogram.interface';
import {
  MINIPROGRAM_MSG_SEC_CHECK_MAX_LENGTH,
  MINIPROGRAM_QR_PATH_MAX_LENGTH,
  MINIPROGRAM_QR_SCENE_PATTERN,
  MINIPROGRAM_QR_WIDTH_MAX,
  MINIPROGRAM_QR_WIDTH_MIN,
  MINIPROGRAM_UNLIMITED_SCENE_MAX_LENGTH,
} from './miniprogram.constants';
import { MiniprogramException } from './miniprogram.exception';

/**
 * 入参校验集合
 *
 * 在发起网络请求**之前**拦截必然失败的调用：这些约束是官方对参数形态的硬性要求，
 * 让微信返回 40097 / 40129 等错误既多一次网络往返，也难以定位到具体字段。
 * real 与 mock 驱动共用同一套校验，保证本地放行的调用在生产不会被拒。
 */

/** 断言登录凭证 jsCode 存在 */
export function assertJsCode(jsCode: string | undefined): asserts jsCode is string {
  if (!jsCode) {
    throw new MiniprogramException('MINIPROGRAM_JS_CODE_MISSING', '缺少登录凭证 jsCode（应由 wx.login 获取）');
  }
}

/** 断言 session_key 相关入参齐备 */
export function assertSessionKeyInput(openid: string | undefined, sessionKey: string | undefined): void {
  if (!openid) {
    throw new MiniprogramException('MINIPROGRAM_OPENID_MISSING', '缺少 openid');
  }
  if (!sessionKey) {
    throw new MiniprogramException('MINIPROGRAM_SESSION_KEY_MISSING', '缺少 session_key（需先调用 code2Session 换取）');
  }
}

/** 断言小程序码宽度落在官方区间内 */
export function assertQrWidth(width: number | undefined): void {
  if (width === undefined) {
    return;
  }
  if (!Number.isInteger(width) || width < MINIPROGRAM_QR_WIDTH_MIN || width > MINIPROGRAM_QR_WIDTH_MAX) {
    throw new MiniprogramException(
      'MINIPROGRAM_QR_WIDTH_INVALID',
      `小程序码宽度必须在 ${MINIPROGRAM_QR_WIDTH_MIN}~${MINIPROGRAM_QR_WIDTH_MAX} 之间（实际 ${width}）`,
    );
  }
}

/**
 * 断言页面路径合法
 *
 * 官方对 path / page 有两条硬性要求：**根路径前不要加 `/`**（否则报 41030 invalid page），
 * 以及**长度不超过 128 字节**（按字节而非字符计算）。
 *
 * @param field 字段名，用于错误文案区分 path 与 page
 */
export function assertQrPath(path: string | undefined, field = 'path'): asserts path is string {
  if (!path) {
    throw new MiniprogramException('MINIPROGRAM_QR_PATH_MISSING', `缺少小程序页面路径 ${field}`);
  }
  const bytes = Buffer.byteLength(path, 'utf8');
  if (bytes > MINIPROGRAM_QR_PATH_MAX_LENGTH) {
    throw new MiniprogramException(
      'MINIPROGRAM_QR_PATH_INVALID',
      `${field} 长度 ${bytes} 字节超过上限 ${MINIPROGRAM_QR_PATH_MAX_LENGTH} 字节`,
    );
  }
  if (path.startsWith('/')) {
    throw new MiniprogramException(
      'MINIPROGRAM_QR_PATH_INVALID',
      `${field} 根路径前不要加 /（应写作 pages/index/index 而非 /pages/index/index）`,
    );
  }
}

/** 断言不限制小程序码入参合法 */
export function assertUnlimitedQrCodeInput(input: CreateUnlimitedQrCodeInput): void {
  const { scene, page } = input;

  if (!scene) {
    throw new MiniprogramException('MINIPROGRAM_QR_SCENE_MISSING', '缺少 scene 参数（不限制小程序码必须携带）');
  }
  // 官方以「可见字符」计数，合法字符集为 ASCII，故按码点计数即可
  const sceneLength = [...scene].length;
  if (sceneLength > MINIPROGRAM_UNLIMITED_SCENE_MAX_LENGTH) {
    throw new MiniprogramException(
      'MINIPROGRAM_QR_SCENE_TOO_LONG',
      `scene 长度 ${sceneLength} 超过上限 ${MINIPROGRAM_UNLIMITED_SCENE_MAX_LENGTH} 个可见字符`,
    );
  }
  if (!MINIPROGRAM_QR_SCENE_PATTERN.test(scene)) {
    throw new MiniprogramException(
      'MINIPROGRAM_QR_SCENE_INVALID',
      'scene 含不合法字符：仅支持数字、大小写英文与部分特殊字符（中文与 % 不在集合内）',
    );
  }

  if (page !== undefined) {
    assertQrPath(page, 'page');
    if (page.includes('?')) {
      throw new MiniprogramException(
        'MINIPROGRAM_QR_PATH_INVALID',
        'page 不能携带参数：参数请放入 scene 字段（小程序端在 onLoad 的 options.scene 中取值）',
      );
    }
  }

  assertQrWidth(input.width);
}

/** 断言小程序码入参合法 */
export function assertQrCodeInput(input: CreateQrCodeInput): void {
  assertQrPath(input.path);
  assertQrWidth(input.width);
}

/** 断言小程序二维码入参合法 */
export function assertPlainQrCodeInput(input: CreatePlainQrCodeInput): void {
  assertQrPath(input.path);
  assertQrWidth(input.width);
}

/** 断言内容安全检测入参合法 */
export function assertMsgSecCheckInput(input: MsgSecCheckInput): void {
  if (!input.content) {
    throw new MiniprogramException('MINIPROGRAM_CONTENT_MISSING', '缺少待检测的文本内容');
  }
  // 官方以字符数计上限（2500 字），Array.from 按码点切分，避免中文与 emoji 被放宽
  if ([...input.content].length > MINIPROGRAM_MSG_SEC_CHECK_MAX_LENGTH) {
    throw new MiniprogramException(
      'MINIPROGRAM_CONTENT_TOO_LONG',
      `待检测文本长度超过上限 ${MINIPROGRAM_MSG_SEC_CHECK_MAX_LENGTH} 字`,
    );
  }
}

/** 断言订阅消息入参合法 */
export function assertSubscribeMessageInput(input: SendSubscribeMessageInput): void {
  if (!input.touser) {
    throw new MiniprogramException('MINIPROGRAM_SUBSCRIBE_INPUT_INVALID', '缺少订阅消息接收者 touser');
  }
  if (!input.templateId) {
    throw new MiniprogramException('MINIPROGRAM_SUBSCRIBE_INPUT_INVALID', '缺少订阅消息模板 ID templateId');
  }
  if (!input.data || Object.keys(input.data).length === 0) {
    throw new MiniprogramException('MINIPROGRAM_SUBSCRIBE_INPUT_INVALID', '缺少订阅消息模板内容 data');
  }
}
