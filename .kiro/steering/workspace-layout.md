# 工作区说明：企业数据分析智能体

本工作区包含企业数据分析智能体的全部代码，由以下几个文件夹组成：

1. `/Users/kehua/Desktop/workspace/qoder-workspace`
   - 通用工作区。脚本、临时代码、过程资源（日志、导出数据、截图、验证脚本等）都放这里。
   - 生成临时文件/脚本时，默认放到这个目录下，不要污染其他代码仓库。

2. `/Users/kehua/Desktop/workspace/code/abi/abi-platform`
   - Java 服务，MCP 服务端代码在这里。
   - MCP 工具定义（描述、入参等）通过 `bos-abi-mservice/datamodel/bos/1.5/main/abi/preinsdata/` 下的预插 SQL 维护，并在同目录上级的 `abi.xml` 注册。模型看到的工具描述取自 `t_openapi_mcp_server.FDESCRIPTION`。
   - 每次修改 MCP 工具都必须把 `t_openapi_mcp_server.FREGISTER_STATUS` 置为 `'UNPUBLISH'`：平台连接器只在该状态下重新拉取工具定义，拉取完成后自动改为发布。只改描述不改状态，网关不会生效。

3. `/Users/kehua/Desktop/workspace/code/kingdee-lingee`
   - Agent、Skill、MCP App 的维护位置（`agents/`、`skills/`、`mcapps/`）。
   - 修改 agent / skill 时以这里为准。
   - `agents/*/agent.yaml`、`skills/*/skill.yaml` 是流水线部署配置：只有生产环境走流水线，其他环境（如 SIT）均手动更新。因此测试环境 trace 里的 skill 关联可能与仓库 yaml 不一致，以 yaml 判断生产行为，不要据此认定仓库配置有误。

4. `/Users/kehua/Desktop/workspace/code/abi-skills`
   - 其中的 `agents/`、`skills/` 已不再维护，不要修改。
   - 该项目只维护 MCP App 的源码（`mcpapps/`），构建产物提供给 kingdee-lingee 使用。
