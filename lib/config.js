/**
 * 排版半边的配置解析。
 *
 * 不引 schemastery：cordis 的 config 本来就是普通对象，这里只做「填默认值 + 校验枚举」，
 * 越少依赖越不容易被 harness 的破坏性变更波及。
 * @module dsh-wechat-html/config
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_THEMES, DEFAULTS, THEME_NAMES } from './render/index.js';

/** 默认产物目录：部署没有指定 outputDir 时落到系统临时目录。 */
export function resolveOutputDir(config) {
    return config.outputDir || join(tmpdir(), 'dsh-wechat-html');
}

/**
 * 把 profile 里写的 config（可能缺项、可能写错）归一化成渲染层能用的完整配置。
 * @param raw - cordis 传进来的原始 config。
 * @returns 每个键都有值的配置对象。
 */
export function resolveConfig(raw) {
    const config = raw ?? {};
    if (config.theme !== undefined && !THEME_NAMES.includes(config.theme))
        throw new Error(`wechat-html: 未知的 theme ${JSON.stringify(config.theme)}，可选：${THEME_NAMES.join(' | ')}`);
    if (config.codeTheme !== undefined && CODE_THEMES[config.codeTheme] === undefined)
        throw new Error(`wechat-html: 未知的 codeTheme ${JSON.stringify(config.codeTheme)}，可选：${Object.keys(CODE_THEMES).join(' | ')}`);
    return {
        theme: config.theme ?? DEFAULTS.theme,
        codeTheme: config.codeTheme ?? DEFAULTS.codeTheme,
        primaryColor: config.primaryColor ?? DEFAULTS.primaryColor,
        fontFamily: config.fontFamily ?? DEFAULTS.fontFamily,
        fontSize: config.fontSize ?? DEFAULTS.fontSize,
        legend: config.legend ?? DEFAULTS.legend,
        outputDir: typeof config.outputDir === 'string' ? config.outputDir : '',
    };
}
