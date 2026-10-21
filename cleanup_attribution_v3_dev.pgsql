-- 清理 dev 环境中归因 V3 独立接口（analyzeAttributionV3）预插脚本写入的数据。
-- 对应已从仓库删除的 3 个脚本：
--   kd_1.5_sys_openapi_ai_attribution_v3_0929.sql        API 服务 FID = 2478601000000000001
--   kd_1.5_sys_openapi_ai_attribution_v3_mcp_0929.sql    MCP 服务 FID = 2478602000000000001
--   kd_1.5_sys_openapi_thirdapp_add_attribution_v3_0929.sql  授权行 FENTRYID = 2478603000000000001/2
-- 删除条件全部是这 3 个脚本自有的主键 / 工具名，不触碰 v2 analyzeAttribution（FID 2477142957497528320）。
-- 用法：psql 连 dev 库执行；脚本停在事务内，核对第 3 步全部为 0 后手动 COMMIT，否则 ROLLBACK。

BEGIN;

-- 1. 执行前：待删除行数（预期见行尾注释）
SELECT 't_open_apibodyentry_l' AS tbl, COUNT(*) AS cnt FROM t_open_apibodyentry_l
 WHERE fpkid IN ('5SAIATV3B001', '5SAIATV3B002', '5SAIATV3B003', '5SAIATV3B004', '5SAIATV3B005', '5SAIATV3B006',
                 '5SAIATV3B007', '5SAIATV3B008', '5SAIATV3B009', '5SAIATV3B010', '5SAIATV3B011', '5SAIATV3B012',
                 '5SAIATV3B0D1', '5SAIATV3B0D2', '5SAIATV3B0D3')
    OR fentryid IN (SELECT fentryid FROM t_open_apibodyentry WHERE fid = 2478601000000000001)        -- 15
UNION ALL SELECT 't_open_apibodyentry', COUNT(*) FROM t_open_apibodyentry WHERE fid = 2478601000000000001   -- 15
UNION ALL SELECT 't_open_apirespentry', COUNT(*) FROM t_open_apirespentry WHERE fid = 2478601000000000001   -- 4
UNION ALL SELECT 't_open_apiheaderentry', COUNT(*) FROM t_open_apiheaderentry WHERE fid = 2478601000000000001 -- 3
UNION ALL SELECT 't_openapi_ext', COUNT(*) FROM t_openapi_ext WHERE fid = 2478601000000000001               -- 2
UNION ALL SELECT 't_open_apiservice_l', COUNT(*) FROM t_open_apiservice_l
 WHERE fpkid = '5SAIATV3S001' OR fid = 2478601000000000001                                                  -- 1
UNION ALL SELECT 't_open_apiservice', COUNT(*) FROM t_open_apiservice WHERE fid = 2478601000000000001       -- 1
UNION ALL SELECT 't_openapi_mcp_server_l', COUNT(*) FROM t_openapi_mcp_server_l
 WHERE fpkid = '5SAIATV3M001' OR fid = 2478602000000000001                                                  -- 1
UNION ALL SELECT 't_openapi_mcp_server', COUNT(*) FROM t_openapi_mcp_server
 WHERE fid = 2478602000000000001 OR ftool_name_new = 'data_abi_post_v2_abi_ai_analyzeattributionv3'        -- 1
UNION ALL SELECT 't_open_3rdappsapis', COUNT(*) FROM t_open_3rdappsapis
 WHERE fapiserviceid = 2478601000000000001 OR fentryid IN (2478603000000000001, 2478603000000000002);       -- 2

-- 2. 删除（子表 / 多语言表先于主表）
DELETE FROM t_open_apibodyentry_l
 WHERE fpkid IN ('5SAIATV3B001', '5SAIATV3B002', '5SAIATV3B003', '5SAIATV3B004', '5SAIATV3B005', '5SAIATV3B006',
                 '5SAIATV3B007', '5SAIATV3B008', '5SAIATV3B009', '5SAIATV3B010', '5SAIATV3B011', '5SAIATV3B012',
                 '5SAIATV3B0D1', '5SAIATV3B0D2', '5SAIATV3B0D3')
    OR fentryid IN (SELECT fentryid FROM t_open_apibodyentry WHERE fid = 2478601000000000001);
DELETE FROM t_open_apibodyentry   WHERE fid = 2478601000000000001;
DELETE FROM t_open_apirespentry   WHERE fid = 2478601000000000001;
DELETE FROM t_open_apiheaderentry WHERE fid = 2478601000000000001;
DELETE FROM t_openapi_ext         WHERE fid = 2478601000000000001;
DELETE FROM t_open_apiservice_l   WHERE fpkid = '5SAIATV3S001' OR fid = 2478601000000000001;
DELETE FROM t_open_apiservice     WHERE fid = 2478601000000000001;
DELETE FROM t_openapi_mcp_server_l WHERE fpkid = '5SAIATV3M001' OR fid = 2478602000000000001;
DELETE FROM t_openapi_mcp_server
 WHERE fid = 2478602000000000001 OR ftool_name_new = 'data_abi_post_v2_abi_ai_analyzeattributionv3';
DELETE FROM t_open_3rdappsapis
 WHERE fapiserviceid = 2478601000000000001 OR fentryid IN (2478603000000000001, 2478603000000000002);

-- 3. 执行后：全部应为 0
SELECT 't_open_apibodyentry_l' AS tbl, COUNT(*) AS cnt FROM t_open_apibodyentry_l
 WHERE fpkid LIKE '5SAIATV3%'
UNION ALL SELECT 't_open_apibodyentry', COUNT(*) FROM t_open_apibodyentry WHERE fid = 2478601000000000001
UNION ALL SELECT 't_open_apirespentry', COUNT(*) FROM t_open_apirespentry WHERE fid = 2478601000000000001
UNION ALL SELECT 't_open_apiheaderentry', COUNT(*) FROM t_open_apiheaderentry WHERE fid = 2478601000000000001
UNION ALL SELECT 't_openapi_ext', COUNT(*) FROM t_openapi_ext WHERE fid = 2478601000000000001
UNION ALL SELECT 't_open_apiservice_l', COUNT(*) FROM t_open_apiservice_l WHERE fpkid LIKE '5SAIATV3%' OR fid = 2478601000000000001
UNION ALL SELECT 't_open_apiservice', COUNT(*) FROM t_open_apiservice WHERE fid = 2478601000000000001
UNION ALL SELECT 't_openapi_mcp_server_l', COUNT(*) FROM t_openapi_mcp_server_l WHERE fpkid LIKE '5SAIATV3%' OR fid = 2478602000000000001
UNION ALL SELECT 't_openapi_mcp_server', COUNT(*) FROM t_openapi_mcp_server
 WHERE fid = 2478602000000000001 OR ftool_name_new = 'data_abi_post_v2_abi_ai_analyzeattributionv3'
UNION ALL SELECT 't_open_3rdappsapis', COUNT(*) FROM t_open_3rdappsapis WHERE fapiserviceid = 2478601000000000001;

-- 4. 未受影响校验：v2 analyzeAttribution 仍在（预期 api=1、mcp=1、params=14）
SELECT
  (SELECT COUNT(*) FROM t_open_apiservice WHERE fid = 2477142957497528320) AS v2_api,
  (SELECT COUNT(*) FROM t_openapi_mcp_server WHERE ftool_name_new = 'data_abi_post_v2_abi_ai_analyzeattribution') AS v2_mcp,
  (SELECT COUNT(*) FROM t_open_apibodyentry WHERE fid = 2477142957497528320) AS v2_params;

-- 核对无误后手动执行其一：
-- COMMIT;
-- ROLLBACK;
