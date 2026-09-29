/**
 * 主题 CSS 的组装与「降级成字面量」。
 *
 * doocs/md 面向浏览器剪贴板：粘进微信编辑器时，现代 CSS 函数早已被浏览器算好。
 * 本插件是直接把原始 HTML POST 给 draft/add，唯一读者是微信服务端的过滤器，
 * 所以每个 `color-mix()` / `calc()` / `var()` / `hsl()` 都要在发出前换成字面值。
 *
 * 主题 CSS 来自 doocs/md（WTFPL）。
 * @module dsh-wechat-html/render/css
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** 内置模板名。`grace` / `simple` 是叠加在 `default` 之上的覆盖层。 */
export const THEME_NAMES = ['default', 'grace', 'simple'];

const THEME_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const cache = new Map();

function readTheme(file) {
    const hit = cache.get(file);
    if (hit !== undefined)
        return hit;
    const css = readFileSync(join(THEME_DIR, file), 'utf-8');
    cache.set(file, css);
    return css;
}

/**
 * 去掉 `#output` 编辑器作用域，让 juice 能匹配裸的文档片段。
 * 对应 doocs/md `apps/web/src/services/export/share-styles.ts` 的 `stripOutputScope`。
 * @param css - 按编辑器 `#output` 容器写的主题 CSS。
 * @returns 去掉作用域后的同一批规则。
 */
function stripOutputScope(css) {
    return css
        .replace(/#output\s*\{/g, 'body {')
        .replace(/#output\s+/g, '')
        .replace(/^#output\s*/gm, '');
}

/** `--foreground` / `--blockquote-background` 平时由编辑器外壳的 `:root` 提供。 */
const SHELL_VARS = {
    '--foreground': '0 0% 3.9%',
    '--blockquote-background': '#f7f7f7',
};

/**
 * 把每个 `var(--x)` 换成长度字面值。
 * @param css - 可能引用主题或外壳变量的 CSS。
 * @param vars - 变量名 → 字面值。
 * @returns 已知变量名不再残留 `var()` 的 CSS。
 */
function resolveVars(css, vars) {
    // 反复替换到稳定：某个变量的值本身可能又引用另一个变量。
    let out = css;
    for (let pass = 0; pass < 5; pass++) {
        const next = out.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (whole, name, fallback) => {
            const value = vars[name];
            if (value !== undefined)
                return value;
            if (fallback !== undefined)
                return fallback.trim();
            return whole;
        });
        if (next === out)
            break;
        out = next;
    }
    return out;
}

/** `hsl(0 0% 3.9%)` → `#0a0a0a`。微信接受 `hsl()`，但 hex 更短也更稳。 */
function hslToHex(h, s, l) {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const channel = (n) => {
        const k = (n + h / 30) % 12;
        const value = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
        return Math.round(255 * value).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function parseHex(color) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    const digits = m?.[1];
    if (digits === undefined)
        return undefined;
    const hex = digits.length === 3 ? digits.replace(/./g, c => c + c) : digits;
    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
    ];
}

/** 把 `hsl(<h> <s>% <l>%)` 解析成 hex。只处理主题里出现的空格分隔形式。 */
function flattenHsl(css) {
    return css.replace(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/g, (_whole, h, s, l) => hslToHex(Number(h), Number(s), Number(l)));
}

/**
 * 把 `color-mix(in srgb, <color> <pct>%, transparent)` 化成 `rgba(...)`。
 * 内置主题只用这一种形式；其它形式宁可原样留着，也不去猜。
 * @param css - 变量已解析成字面颜色的 CSS。
 * @returns transparent 混色形式被摊平的 CSS。
 */
function flattenColorMix(css) {
    return css.replace(/color-mix\(\s*in\s+srgb\s*,\s*(#[0-9a-f]{3,6})\s+([\d.]+)%\s*,\s*transparent\s*\)/gi, (whole, color, pct) => {
        const rgb = parseHex(color);
        if (!rgb)
            return whole;
        const alpha = Math.round((Number(pct) / 100) * 1000) / 1000;
        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    });
}

/**
 * 把 `calc(<px> * <factor>)` / `calc(<px> / <divisor>)` 算成字面 px。
 * 主题里只会拿基准字号做缩放，通用表达式求值器属于用不上的机器。
 * @param css - 变量已解析的 CSS。
 * @returns 单步 px 运算被约简成字面值的 CSS。
 */
function flattenCalc(css) {
    return css.replace(/calc\(\s*([\d.]+)px\s*([*/])\s*([\d.]+)\s*\)/g, (_whole, base, op, factor) => {
        const value = op === '*' ? Number(base) * Number(factor) : Number(base) / Number(factor);
        return `${Math.round(value * 100) / 100}px`;
    });
}

/**
 * 把主题产出的每个现代 CSS 函数降成微信接受的的字面值。
 * 顺序有讲究：变量先走（它们带着颜色），然后 hsl，再 color-mix（它要吃 hex 字面量），最后 calc。
 * @param css - 组装好的主题 CSS。
 * @param vars - 已解析的排版值。
 * @returns 只含字面值的 CSS。
 */
export function flattenCss(css, vars) {
    const table = {
        ...SHELL_VARS,
        '--md-primary-color': vars.primaryColor,
        '--md-font-family': vars.fontFamily,
        '--md-font-size': vars.fontSize,
    };
    let out = resolveVars(css, table);
    out = flattenHsl(out);
    out = flattenColorMix(out);
    out = flattenCalc(out);
    return out;
}

/**
 * 组装一次渲染所需的完整样式表：base、主题（含叠加层）、highlight.js 配色、
 * 段落选项，最后降级成字面量。
 * @param theme - 内置模板名。
 * @param vars - 已解析的排版值。
 * @param hljsCss - 选中的代码高亮样式表。
 * @param paragraph - 段落缩进/两端对齐选项。
 * @returns 一份可直接交给 juice 的样式表。
 */
export function assembleCss(theme, vars, hljsCss, paragraph = {}) {
    // 对应 doocs/md themeApplicator.ts 的 resolveThemeCSS()：default.css 永远是基底，
    // grace/simple 是追加在后面的叠加层。只加载叠加层会丢掉几乎全部排版规则。
    const themeCss = theme === 'default'
        ? readTheme('default.css')
        : `${readTheme('default.css')}\n\n${readTheme(`${theme}.css`)}`;
    const paragraphCss = paragraph.indent || paragraph.justify
        ? `p {\n${paragraph.indent ? '  text-indent: 2em;\n' : ''}${paragraph.justify ? '  text-align: justify;\n' : ''}}`
        : '';
    const merged = [
        stripOutputScope(readTheme('base.css')),
        stripOutputScope(themeCss),
        hljsCss,
        paragraphCss,
    ].filter(Boolean).join('\n\n');
    return flattenCss(merged, vars);
}
