import com.kingdee.abi.table.exception.DataTableAccessException;
import com.kingdee.abi.table.sql.SqlGuard;
import com.kingdee.abi.table.sql.SqlQueryProcessor;
import com.kingdee.abi.table.sql.catalog.LegacyRelationCatalogAdapter;
import com.kingdee.abi.table.sql.pipeline.SqlProcessResult;
import com.kingdee.abi.table.sql.pipeline.SqlProcessingRequest;

import java.util.LinkedHashMap;
import java.util.Map;

/** 临时探针：用仓库源码编译出的 SqlQueryProcessor.getDuckDb() 跑若干边界 SQL。 */
public class PipelineProbe {
    public static void main(String[] args) throws Exception {
        Map<String, String> wl = new LinkedHashMap<String, String>();
        wl.put("sales", "perm_t_sales");
        wl.put("user", "perm_t_user");
        wl.put("订单", "");
        wl.put("订单.明细", "perm_t_order_detail");
        wl.put("库存", "");
        String[] sqls = {
            "SELECT * FROM sales",
            "SELECT * FROM \"sales\" s WHERE s.id > 0",
            "SELECT * FROM sales\tJOIN sales b ON sales.id = b.id",
            "SELECT * FROM read_csv('/etc/passwd')",
            "SELECT * FROM (VALUES (1)) AS v(a)",
            "VALUES (1)",
            "SELECT * FROM sales, LATERAL (SELECT 1) x",
            "SELECT * FROM UNNEST(ARRAY[1,2])",
            "SELECT * FROM sales TABLESAMPLE BERNOULLI(10)",
            "SELECT * FROM s_b.t_other",
            "SELECT * FROM perm_t_sales",
            "SELECT * FROM \"user\"",
            "SELECT u.\"user\" FROM \"user\" u",
            "SELECT \"user\" FROM \"user\"",
            "WITH \"current_user\" AS (SELECT 1 AS a) SELECT a FROM \"current_user\"",
            "SELECT getvariable('x')",
            "SELECT current_setting('threads')",
            "SELECT read_text('/etc/passwd')",
            "SELECT * FROM 订单",
            "SELECT * FROM \"订单\".\"汇总\"",
            "SELECT * FROM 库存",
            "SELECT * FROM 不存在",
            "WITH perm_t_sales AS (SELECT 1 AS id) SELECT * FROM sales",
            "SELECT a::int FROM sales",
            "SELECT 1",
            "SELECT 1; SELECT 2",
            "SELECT 1;;;",
            "SELECT * FROM sales LIMIT 100000000",
        };
        for (String sql : sqls) {
            try {
                SqlProcessResult r = SqlQueryProcessor.getDuckDb().process(
                        new SqlProcessingRequest(sql, LegacyRelationCatalogAdapter.adapt(wl), false));
                System.out.println("PASS  " + show(sql) + "\n      => " + show(r.getSql()) + "  tables=" + r.getReferencedExecutionTables());
            } catch (DataTableAccessException e) {
                Throwable c = e; while (c.getCause() != null && c.getCause() != c) c = c.getCause();
                System.out.println("REJ   " + show(sql) + "\n      => code=" + e.getErrorCode() + " msg=" + e.getMessage()
                        + (c != e ? " | root=" + String.valueOf(c.getMessage()).split("\n")[0] : ""));
            }
        }
    }

    static String show(String s) { return s.replace("\t", "⇥"); }
}
