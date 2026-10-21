import org.apache.calcite.avatica.util.Casing;
import org.apache.calcite.avatica.util.Quoting;
import org.apache.calcite.sql.*;
import org.apache.calcite.sql.parser.SqlParser;
import org.apache.calcite.sql.validate.SqlConformanceEnum;

/** 临时探针：复刻 SqlQueryParser 的解析配置，观察若干 SQL 的解析结果。 */
public class CalciteProbe {
    static final SqlParser.Config CONFIG = SqlParser.config()
            .withQuoting(Quoting.DOUBLE_QUOTE)
            .withQuotedCasing(Casing.UNCHANGED)
            .withUnquotedCasing(Casing.UNCHANGED)
            .withCaseSensitive(true)
            .withConformance(SqlConformanceEnum.BABEL);

    public static void main(String[] args) {
        String[] sqls = {
            "SELECT * FROM read_csv('/etc/passwd')",
            "SELECT * FROM TABLE(read_csv('/etc/passwd'))",
            "SELECT * FROM 'x.csv'",
            "SELECT * FROM t, LATERAL (SELECT 1)",
            "SELECT * FROM UNNEST(ARRAY[1,2])",
            "SELECT * FROM (VALUES (1),(2)) AS v(a)",
            "VALUES (1)",
            "SELECT getvariable('x')",
            "SELECT \"current_user\"",
            "SELECT current_user",
            "SELECT user",
            "SELECT 1 LIMIT 10",
            "SELECT 1; DROP TABLE t",
            "SELECT * FROM t QUALIFY row_number() over () = 1",
            "SELECT * FROM t TABLESAMPLE BERNOULLI(10)",
            "SELECT * FROM t\tJOIN s ON t.id = s.id",
            "SELECT version()",
            "SELECT pg_catalog.current_setting('x')",
            "SELECT a::int FROM t",
            "SELECT * FROM t WHERE a ILIKE 'x%'",
            "SELECT list_value(1,2)[1]",
            "SELECT * EXCLUDE (a) FROM t",
            "FROM t SELECT a",
            "SELECT * FROM t LIMIT 1 OFFSET 2",
            "SELECT * FROM t USING SAMPLE 10%",
            "SELECT * FROM db1.main.t", "SELECT `a` FROM t",
        };
        for (String sql : sqls) {
            try {
                SqlNode root = SqlParser.create(sql, CONFIG).parseQuery();
                String fromInfo = "";
                SqlNode q = root instanceof SqlOrderBy ? ((SqlOrderBy) root).query : root;
                if (q instanceof SqlSelect && ((SqlSelect) q).getFrom() != null) {
                    SqlNode f = ((SqlSelect) q).getFrom();
                    fromInfo = " from=" + f.getClass().getSimpleName() + "/" + f.getKind();
                    if (f instanceof SqlJoin) {
                        SqlNode r = ((SqlJoin) f).getRight();
                        fromInfo += " right=" + r.getClass().getSimpleName() + "/" + r.getKind()
                                + " pos=" + r.getParserPosition();
                    }
                }
                System.out.println("OK   [" + root.getClass().getSimpleName() + "/" + root.getKind() + fromInfo + "] " + sql.replace('\t', '⇥'));
            } catch (Throwable e) {
                String m = String.valueOf(e.getMessage()).split("\n")[0];
                Throwable c = e; while (c.getCause() != null && c.getCause() != c) c = c.getCause();
                System.out.println("FAIL [" + e.getClass().getSimpleName() + " root=" + c.getClass().getSimpleName() + "] " + sql + "  => " + m);
            }
        }
    }
}
