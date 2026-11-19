# 独立运行 ComfyArt

网页沿用 ComfyArt 的首页、项目库、聊天面板和 tldraw 画布。独立的 aiohttp 服务监听本机回环地址，默认端口为 8190。这个版本面向本机单用户。

## 安装与启动

使用 Python 3.10 以上、Node.js 24 和 npm。进入仓库目录后执行一次：

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm ci
npm run build
```

本机已有项目使用下面的命令启动。两个路径指向独立版的作品目录和只读的 tldraw 配置来源：

```sh
COMFYART_DATA="$PWD/.local/data" DSH_HOME="$PWD/.local/dsh" \
  COMFYART_TLDRAW="../../tldraw" ./start.sh --port 8190
```

打开 [ComfyArt 首页](http://127.0.0.1:8190/comfyart/)。当前机器使用的原项目配置包含 Node 路径、DSH 引擎目录和 VectorCraft CLI 路径。启动器通过环境变量向 DSH 提供 tldraw 的 DeepSeek API Key，仓库和网站响应中均不存放密钥。

在其他机器上，可以把 `dsh`、`node`、`vectorcraft-cli` 加入 PATH，或用 `COMFYART_DSH`、`VECTORCRAFT_CLI` 指向实际程序，再运行 `./start.sh`。DSH 源码构建支持直接指定 `apps/cli/lib/bin.js`。模型认证可以通过 `DEEPSEEK_API_KEY` 提供；使用已登录的 DSH 账号时，用 `DSH_HOME` 指向该账号的配置目录。没有显式配置目录时，作品保存在 `~/.local/share/comfyart`，独立 DSH profile 与会话在其 `dsh/` 子目录中。需要指定模型时，在网页的 DeepSeek Harness 菜单选择 DSH 实际列出的模型。

## 对话、原稿和保存

在聊天里输入「帮我找 3 张黑白拼贴 Zine 封面参考，附来源」，Agent 会通过 `search_images` 搜索 Brave 图片并返回参考链接。启动后端时设置 `BRAVE_SEARCH_API_KEY` 即可启用。使用 `COMFYART_TLDRAW` 启动时，默认沿用本机 tldraw 配置中的 `braveSearchApiKey`，显式设置的环境变量优先。

- 网页通过同源 HTTP 发送消息和附件。网站复用 ComfyArt 原有 ACP 适配器启动 DSH，用 `session/new` 创建会话，后续通过 `session/resume` 恢复同一会话。
- DSH 调用网站提供的 HTTP MCP 工具 `render_vectorcraft`。网站从聊天记录确定目标项目，把静态 SVG 放入该项目的临时目录，使用本机 tldraw 项目的 stdio 客户端启动 `vectorcraft-cli mcp --headless`。VectorCraft 打开 SVG、保存原稿并导出 PNG，读写范围限于本次渲染目录。
- 网站将三个文件作为一组保存到 `output/vectorcraft/<项目摘要>/<内容摘要>/`。网站经 WebSocket 向打开该项目的标签页发送命令，画布返回实际对象 ID。关闭项目会收到投放失败的错误，使用同一原稿重试可复用已完成渲染。
- 选中作品可移动、缩放、旋转、裁剪，或从「更多」下载 SVG 和 VectorCraft 原稿。画布上的波浪、路径等内部元素属于同一张图片。选中它后可以让 Agent 读取原始 SVG 并生成修改版。用 `add_text` 添加的文字是独立可编辑图层。
- 项目快照、版本和聊天保存在 `data.db`，用户偏好在 `userdata/`，上传内容在 `input/`。备份应覆盖整个作品目录和所用 DSH_HOME。独立版不会扫描原 ComfyUI 目录。手动导入旧 JSON 时，可将原先的 `comfyart/projects`、`index.json` 和 `history/` 的副本按原结构放到新数据目录的 `userdata/comfyart/`，然后首次启动。旧快照引用的媒体也要复制到对应的 `input/` 或 `output/`。

## 选中照片做色块处理

将一张 JPEG、PNG 或 WebP 静态照片放到画布，选中它，在 Agent 对话里输入「只保留 4 种颜色」。结果作为独立图片放在原图右侧，可继续移动、缩放或从「更多」下载 SVG 与 VectorCraft 原稿。

DSH 调用 `vectorcraft_color_blocks(shape_id, colors)`。工具从当前作品读取照片，复用 tldraw 的 `imageTrace.makeAndExpand` 限色描摹配方，再用 `recolor.colors` 读取实际填色。色数可指定 2–256。颜色简单的输入可能只用到其中一部分，回执报告实际值。PNG 的抗锯齿过渡色会映射回同一组填色。处理使用整个照片文件，长边超过 1600 像素时会等比缩小工作副本，透明部分以白底处理。

已用实拍照片验证四色处理，PNG 像素与 SVG 路径填色一致，重开后原图和结果仍能并排显示。

## 功能边界

| 功能 | 独立版行为 |
| --- | --- |
| 项目、图层和选择 | 沿用原画布、自动保存、版本和项目库。聊天中的单选和运行前确认走原有问答接口。 |
| 图片附件与审阅 | 图片能力由 DSH 的 ACP 会话声明。实测的文本模型可以读取 VectorCraft 原稿。文本模型收到所选照片的画布对象 ID，可以通过工具处理原图；需要理解图片内容时仍需有视觉能力的模型。主动审阅默认关闭，开启后，有图像能力时发送画布预览，仅支持文本时审阅对象位置、尺寸和可编辑文字。 |
| VectorCraft | 支持基本 SVG 几何、路径、文字和渐变。此工具使用同机 headless CLI，云部署时 CLI 也要安装在后端所在机器。 |
| ComfyUI 工作流 | 本地或集群节点队列、云端工作流、自定义节点、图像扩散、AI 视频与音频、3D 生成、模型选择和显存管理未迁移。主要入口已隐藏，旧对象请求运行工作流时会说明不可用。 |
| 其他模型服务 | 独立版只注册 DSH。现有对话库中依赖其他 Agent 的旧会话无法使用原提供方继续生成。 |

## 验证

已验证连续对话、工具投放、选项提交、画布编辑、版本冲突保护和保存后重开。

前端构建用 `npm run build`。本次通过 74 项与独立版有关的回归，覆盖实际网站入口、文件上传、项目存储与版本冲突、会话恢复、MCP 路由、选项提交、附件、PDF 和缩略图。回归测试需在虚拟环境另装 `pytest pytest-asyncio numpy`。上游 ComfyUI 节点、云队列和 LAN 执行器测试属于未启用的功能。
