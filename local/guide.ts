export const CANVAS_USAGE_GUIDE = `# 本地画布使用说明

这份说明面向通过 MCP 连接当前本地画布的外部助手。

## 开始之前

- 需要先运行本地画布开发服务（默认地址是 http://127.0.0.1:5173/canvas/），再调用会改动画布或触发生成的工具。
- 先调用 canvas_overview 了解节点、连线和素材，再按需要读取单个节点或素材。不要一上来就改整张画布。
- 只做用户明确要求的事，不要扩大改动范围。

## 读取

- canvas_overview：返回画布概览，包括节点、连线和素材的摘要。
- canvas_get_node：按 id 读取完整节点。
- canvas_get_asset：查看素材。图片和音频以多模态内容块返回；视频只提供文字说明和可用的封面帧，不会返回完整视频二进制。

## 写入

- 所有写工具都必须带上 operationId（幂等键）。相同 operationId 的重复提交会返回第一次的结果，不会再创建一份节点或连线。
- 写操作的确认由外部助手客户端负责。本服务默认提供读写工具；若以 --read-only 启动，则不会注册写工具。
- canvas_create_node / canvas_update_node / canvas_delete_node：创建、更新或删除节点。
- canvas_create_edge / canvas_delete_edge：创建或删除连线。服务会校验连接规则，并拒绝形成环的连线。
- canvas_configure_generator：为生成节点设置提示词、比例、尺寸、时长或模型。
- canvas_run_generation：触发该节点的生成。若已配置网站 API Token，则走网站模型并按站内规则计费；未配置时只做本地占位预览。调用前请先准备好提示词和模型，并保持画布页面打开。

## 结果怎么看

- 写操作返回后即可视为已作用于当前画布。只有缺少字段，或改动还牵连其他节点时，才需要再读一次。
- 正在打开的画布会同步这些改动，也可以在画布上用撤销恢复。
`
