# Picture Labeling

浏览器里做图片打标的本地工具：合格判定、分类打标、取色判定。数据保存在本机（IndexedDB / localStorage），不上传图片。

## 启动

需要 [Node.js](https://nodejs.org/)（建议 18+）。在项目目录执行：

```bash
node server.js
```

浏览器打开 [http://localhost:8080/](http://localhost:8080/) ，不要直接双击 HTML（`file://` 下 IndexedDB 和 LLM 代理都不可靠）。

可选：`PORT=3000 node server.js`

## 三种模式

### 合格判定

把文件夹当序列列导入，对每张图标 **合格 / 待优化 / 不合格**。

- 某一列可设为 **参考列**（原图对比，不计入进度）。
- 快捷键：`Y` 合格、`H` 待优化、`N` 不合格；鼠标悬停在哪一列就标哪一列。
- 支持按状态导出 ZIP（含全部 / 按列）。

### 分类打标

导入文件夹或 ZIP 后，按顶层文件夹和文件名生成标签，给图片打多标签、填数量和备注，再进入验收。

- 导入：文件夹选择器，或 ZIP（结构为 `顶层文件夹/文件名`）。
- 支持 jpg / jpeg / png / heic / heif / mp4 / mov（HEIC 可能无法预览，仍可打标导出）。
- 验收可按同名图对比，筛选未通过、缺失、多出、重名冲突等。
- 验收快捷键：`←` `→` 换组，`Y` / `N` 全部通过或未通过，`]` 下一处差异。
- 导出 JSON / CSV / 验收摘要。

### 取色判定

自动取色、编辑色卡，再和验证图对照验收。

## 可选：大模型 API

各模式顶部有 **API**。填三项即可：Key、请求地址、模型名。兼容 OpenAI 协议（OpenAI、DeepSeek、通义、本机 Ollama 等）。Key 只存在浏览器本地，不会写进仓库。

若要用同域代理 `/api/agent/report`（避免浏览器跨域），启动时指定上游：

```bash
export MODEL_ROUTER_UPSTREAM='https://你的网关/v1/chat/completions'
export MODEL_ROUTER_MODEL='你的模型名'
node server.js
```

## 数据

- 图片二进制：IndexedDB（刷新不丢）。
- 打标状态：localStorage。
- 启动时可恢复上次文件和状态。
- 备份 JSON 只含状态，不含原图；换机器需重新导入同一批文件。
