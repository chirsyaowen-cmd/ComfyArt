# 小志图片处理与 MCP 清单

封面已经放好原图时，roadmap 可以出现一个可跳过的步骤「调整封面照片」。巡检根据实际照片和创作意图推荐一种做法。用户可以试效果，也可以保留原图、继续排内页。内页和跨页照片也能用同一套工具。

这是接入清单。下文的 **已接** 指 ComfyArt 独立版已注册该 MCP 工具。**面板已有** 指用户已经能手动调整。**上游已有** 指查到了引擎命令，仍需接入 ComfyArt。**候选** 指适合小志的操作，还要选实现并验证。

## 第一项验收 · 封面渐变映射

| 时机 | 用户看到什么 | 验收要点 |
| --- | --- | --- |
| 点巡检 | “要不要试试墨绿色的感觉？背景会变成深墨绿，亮叶子带一点浅灰绿。” | Agent 先看封面的实际像素。建议与目标照片绑定。 |
| 点「试一试」 | 原位显示效果，自动展开图片浮动栏里的同一个「调整」面板 | 用可编辑的色相／饱和度调整层去色，再加渐变映射。按原图明暗从墨绿过渡到浅灰绿。缩到封面阅读尺寸，亮叶、背景和叶缘仍分得清。 |
| 手动改颜色后关闭 | 封面保留最后的效果，「渐变映射」优先出现在图片浮动栏 | 重开或刷新后，色标位置、颜色和顺序一致。可对比原图、撤销，保留原裁剪和版面位置。 |
| 点「保留原图」 | 直接继续排版 | roadmap 记录这个决定。同一照片和意图下再次巡检时不重复追问。 |

墨绿是验收样例。换成“保留叶子本来的绿色，让轮廓清楚一点”时，Agent 可以只调对比度。应用前若照片已被替换，重新看图。执行失败时，保留原图及原进度。

## 按成品效果查操作

表中反引号包住的 PhotoCraft 调色短名，对应官方命令 `layer.newAdjustmentLayer.<短名>`。例如 `gradientMap` 对应 `layer.newAdjustmentLayer.gradientMap`。参数列列出用户最需要调整的项目。

| 想要的效果 | 制作时会用到的操作 | 面板参数 | MCP 或接入状态 |
| --- | --- | --- | --- |
| **双色封面，保留照片层次** | **先去色，再按明暗映射两种或多种颜色** | 暗部色、亮部色、中间色标和位置 | **已接** · PhotoCraft `hueSaturation`、`gradientMap` |
| 黑白人像、黑白街拍 | 去色、分颜色调黑白，让肤色或绿叶在黑白图里更亮 | 饱和度、各颜色转成灰度后的亮度 | 上游已有 · `hueSaturation`、`blackWhite` |
| 暗照片印出来还能读 | 曝光、亮度／对比度、提阴影、压高光 | 曝光、亮部、暗部、对比度 | 面板已有 · 上游另有 `exposure`、`brightnessContrast` |
| 黑白更扎实，灰调更细腻 | 色阶、曲线、黑白场、中间调、褪黑 | 黑白点、中间灰、曲线控制点 | 上游已有 · `levels`、`curves` |
| 校正室内黄光，统一冷暖 | 白平衡、色温／色调、色彩平衡、滤镜着色 | 冷暖、绿／洋红偏移、阴影和高光偏色 | 面板已有色温／色调 · 上游另有 `colorBalance`、`photoFilter` |
| 突出一个颜色 | 饱和度、自然饱和度、单色范围调节、局部换色 | 颜色范围、色相、饱和度、明度、过渡 | 上游已有 · `vibrance`、`hueSaturation`、`selectiveColor` |
| 一组照片像同一卷胶片 | 复用调色参数、套 LUT、逐张微调曝光 | 参考照片、配色方案、强度、目标照片 | 上游已有 · `colorLookup`。跨照片复用为候选编排 |
| 复印机、剪影、粗颗粒海报 | 黑白阈值、反相、色调分级 | 明暗分界、色阶数、反相开关 | 上游已有 · `threshold`、`invert`、`posterize` |
| 把照片变成几块纯色 | 限色描摹，生成可放大的矢量色块 | 颜色数量 | **已接** · `vectorcraft_color_blocks`。现有行为会把新图放在原图旁边 |
| 网点报刊、丝印或孔版印刷感 | 半调网点、双色分版、油墨叠印、轻微错版 | 网点大小／角度、墨色、每版偏移和透明度 | 已接 PhotoCraft 彩色网点。分版、叠印和错版为候选配方 |
| 胶片或旧纸质感 | 加颗粒、纹理叠加、褪色、暗角、泛光 | 颗粒强度、纹理比例、混合方式、暗角范围 | 已接胶片颗粒。暗角和泛光有手动面板，纸纹叠加为候选 |
| 主体更清楚或更柔和 | 锐化、清晰度、降噪、柔焦、高斯／运动模糊 | 强度、半径、方向、局部范围 | 已接锐化、降噪和高斯模糊。清晰度有手动面板，运动模糊待接 |
| 扫描旧照、收据、手稿 | 拉直、透视校正、去纸底灰、去色偏、除尘、去扫描网纹 | 四角、纸白采样、黑白点、修复范围 | 上游已有 `levels`、`curves`。透视及修复命令待验证 |
| 让照片适合封面或跨页 | 裁剪、旋转、翻转、拉直、指定比例、跨页避开书脊 | 裁剪框、角度、焦点、中缝位置 | 画布已有裁剪／翻转。跨页构图建议走 `view_canvas`，改裁剪的 MCP 待接 |
| 给标题留空间 | 移动取景、扩画布、补纯色边、局部压暗或提亮 | 留白方向和宽度、底色、蒙版过渡 | 候选 · 画布排版、局部蒙版；需要补画内容时另列生成式扩图 |
| 从背景里剪出人物或物件 | 按颜色选区、选主体、去背景、蒙版、羽化、细化毛发边缘 | 取样色、容差、边缘收缩、羽化 | 候选 · PhotoCraft 选区／蒙版。独立版的 MCP 注册表尚未开放 `remove_background` |
| 只改局部，保留其他细节 | 涂抹、渐变蒙版、按明暗选区、局部加深／减淡 | 蒙版、笔刷大小、羽化、局部强度 | 候选 · 选区或蒙版配合曝光／曲线调整 |
| 拼贴、双重曝光、撕纸边 | 透明底、叠图、混合模式、图层蒙版、描边、投影 | 图层顺序、透明度、混合模式、边缘和阴影 | 候选 · PhotoCraft 合成。投影已有手动面板 |
| 修掉扫描污点或干扰物 | 仿制、修复笔刷、小区块填补、必要时生成式移除 | 修复范围、取样源、羽化 | 候选 · 传统修复与生成式修补分别验收 |
| 做线稿、手绘或点阵页 | 描边、边缘提取、素描、像素化、抖动、点阵 | 线宽、阈值、像素尺寸、调色板 | 像素化和限色描摹已接；线稿为候选 |
| 多张照片排进同一跨页 | 等比例缩放、统一裁剪比例、接触印样、连续画格、统一边框 | 单格尺寸、列数、间距、留白、裁剪焦点 | 已接 `place_photo` 可放项目照片。批量裁切和排格为候选编排 |
| 为印刷或分享输出图片 | 按最终尺寸重采样、检查有效分辨率、出血、色彩配置、软打样、分色、透明底导出和压缩 | 成品尺寸、印厂配置、出血、像素尺寸、格式和质量 | 候选 · 输出检查和导出。印刷参数取自实际印厂，屏幕预览单独验收 |

### 已接入的 17 项操作

调色支持渐变映射、饱和度、对比度、曝光、亮度、自然饱和度、色相、黑白阈值、色调分级、提亮阴影和压低高光。细节及质感支持锐化、降噪、胶片颗粒、高斯模糊、彩色网点和像素化。面板和 MCP 共用[操作参数表](../api/photo_operations.json)。

## MCP 对照

| 所在位置 | 工具或命令 | 在小志流程中负责什么 | 状态 |
| --- | --- | --- | --- |
| ComfyArt | `get_canvas`、`view_canvas` | 找到封面照片，查看照片或整页的实际像素 | 已接 |
| ComfyArt | `ask_user`、`update_roadmap` | 展示选择并记录决定；成功应用后再更新进度 | 已接，封面建议支持试用和保留原图 |
| ComfyArt | `place_photo` | 把项目里的照片放进目标页 | 已接 |
| ComfyArt → VectorCraft | `vectorcraft_color_blocks`、`render_vectorcraft`、`read_vectorcraft` | 限色描摹、生成矢量作品、读取可编辑原稿 | 已接 |
| VectorCraft | `apply_effect` | 调用网点、胶片颗粒、锐化等效果，具体效果 ID 见下表 | 已在本机 0.12.0 的 MCP 目录核对；ComfyArt 待接 |
| ComfyArt → PhotoCraft | `list_photo_adjustments` | 查询可用操作、引擎命令和参数范围 | 已接 |
| ComfyArt → PhotoCraft | `adjust_photo` | 接收项目照片 ID 和有顺序的调整参数，保存原图与参数，回传结果给同一个调整面板 | 已接 · 17 项操作 |
| PhotoCraft | `command_list`、`command_run`、`command_batch` | 查询当前安装版本支持的命令、执行单项调整、按顺序执行多项调整 | 已接 `command_run`，顺序执行照片处理 |
| PhotoCraft | `layer.newAdjustmentLayer.hueSaturation`、`layer.newAdjustmentLayer.gradientMap` | 首项验收用这两条命令。第一层饱和度设为 −100；第二层用 2 至 64 个色标指定明暗对应的颜色 | 已接；上游 0.23.1 真实引擎已核对颜色与透明度 |
| PhotoCraft | `doc_inspect`、`render_preview` | 读取文档状态、渲染预览，再把结果放回项目 | 上游已有；ComfyArt 待接 |

### VectorCraft 可复用的效果

这些 ID 来自本机无桌面 MCP 的 `effect.list`。它们是传给 `apply_effect` 的参数。接入时还需用真实照片核对预览、参数回显及导出结果。

| 小志效果 | 效果 ID |
| --- | --- |
| 单色网点、彩色网点、颗粒铜版画、点彩 | `sketch.halftonePattern`、`pixelate.colorHalftone`、`pixelate.mezzotint`、`pixelate.pointillize` |
| 胶片颗粒、纸面颗粒、纹理 | `artistic.filmGrain`、`texture.grain`、`texture.texturizer` |
| 墨线、交叉排线、水墨、喷溅 | `brushStrokes.inkOutlines`、`brushStrokes.crosshatch`、`brushStrokes.sumiE`、`brushStrokes.spatter` |
| 锐化、高斯模糊、径向模糊 | `sharpen.unsharpMask`、`blur.gaussian`、`blur.radial` |
| 拼贴剪边、羽化、投影 | `distort.roughen`、`stylize.feather`、`stylize.dropShadow` |
| 明暗、曲线、色阶、色相饱和度、冷暖、换色 | `adjust.brightnessContrast`、`adjust.curves`、`adjust.levels`、`adjust.hueSaturation`、`adjust.temperatureTint`、`adjust.shiftToColor` |

云端部署时，由网站后端运行 Linux 版 PhotoCraft CLI（0.23.1 使用 `mcp --no-gpu`）和 VectorCraft CLI，按任务限制其可读写的目录。用户只需浏览器。上线前需用同一张照片在 Linux 环境验证色标、透明度、输出尺寸、预览与导出的一致性。

核对依据包括 ComfyArt 独立版 `origin/main` 的 `ab8df47`，以及 PhotoCraft 的官方命令表。核对日期为 2026-11-24。[PhotoCraft 调整命令和参数](https://github.com/storytold/photocraft/blob/ada83e9d88c8cfeacd18f2e78bcb57e9a2034851/crates/engine-core/src/cmd/table/image/adjustments.rs) · [PhotoCraft MCP 与 Linux 运行方式](https://github.com/storytold/photocraft/blob/main/book/src/automation/mcp.md) · [VectorCraft MCP](https://github.com/storytold/vectorcraft/blob/main/docs/mcp.md)
