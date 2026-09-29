/**
 * markdown → 微信兼容 HTML：只负责「结构 + class」，不负责配色。
 *
 * 这是纯函数渲染层：无 Cordis、不写盘、不联网。
 * 图片 src 一律换成占位 token（`dsh-wechat-image-N`），可由投递侧
 * 上传后再填回 mmbiz.qpic.cn 地址——微信会过滤非自家 CDN 的图片。
 * @module dsh-wechat-html/render/markdown
 */
import { Marked } from 'marked';
import hljs from 'highlight.js';
import * as cheerio from 'cheerio';

export const IMAGE_PLACEHOLDER_PREFIX = 'dsh-wechat-image-';

/** `![a](b "c")` 图注文字，按配置的 legend 模式取。 */
function caption(mode, alt, title) {
    switch (mode) {
        case 'none': return '';
        case 'alt': return alt;
        case 'title': return title;
        case 'alt-title': return alt || title;
        case 'title-alt': return title || alt;
    }
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 绝对 http(s) URL 或 data URI 之外，一律当作本地文件。 */
function isLocalSource(src) {
    return !/^(https?:)?\/\//i.test(src) && !/^data:/i.test(src);
}

/**
 * 保留排版所需的普通原始 HTML，但移除会在本地预览页中执行代码的部分。
 * 微信服务端也许会再次过滤，不过安全边界不能依赖下游实现。
 */
function sanitizeActiveHtml(html) {
    const $ = cheerio.load(html, null, false);
    $('script, style, iframe, object, embed').remove();
    $('*').each((_i, el) => {
        const $el = $(el);
        for (const [name, value] of Object.entries(el.attribs ?? {})) {
            const lowerName = name.toLowerCase();
            if (lowerName.startsWith('on') || lowerName === 'srcdoc') {
                $el.removeAttr(name);
                continue;
            }
            if (['href', 'src', 'xlink:href', 'formaction'].includes(lowerName)
                && /^\s*javascript:/i.test(value)) {
                $el.removeAttr(name);
                continue;
            }
            if (lowerName === 'style'
                && /(?:expression\s*\(|url\s*\(\s*['"]?\s*javascript:|-moz-binding\s*:)/i.test(value)) {
                $el.removeAttr(name);
            }
        }
    });
    return $.html();
}

/**
 * 给高亮后的代码包上带行号的 gutter 结构。
 *
 * 微信会丢掉 `<pre>` 里的 `<ol>` 计数器，所以行号必须是行首 span 里的字面文本。
 * @param highlighted - highlight.js 输出的整块 HTML。
 * @returns 每行带行号前缀的 HTML。
 */
function withLineNumbers(highlighted) {
    const lines = highlighted.split('\n');
    const width = String(lines.length).length;
    return lines
        .map((line, i) => {
        const n = String(i + 1).padStart(width, ' ').replace(/ /g, '&nbsp;');
        return `<span class="code__line"><span class="code__ln">${n}&nbsp;&nbsp;</span>${line}</span>`;
    })
        .join('\n');
}

/**
 * 让代码块的空白活过主题的 `white-space: nowrap`。
 *
 * 微信只在 `-webkit-box` + `nowrap` 时才让长代码行横向滚动，而那个组合会把真实
 * 换行和连续空格折叠掉——直接提交的高亮块到了后台会变成挤成一行的长条。
 * 因此换行与缩进必须以标记形式传递，而不是以字符形式。
 * @param highlighted - highlight.js 输出（已 HTML 转义）。
 * @returns 换行与缩进被保留的同一段标记。
 */
function preserveCodeWhitespace(highlighted) {
    return highlighted
        .replace(/\t/g, '    ')
        .replace(/\r\n|\n/g, '<br/>')
        // 只处理文本节点：以 `>` 开头或位于最前面的片段不可能跨进标签，因为 `<` 会终止它。
        .replace(/(>[^<]+)|(^[^<]+)/g, run => run.replace(/ /g, '&nbsp;'));
}

/**
 * 把 markdown 渲染成带主题 class 的 HTML，并把每个图片 `src` 换成占位 token。
 * @param markdown - 文章原文。
 * @param options - legend 与代码块呈现方式。
 * @returns HTML 片段，以及它按文档顺序引用的图片。
 */
export function renderMarkdown(markdown, options = {}) {
    const legend = options.legend ?? 'alt-title';
    const images = [];
    const marked = new Marked({
        gfm: true,
        breaks: false,
        renderer: {
            code({ text, lang }) {
                const requested = (lang ?? '').trim().split(/\s+/)[0];
                const language = requested && hljs.getLanguage(requested) ? requested : 'plaintext';
                let body = hljs.highlight(text, { language }).value;
                if (options.lineNumbers)
                    body = withLineNumbers(body);
                body = preserveCodeWhitespace(body);
                // 只留一个块级子节点：在 `-webkit-box` 下，兄弟 span 和 `<br/>` 会被
                // 某些引擎当作 flex item 排布，行序会乱。
                return `<pre class="hljs code__pre"><code class="language-${language}">`
                    + `<span style="display:block">${body}</span></code></pre>`;
            },
            codespan({ text }) {
                // marked 把行内代码的**原始**内容交给 renderer，并依赖默认 renderer 去转义。
                // 不转义的话，写成行内代码的 `<style>` 会变成真标签，juice 会把后面整篇当 CSS 吃掉。
                return `<code class="codespan">${escapeHtml(text)}</code>`;
            },
            image({ href, title, text }) {
                const token = `${IMAGE_PLACEHOLDER_PREFIX}${images.length}`;
                images.push({
                    token,
                    source: href,
                    isLocal: isLocalSource(href),
                    alt: text ?? '',
                });
                const legendText = caption(legend, text ?? '', title ?? '');
                const figcaption = legendText
                    ? `<figcaption class="md-figcaption">${escapeHtml(legendText)}</figcaption>`
                    : '';
                return `<figure><img src="${token}" alt="${escapeHtml(text ?? '')}"/>${figcaption}</figure>`;
            },
        },
    });
    const html = sanitizeActiveHtml(marked.parse(markdown, { async: false }));
    return { html, images };
}

/**
 * 把上传得到的微信图片地址填回渲染结果。
 *
 * 投递半边（dsh-wechat-push）在创建草稿前调用；两个插件之间只共享这个 token 约定。
 * @param html - 图片 src 仍是占位 token 的 HTML。
 * @param urls - token → 最终 `mmbiz.qpic.cn` 地址。
 * @returns 所有给定 token 都被替换后的 HTML。
 */
export function fillImageUrls(html, urls, options = {}) {
    let out = html;
    for (const [token, url] of Object.entries(urls)) {
        if (options.strict && !out.includes(`src="${token}"`))
            throw new Error(`图片占位符 ${JSON.stringify(token)} 不存在于 HTML 中`);
        if (options.strict && (typeof url !== 'string' || url.trim() === ''))
            throw new Error(`图片占位符 ${JSON.stringify(token)} 没有可用的替换地址`);
        out = out.replaceAll(`src="${token}"`, `src="${escapeHtml(url)}"`);
    }
    if (options.strict) {
        const unresolved = [...out.matchAll(new RegExp(`src="(${IMAGE_PLACEHOLDER_PREFIX}\\d+)"`, 'g'))]
            .map(match => match[1]);
        if (unresolved.length > 0)
            throw new Error(`仍有未替换的图片占位符：${[...new Set(unresolved)].join(', ')}`);
    }
    return out;
}
