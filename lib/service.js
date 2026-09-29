/**
 * 排版半边对外的 Host 服务：`ctx.wechatHtml`。
 *
 * 投递半边（dsh-wechat-push）的「发公众号」按钮需要把一条聊天回复先排版再上传，
 * 但它不该自己再带一份渲染层。于是排版由这里以服务形式发布，投递侧用
 * `ctx.get('wechatHtml')` 可选消费：装了排版插件就有按钮，没装就报一句明白话。
 *
 * 两个插件因此彼此独立——各自都能单独安装、单独工作。
 * @module dsh-wechat-html/service
 */
import { CODE_THEMES, previewDocument, render, THEME_NAMES } from './render/index.js';

/** 服务名。投递侧读的就是这个键。 */
export const HTML_SERVICE = 'wechatHtml';

/**
 * 发布排版服务。
 * @param ctx - 当前插件的 context。
 * @param config - 已归一化的排版默认值。
 * @returns 注销服务的 disposer（由 cordis 的 fiber 托管，一般不用手动调）。
 */
export function provideHtmlService(ctx, config) {
    const service = {
        /** 内置模板名。 */
        themes: THEME_NAMES,
        /** 内置代码配色名。 */
        codeThemes: Object.keys(CODE_THEMES),
        /**
         * 用部署默认值渲染一段 markdown，调用方只需覆盖想改的那几项。
         * @param markdown - 文章原文。
         * @param options - 本次渲染的覆盖项。
         * @returns 渲染结果，形态与 `dsh-wechat-html/render` 的 `render()` 完全一致。
         */
        render(markdown, options = {}) {
            return render(markdown, {
                theme: config.theme,
                codeTheme: config.codeTheme,
                primaryColor: config.primaryColor,
                fontFamily: config.fontFamily,
                fontSize: config.fontSize,
                legend: config.legend,
                ...options,
            });
        },
        /** 把渲染结果包成独立预览页。 */
        previewDocument,
    };
    return ctx.provide(HTML_SERVICE, service);
}
