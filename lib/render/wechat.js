/**
 * juice 之后的收尾修整：把微信编辑器会弄坏的东西改掉。
 *
 * 移植自 doocs/md `apps/web/src/services/export/clipboard.ts` 与 `clipboard-dom.ts`，
 * 那边跑在浏览器 DOM 上；这里换成 cheerio，于是同样的变换能在 Node 插件进程里跑。
 * @module dsh-wechat-html/render/wechat
 */
import * as cheerio from 'cheerio';

function inlineStyleValue(element, property) {
    const style = element.attr('style') ?? '';
    return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1]?.trim();
}

function inlinePaddingLeft(element) {
    const explicit = inlineStyleValue(element, 'padding-left');
    if (explicit)
        return explicit;
    const shorthand = inlineStyleValue(element, 'padding');
    if (!shorthand)
        return undefined;
    const values = shorthand.split(/\s+/);
    if (values.length === 1)
        return values[0];
    if (values.length === 2 || values.length === 3)
        return values[1];
    return values[3];
}

/**
 * 改写微信编辑器处理不好的内联 CSS。
 *
 * 内联元素上的 `top: <n>em` 会被编辑器丢掉，改成 transform，与 doocs/md 的剪贴板流水线一致。
 * @param html - juice 之后的 HTML。
 * @returns 编辑器不友好声明被改写后的 HTML。
 */
export function rewriteHostileCss(html) {
    return html.replace(/([^-])top:(.*?)em/g, '$1transform: translateY($2em)');
}

/**
 * 施加微信编辑器需要的结构修整。
 *
 * - `<li>` 里嵌套的 `<ul>`/`<ol>` 提到同级：编辑器会悄悄压平嵌套形式并丢掉缩进。
 * - `<img>` 上的 `width`/`height` 属性搬进内联 style：编辑器剥掉表现属性但保留 style。
 * - 首尾各补一个空段落，让作者在粘贴进来的文章上下都有落光标的位置。
 * @param html - 已改写敌意声明的 HTML。
 * @returns 最终交给 `draft/add` 的 HTML 片段。
 */
export function applyStructuralFixes(html) {
    const $ = cheerio.load(html, null, false);
    // 把嵌套列表提出 <li>（doocs 的 modifyHtmlStructure）。
    $('li > ul, li > ol').each((_i, el) => {
        $(el).parent().after(el);
    });
    // 微信服务端会丢掉列表编号常用的 absolute 定位，还可能把 inline-block 编号
    // 与后面的裸文本拆成两行。把二者收进同一个包装，靠 text-indent 做悬挂缩进；
    // 编号本身只用普通 inline，不再给微信留下可拆成独立排版行的盒子。
    $('li > span').each((_i, el) => {
        const $badge = $(el);
        const $li = $badge.parent();
        if (inlineStyleValue($badge, 'position') !== 'absolute'
            || !/^0(?:px|em|rem|%)?$/.test(inlineStyleValue($badge, 'left') ?? ''))
            return;
        const paddingLeft = inlinePaddingLeft($li);
        if (!paddingLeft || !/^[\d.]+(?:px|em|rem|%)$/.test(paddingLeft) || Number.parseFloat(paddingLeft) === 0)
            return;
        $badge.append('\u00a0\u00a0');
        $badge.css({
            position: 'static',
            left: 'auto',
            display: 'inline',
            width: 'auto',
            'margin-left': '0',
            'vertical-align': 'baseline',
        });
        const $line = $('<span></span>').css({
            display: 'block',
            'padding-left': paddingLeft,
            'text-indent': `-${paddingLeft}`,
        });
        $line.append($li.contents());
        $li.css('padding-left', '0');
        $li.append($line);
    });
    // 独占一行的图片会变成 <p> 包着块级 <figure>，这是非法嵌套：浏览器会自动闭合 <p>，
    // 编辑器继承到的就是坏结构。用其中的 figure 替换掉这个段落。
    $('p').each((_i, el) => {
        const $p = $(el);
        const children = $p.children();
        if (children.length === 1 && children.first().is('figure') && $p.text().trim() === $p.find('figcaption').text().trim()) {
            $p.replaceWith(children.first());
        }
    });
    // 把 img 的尺寸属性搬进 style（doocs 的 solveWeChatImage）。
    $('img').each((_i, el) => {
        const $img = $(el);
        for (const attr of ['width', 'height']) {
            const value = $img.attr(attr);
            if (!value)
                continue;
            $img.removeAttr(attr);
            $img.css(attr, /^\d+$/.test(value) ? `${value}px` : value);
        }
    });
    const spacer = '<p style="font-size: 0; line-height: 0; margin: 0;">&nbsp;</p>';
    return `${spacer}${$.html()}${spacer}`;
}

/**
 * 样式全部内联之后，把 class 属性清掉。
 *
 * 编辑器本来就会丢 class 名；删掉能让长文章的正文体积远低于微信的内容大小上限。
 * @param html - 样式已完全内联的 HTML。
 * @returns 去掉 `class` 属性的同一份 HTML。
 */
export function stripClasses(html) {
    return html.replace(/\s+class="[^"]*"/g, '');
}
