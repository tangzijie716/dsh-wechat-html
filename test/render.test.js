import assert from 'node:assert/strict';
import test from 'node:test';
import { fillImageUrls, FORMAT_VERSION, render } from '../lib/render/index.js';
import { applyStructuralFixes } from '../lib/render/wechat.js';

test('render returns a versioned result and independent image tokens', () => {
    const result = render('# 标题\n\n![说明](./image.png)');
    assert.equal(result.formatVersion, FORMAT_VERSION);
    assert.equal(result.images[0].token, 'dsh-wechat-image-0');
    assert.match(result.html, /src="dsh-wechat-image-0"/);
    assert.deepEqual(result.warnings, []);
});

test('strict image replacement rejects unresolved placeholders', () => {
    const html = '<img src="dsh-wechat-image-0"><img src="dsh-wechat-image-1">';
    assert.throws(
        () => fillImageUrls(html, { 'dsh-wechat-image-0': 'https://mmbiz.qpic.cn/a' }, { strict: true }),
        /dsh-wechat-image-1/,
    );
});

test('strict image replacement rejects unknown and empty mappings', () => {
    const html = '<img src="dsh-wechat-image-0">';
    assert.throws(() => fillImageUrls(html, { unknown: 'https://example.com' }, { strict: true }), /不存在/);
    assert.throws(() => fillImageUrls(html, { 'dsh-wechat-image-0': '' }, { strict: true }), /没有可用/);
});

test('render reports remote images and potentially active raw HTML', () => {
    const result = render('![远程图](https://example.com/a.png)\n\n<script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">链接</a>');
    assert.ok(result.warnings.some(warning => warning.code === 'REMOTE_IMAGE'));
    assert.ok(result.warnings.some(warning => warning.code === 'RAW_ACTIVE_HTML'));
    assert.ok(result.warnings.some(warning => warning.code === 'DANGEROUS_HTML_ATTRIBUTE'));
    assert.doesNotMatch(result.html, /<script|javascript:|onclick=/i);
    assert.match(result.html, />链接<\/a>/);
});

test('absolute list badges are rewritten as WeChat-safe hanging indents', () => {
    const html = applyStructuralFixes(
        '<ul><li style="position: relative; padding: 0 0 0 30px">'
        + '<span style="position: absolute; left: 0; font-weight: bold">01</span>摘要正文'
        + '</li></ul>',
    );
    assert.doesNotMatch(html, /position:\s*absolute/);
    assert.match(html, /display:\s*block; padding-left:\s*30px; text-indent:\s*-30px/);
    assert.match(html, /display:\s*inline/);
    assert.match(html, />01(?:&nbsp;|\u00a0){2}<\/span>摘要正文/);
});
