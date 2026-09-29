/**
 * 排版层入口：markdown 进，微信可用的内联样式 HTML 出。
 *
 * 刻意不依赖 Cordis，于是它既能被工具壳调用，也能被脚本直接 import
 * （`import { render } from 'dsh-wechat-html/render'`），harness 破坏性变更时受影响的面最小。
 * @module dsh-wechat-html/render
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import juice from 'juice';
import { assembleCss, THEME_NAMES } from './css.js';
import { fillImageUrls, IMAGE_PLACEHOLDER_PREFIX, renderMarkdown } from './markdown.js';
import { applyStructuralFixes, rewriteHostileCss, stripClasses } from './wechat.js';

export { THEME_NAMES, fillImageUrls, IMAGE_PLACEHOLDER_PREFIX };

/** 当前公开渲染结果的结构版本。只在不兼容变更时递增。 */
export const FORMAT_VERSION = 1;

function diagnoseInput(markdown) {
    const warnings = [];
    if (/<\s*(script|style)\b/i.test(markdown))
        warnings.push({ code: 'RAW_ACTIVE_HTML', message: '原文包含 script 或 style 标签，危险标签已从输出中移除。' });
    if (/\son\w+\s*=|(?:href|src)\s*=\s*["']?\s*javascript:/i.test(markdown))
        warnings.push({ code: 'DANGEROUS_HTML_ATTRIBUTE', message: '原文包含事件属性或 javascript URL，危险属性已从输出中移除。' });
    if (/!\[[^\]]*\]\(\s*(?:https?:)?\/\//i.test(markdown))
        warnings.push({ code: 'REMOTE_IMAGE', message: '文章包含远程图片；发布前仍需转存到微信图片 CDN。' });
    return warnings;
}

/** highlight.js 随包自带的样式表，按友好名索引。 */
export const CODE_THEMES = {
    github: 'github.css',
    'github-dark': 'github-dark.css',
    'atom-one-light': 'atom-one-light.css',
    'atom-one-dark': 'atom-one-dark.css',
    vs: 'vs.css',
    monokai: 'monokai.css',
};

/** 中文技术文章的合理默认值。 */
export const DEFAULTS = {
    theme: 'default',
    codeTheme: 'github',
    primaryColor: '#0F4C81',
    fontFamily: `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', sans-serif`,
    fontSize: '15px',
    legend: 'alt-title',
};

const require = createRequire(import.meta.url);
const hljsCssCache = new Map();

/**
 * 从已安装的依赖里读出 highlight.js 样式表。
 * @param theme - 内置代码配色名。
 * @returns 样式表源码。
 */
function readCodeTheme(theme) {
    const file = CODE_THEMES[theme];
    if (file === undefined)
        throw new Error(`未知的 codeTheme ${JSON.stringify(theme)}，可选：${Object.keys(CODE_THEMES).join(' | ')}`);
    const cached = hljsCssCache.get(file);
    if (cached !== undefined)
        return cached;
    const path = require.resolve(`highlight.js/styles/${file}`);
    const css = readFileSync(path, 'utf-8');
    hljsCssCache.set(file, css);
    return css;
}

/**
 * 把 markdown 渲染成微信 draft/add 接受的内联样式 HTML。
 *
 * 图片 src 返回的是占位 token 而不是地址：微信会过滤所有不在自家 CDN 上的图片，
 * 所以调用方要逐张上传，再用 {@link fillImageUrls} 填回结果。
 * @param markdown - 文章原文。
 * @param options - 模板与排版选择。
 * @returns 渲染出的 HTML、它引用的图片，以及字节数。
 */
export function render(markdown, options = {}) {
    const theme = options.theme ?? DEFAULTS.theme;
    if (!THEME_NAMES.includes(theme))
        throw new Error(`未知的 theme ${JSON.stringify(theme)}，可选：${THEME_NAMES.join(' | ')}`);
    const vars = {
        primaryColor: options.primaryColor ?? DEFAULTS.primaryColor,
        fontFamily: options.fontFamily ?? DEFAULTS.fontFamily,
        fontSize: options.fontSize ?? DEFAULTS.fontSize,
    };
    const { html: body, images } = renderMarkdown(markdown, {
        legend: options.legend ?? DEFAULTS.legend,
        lineNumbers: options.lineNumbers,
    });
    const css = assembleCss(theme, vars, readCodeTheme(options.codeTheme ?? DEFAULTS.codeTheme), { indent: options.indent, justify: options.justify });
    // 用 inlineContent 而不是 juice()：输入是片段，juice() 会把它包成完整文档、
    // 在文章外面再吐一层 <html>/<body>。
    let html = juice.inlineContent(body, css, {
        inlinePseudoElements: true,
        preserveImportant: true,
        resolveCSSVariables: false,
    });
    html = rewriteHostileCss(html);
    html = applyStructuralFixes(html);
    if (!options.keepClasses)
        html = stripClasses(html);
    const warnings = diagnoseInput(markdown);
    if (/\b(?:var|color-mix|calc)\(/i.test(html))
        warnings.push({ code: 'UNFLATTENED_CSS', message: '输出中仍有微信可能不支持的 CSS 函数。' });
    return { formatVersion: FORMAT_VERSION, html, images, bytes: Buffer.byteLength(html, 'utf-8'), warnings };
}

/**
 * 把渲染结果包成一张独立页面，让人在任何东西被上传之前先用肉眼过一遍排版。
 * @param html - 渲染出的文章正文。
 * @param title - 浏览器标签页标题。
 * @returns 近似微信正文栏宽的完整 HTML 文档。
 */
export function previewDocument(html, title) {
    const safeTitle = title.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'));
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body { margin: 0; background: #f5f5f5; }
  /* 375px 是微信正文栏宽；内边距对齐读者侧的留白。 */
  .mp-preview { max-width: 375px; margin: 0 auto; padding: 20px 16px; background: #fff; min-height: 100vh; box-sizing: border-box; }
</style>
</head>
<body>
<div class="mp-preview">
${html}
</div>
</body>
</html>
`;
}
