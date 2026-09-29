/**
 * `mp_render` 工具：markdown 进，微信可用的 HTML 落盘。
 * @module dsh-wechat-html/tools/render
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolveOutputDir } from '../config.js';
import { CODE_THEMES, previewDocument, render, THEME_NAMES } from '../render/index.js';

/** 由标题或文件名派生的、适合当文件名的 slug。 */
export function slugify(text) {
    const cleaned = text.trim().replace(/[/\\?%*:|"<>.\s]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned.slice(0, 60) || 'article';
}

/** 取原文里第一个 ATX 标题，作为文章名缺省值。 */
export function firstHeading(markdown) {
    return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
}

/**
 * 注册 `mp_render`。
 * @param ctx - 带工具注册表的 context。
 * @param config - 已归一化的排版默认值。
 */
export function registerRenderTool(ctx, config) {
    const outputRoot = resolveOutputDir(config);
    ctx.tools.register(defineTool({
        name: 'mp_render',
        description: 'Typeset markdown into WeChat Official Account HTML. Every style is inlined onto '
            + 'the elements, because the WeChat editor discards <style> blocks and class names. '
            + 'Writes the article body and a standalone preview file, and returns their paths '
            + 'plus the images the article references. Image sources are placeholder tokens, not '
            + 'URLs: WeChat filters images not hosted on its own CDN, so a downstream publisher '
            + 'must upload each image and replace its token. Read-only apart from the output files it writes.',
        parameters: {
            path: {
                type: 'string',
                description: 'Path to a markdown file. Give this OR `markdown`, not both.',
            },
            markdown: {
                type: 'string',
                description: 'Markdown source text. Give this OR `path`, not both.',
            },
            output_dir: {
                type: 'string',
                description: 'Directory to write the HTML into. Defaults to the deployment setting '
                    + `(${outputRoot}). Pass the article directory to keep the output next to the source.`,
            },
            name: {
                type: 'string',
                description: 'Base file name without extension. Defaults to the first heading, '
                    + 'or to the markdown file name.',
            },
            image_base: {
                type: 'string',
                description: 'Directory that relative local image paths resolve against. Defaults to '
                    + 'the markdown file\'s directory. Give it when you pass `markdown` as text, '
                    + 'otherwise relative images come back without a `resolvedPath`.',
            },
            theme: {
                type: 'string',
                enum: [...THEME_NAMES],
                description: `Typesetting theme. Defaults to the deployment setting (${config.theme}).`,
            },
            code_theme: {
                type: 'string',
                enum: Object.keys(CODE_THEMES),
                description: `Code block color scheme. Defaults to ${config.codeTheme}.`,
            },
            primary_color: {
                type: 'string',
                description: `Accent color as a hex value like #0F4C81. Defaults to ${config.primaryColor}.`,
            },
            font_size: {
                type: 'string',
                description: `Body font size, e.g. 15px. Defaults to ${config.fontSize}.`,
            },
            indent: {
                type: 'boolean',
                description: 'Indent the first line of each paragraph by 2em, as Chinese print does.',
            },
            line_numbers: {
                type: 'boolean',
                description: 'Show line numbers in code blocks.',
            },
            preview: {
                type: 'boolean',
                description: 'Also write the standalone preview page. Defaults to true; pass false to '
                    + 'write only the article body.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    htmlPath: {
                        type: 'string',
                        required: true,
                        description: 'File holding the article body. Pass this to a compatible publisher.',
                    },
                    formatVersion: { type: 'integer', required: true, description: 'Version of the render result contract.' },
                    previewPath: {
                        type: 'string',
                        required: true,
                        description: 'Standalone HTML page for a human to open and check the typesetting. Empty when preview was disabled.',
                    },
                    bytes: { type: 'integer', required: true, description: 'UTF-8 size of the article body.' },
                    theme: { type: 'string', required: true },
                    title: { type: 'string', required: true, description: 'Article title taken from the first heading.' },
                    images: {
                        type: 'array',
                        required: true,
                        description: 'Images in document order. Each must be uploaded before the draft is created.',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                token: { type: 'string', required: true, description: 'Placeholder occupying the img src.' },
                                source: { type: 'string', required: true, description: 'Source as written in the markdown.' },
                                isLocal: { type: 'boolean', required: true, description: 'True when the source is a local file.' },
                                resolvedPath: {
                                    type: 'string',
                                    description: 'Absolute path of a local source, resolved against the markdown file.',
                                },
                                alt: { type: 'string', required: true },
                                exists: { type: 'boolean', description: 'Whether the resolved local file exists.' },
                            },
                        },
                    },
                    warnings: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                code: { type: 'string', required: true },
                                message: { type: 'string', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const local = value.images.filter(image => image.isLocal).length;
                const imageNote = value.images.length === 0
                    ? 'No images.'
                    : `${value.images.length} image(s), ${local} local. Upload each image, then replace its token with the uploaded URL.`;
                const warningNote = value.warnings.length === 0
                    ? 'No warnings.'
                    : `Warnings:\n${value.warnings.map(warning => `- [${warning.code}] ${warning.message}`).join('\n')}`;
                return [{
                        type: 'text',
                        text: `Typeset "${value.title}" with the ${value.theme} theme: ${value.bytes} bytes.\n`
                            + `Article body: ${value.htmlPath}\n`
                            + `Preview: ${value.previewPath || '(skipped)'}\n${imageNote}\n${warningNote}`,
                    }];
            },
        },
        async execute(args, exec) {
            if ((args.path === undefined) === (args.markdown === undefined)) {
                throw new Error('mp_render requires exactly one of `path` or `markdown`');
            }
            const sourcePath = args.path === undefined ? undefined : resolvePath(args.path);
            const markdown = sourcePath === undefined
                ? args.markdown
                : await readFile(sourcePath, { encoding: 'utf8', signal: exec.signal });
            if (markdown.trim().length === 0) {
                throw new Error('mp_render received empty markdown');
            }
            const theme = args.theme ?? config.theme;
            const result = render(markdown, {
                theme,
                codeTheme: args.code_theme ?? config.codeTheme,
                primaryColor: args.primary_color ?? config.primaryColor,
                fontFamily: config.fontFamily,
                fontSize: args.font_size ?? config.fontSize,
                legend: config.legend,
                indent: args.indent,
                lineNumbers: args.line_numbers,
            });
            const title = firstHeading(markdown)
                ?? (sourcePath === undefined ? 'article' : basename(sourcePath, extname(sourcePath)));
            const slug = args.name === undefined ? slugify(title) : slugify(args.name);
            const dir = args.output_dir === undefined ? outputRoot : resolvePath(args.output_dir);
            await mkdir(dir, { recursive: true });
            const htmlPath = join(dir, `${slug}.html`);
            const previewPath = args.preview === false ? '' : join(dir, `${slug}.preview.html`);
            await writeFile(htmlPath, result.html, 'utf-8');
            if (previewPath !== '') {
                await writeFile(previewPath, previewDocument(result.html, title), 'utf-8');
            }
            // 相对路径的本地图片是相对 markdown 文件解析的；调用方也可以显式给一个基准目录，
            // 这样纯文本输入（没有源文件）也能拿到可用的 resolvedPath。
            const anchor = args.image_base !== undefined
                ? resolvePath(args.image_base)
                : sourcePath === undefined ? undefined : resolvePath(sourcePath, '..');
            const images = await Promise.all(result.images.map(async image => {
                const resolvedPath = image.isLocal && (anchor !== undefined || isAbsolute(image.source))
                    ? resolvePath(anchor ?? '', image.source)
                    : undefined;
                let exists;
                if (resolvedPath !== undefined) {
                    try {
                        await access(resolvedPath);
                        exists = true;
                    }
                    catch {
                        exists = false;
                    }
                }
                return {
                    token: image.token,
                    source: image.source,
                    isLocal: image.isLocal,
                    alt: image.alt,
                    ...(resolvedPath === undefined ? {} : { resolvedPath, exists }),
                };
            }));
            const missingWarnings = images
                .filter(image => image.exists === false)
                .map(image => ({ code: 'LOCAL_IMAGE_MISSING', message: `找不到本地图片：${image.resolvedPath}` }));
            return {
                formatVersion: result.formatVersion,
                htmlPath,
                previewPath,
                bytes: result.bytes,
                theme,
                title,
                images,
                warnings: [...result.warnings, ...missingWarnings],
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: `Typeset for WeChat${args.theme ? ` (${args.theme})` : ''}`,
            kind: 'other',
            ...args.path ? { locations: [{ path: args.path }] } : {},
        }),
    }));
}
