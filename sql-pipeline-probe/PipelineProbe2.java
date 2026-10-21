import com.kingdee.abi.table.exception.DataTableAccessException;
import com.kingdee.abi.table.sql.SqlQueryProcessor;
import com.kingdee.abi.table.sql.catalog.LegacyRelationCatalogAdapter;
import com.kingdee.abi.table.sql.pipeline.SqlProcessResult;
import com.kingdee.abi.table.sql.pipeline.SqlProcessingRequest;
import java.util.*;

/** 临时探针：与 DirectSqlQueryValidator 对比用的同一批 SQL（表名 t 在白名单）。 */
public class PipelineProbe2 {
    public static void main(String[] args) throws Exception {
        Map<String, String> wl = new LinkedHashMap<String, String>();
        wl.put("t", "perm_t");
        String[] sqls = {
            "SELECT version() FROM 不存在", "SELECT REPLACE(name, 'a', 'b') AS n FROM t LIMIT 10",
            "SELECT comment FROM t LIMIT 10",
            "SELECT name FROM t WHERE name = 'a;b' LIMIT 10",
            "SELECT name FROM t WHERE note = 'x--y' LIMIT 10",
            "(SELECT a FROM t LIMIT 1)",
            "SELECT * FROM t",
            "SELECT a FROM read_csv('/etc/passwd') LIMIT 1",
            "SELECT getenv('HOME') LIMIT 1",
            "WITH x AS (SELECT a FROM t LIMIT 1) SELECT a FROM x",
            "SELECT a FROM t WHERE id IN (SELECT id FROM secret) LIMIT 1",
            "SELECT a FROM t WHERE id IN (SELECT * FROM read_csv('/etc/passwd')) LIMIT 1",
            "SELECT a FROM t LIMIT 5000",
            "SELECT a1,a2,a3,a4,a5,a6,a7,a8,a9,a10,a11 FROM t LIMIT 1",
            "SELECT begin_date, show FROM t LIMIT 1",
        };
        for (String sql : sqls) {
            try {
                SqlProcessResult r = SqlQueryProcessor.getDuckDb().process(
                        new SqlProcessingRequest(sql, LegacyRelationCatalogAdapter.adapt(wl), false));
                System.out.println("PASS  " + sql + "  => " + r.getSql());
            } catch (DataTableAccessException e) {
                Throwable c = e; while (c.getCause() != null && c.getCause() != c) c = c.getCause();
                System.out.println("REJ   " + sql + "  => code=" + e.getErrorCode() + " " + e.getMessage()
                        + (c != e ? " | root=" + String.valueOf(c.getMessage()).split("\n")[0] : ""));
            }
        }
    }
}
