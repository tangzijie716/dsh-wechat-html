# dsh-wechat-html

DeepSeek Harness 插件：把 markdown 按主题模板排版成**微信公众号可直接使用的内联样式 HTML**。

这是一个独立的微信公众号排版插件，不需要公众号凭据，也不依赖发布插件。
只安装这一个插件即可生成 HTML，并手工粘贴进公众平台编辑器。

生成的 HTML 和图片清单也可以交给任意兼容工具继续上传或发布；这种集成只消费公开
输出格式，不构成本插件的运行时依赖。

## 为什么需要它

微信编辑器会丢掉 `<style>` 块和 class 名，还会过滤掉所有不在 `mmbiz.qpic.cn` 上的图片。
所以「把 HTML 粘进去」这条路本身就不通。本插件负责其中枯燥又容易错的那半：
**把每一条样式内联到元素上**，并把图片换成占位 token 交给投递侧处理。

具体做了这些（都是踩过的坑）：

- 所有样式内联到元素上（`juice.inlineContent`，输入是片段所以不用 `juice()`）
- `var()` / `hsl()` / `color-mix()` / `calc()` 全部塌成字面量——微信服务端过滤器只认字面量
- `top:Nem` → `transform: translateY(...)`（编辑器会丢弃内联元素上的 `top`）
- `<li>` 内嵌套列表提升为兄弟节点（编辑器会压平嵌套、丢缩进）
- 图片独占一行产生的 `<p><figure>` 非法嵌套替换为裸 `<figure>`
- 代码块用 `<br/>` 与 `&nbsp;` 承载换行与缩进（`nowrap` 组合会吞掉真实换行）
- 内联完成后清掉 `class`，让长文章的体积远低于微信上限

## 安装

```bash
dsh plugin --profile web add file:C:/path/to/dsh-wechat-html
```

装好即生效（`dsh plugin add` 会把声明了 `dsh.bundle` 的依赖自动加进 profile 的 bundle 层）。

## 工具：`mp_render`

markdown 进，微信可用的 HTML 出。写两个文件并返回它们的路径，外加文章引用的图片清单。

| 参数 | 说明 |
|---|---|
| `path` / `markdown` | 二选一：markdown 文件路径，或源码文本 |
| `output_dir` | 产物目录。缺省用部署的 `outputDir`（默认系统临时目录） |
| `name` | 文件名主干（不含扩展名）。缺省取第一个 H1，或 markdown 文件名 |
| `image_base` | 相对本地图片路径的基准目录。缺省取 markdown 文件所在目录；传 `markdown` 文本时给上它，否则相对图不带 `resolvedPath` |
| `theme` | `default` \| `grace` \| `simple` |
| `code_theme` | `github` \| `github-dark` \| `atom-one-light` \| `atom-one-dark` \| `vs` \| `monokai` |
| `primary_color` | 强调色 hex，如 `#0F4C81` |
| `font_size` | 正文字号，如 `15px` |
| `indent` | 段首缩进 2em（中文印刷习惯） |
| `line_numbers` | 代码块显示行号 |
| `preview` | 是否额外写 `.preview.html`（375px 栏宽预览页），默认 `true` |

返回：

```jsonc
{
  "formatVersion": 1,
  "htmlPath": "…/example-article.html",
  "previewPath": "…/example-article.preview.html",
  "bytes": 15164,
  "theme": "default",
  "title": "示例文章",
  "images": [
    { "token": "dsh-wechat-image-0", "source": "IMAGE_PLACEHOLDER", "isLocal": true,
      "resolvedPath": "C:\\path\\to\\article\\cover.png",
      "exists": true, "alt": "" }
  ],
  "warnings": []
}
```

图片 `src` 返回的是**占位 token** 而不是地址。每种本地图都要先上传，再在
下游发布工具中给出 token → 地址的映射。

`formatVersion` 是返回结构的版本号；只有发生不兼容变更时才会递增。`warnings` 会提示
远程图片、找不到的本地图片、潜在危险的原始 HTML，以及未能降级的 CSS。警告不会阻止
生成预览，但应在发布前检查。

## 配置

写在 profile 的 `cordis.patch.yml` 里，按行 id `wechat-html` 改：

```yaml
- id: wechat-html
  config:
    theme: default
    codeTheme: github
    primaryColor: '#0F4C81'
    fontSize: 15px
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"
    outputDir: 'C:\path\to\output'
    legend: alt-title      # 图注：none | alt | title | alt-title | title-alt
```

补丁层会整块替换某一行的 `config`，所以想保留的键都要写全。

## 当库用

排版层不依赖 Cordis / harness，可以直接 import：

```js
import { render, previewDocument } from 'dsh-wechat-html/render'

const { formatVersion, html, images, bytes, warnings } = render(markdown, { theme: 'grace' })
```

上传图片后可以严格填回地址；严格模式会拒绝未知、空值或尚未替换的占位符：

```js
import { fillImageUrls } from 'dsh-wechat-html/render'

const finalHtml = fillImageUrls(html, {
  'dsh-wechat-image-0': 'https://mmbiz.qpic.cn/...',
}, { strict: true })
```

> 在自定义脚本中使用时，请通过包名和公开的 `./render` export 导入，并确保脚本运行环境
> 能按 Node.js 的标准模块解析规则找到该包及其依赖。

## 提供的 Host 服务

`ctx.wechatHtml`（由本插件的行发布）：

- `render(markdown, options)` —— 用部署默认值排版，只需覆盖想改的项
- `previewDocument(html, title)`
- `themes` / `codeThemes` —— 可用枚举

任何下游工具都可以选择消费该服务；双方只通过上述公开接口和渲染结果结构交互。

## 安全边界

- Markdown 中的普通原始 HTML 和内联样式会被保留，以支持自定义排版。
- `script`、`style`、`iframe`、`object`、`embed`、事件属性、`srcdoc` 和
  `javascript:` URL 会在生成预览前移除，并在 `warnings` 中报告。
- `mp_render` 的 `path` 可以读取 DSH 进程有权访问的文件，`output_dir` 可以写入进程有权
  写入的目录。只应让可信调用方使用该工具，并遵循 DSH 本身的权限与沙箱配置。

## 模板来源

样式表来自 [doocs/md](https://github.com/doocs/md)（WTFPL）——中文写作者最熟悉的那个
微信 markdown 编辑器，所以排版看起来是眼熟的。`grace` / `simple` 是叠加在 `default` 之上的覆盖层。

## 改完源码怎么生效

安装方式可能把插件复制进 profile，也可能创建目录链接。为确保 profile 使用的是最新源码，
最稳妥的做法是先移除再安装，然后重启对应 profile：

```powershell
dsh plugin --profile web remove dsh-wechat-html
dsh plugin --profile web add file:C:/path/to/dsh-wechat-html
```

如果 Windows 报创建符号链接权限不足，请关闭正在运行的 DSH，并在管理员 PowerShell 中安装，
或启用 Windows 开发人员模式。改完后重启 DSH Web profile 生效。

## License

本项目采用 [MIT License](LICENSE)。主题 CSS 和部分微信兼容逻辑来自
[doocs/md](https://github.com/doocs/md)，采用 WTFPL；详见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
