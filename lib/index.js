/**
 * dsh-wechat-html —— 独立的微信公众号排版插件。
 *
 * 只做一件事：markdown → 微信可直接使用的内联样式 HTML，外加一张本地预览页。
 * 不需要公众号凭据、不碰网络，所以账号没配好、接口没权限时它照样能用。
 *
 * 输出采用公开的数据结构，上传或发布能力可以由任意下游工具实现。
 * @module dsh-wechat-html
 */
import { resolveConfig } from './config.js';
import { provideHtmlService } from './service.js';
import { registerRenderTool } from './tools/render.js';

export { DEFAULTS, CODE_THEMES, THEME_NAMES, previewDocument, render } from './render/index.js';
export { resolveConfig, resolveOutputDir } from './config.js';

/** cordis 插件名。 */
export const name = 'wechat-html';

/** 需要工具注册表。 */
export const inject = ['tools'];

/**
 * 注册 `mp_render`，并把排版能力以 `ctx.wechatHtml` 服务发布出去。
 * @param ctx - 带工具注册表的 context。
 * @param config - profile 里写的 config（可缺省）。
 */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    provideHtmlService(ctx, resolved);
    registerRenderTool(ctx, resolved);
}
