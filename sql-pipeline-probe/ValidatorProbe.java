import kd.bos.mservice.abi.ai.rest.util.DirectSqlQueryValidator;

/** 临时探针：跑 DirectSqlQueryValidator 的正则层；classpath 无 jsqlparser，进入 AST 层即会失败。 */
public class ValidatorProbe {
    public static void main(String[] args) {
        String[] sqls = {
            "SELECT REPLACE(name, 'a', 'b') AS n FROM t LIMIT 10",
            "SELECT comment FROM t LIMIT 10",
            "SELECT \"comment\" FROM t LIMIT 10",
            "SELECT name FROM t WHERE name = 'a;b' LIMIT 10",
            "SELECT name FROM t WHERE note = 'x--y' LIMIT 10",
            "SELECT update_time FROM t LIMIT 1",
            "SELECT a FROM read_csv('/etc/passwd') LIMIT 1",
            "SELECT getenv('HOME') LIMIT 1",
            "(SELECT a FROM t LIMIT 1)",
            "SELECT a FROM t; ",
            "SELECT a FROM t /* ; DROP */ LIMIT 1",
            "SELECT begin_date FROM t LIMIT 1",
            "SELECT 1 AS \"show\" LIMIT 1",
            "SELECT a FROM t WHERE x = 'it''s; ok' LIMIT 1",
        };
        for (String sql : sqls) {
            try {
                DirectSqlQueryValidator.validate(sql);
                System.out.println("PASS " + sql);
            } catch (RuntimeException e) {
                System.out.println("REJ  " + sql + "  => " + e.getMessage());
            }
        }
    }
}
