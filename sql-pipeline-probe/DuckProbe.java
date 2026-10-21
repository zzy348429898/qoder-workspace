import org.duckdb.DuckDBConnection;

import java.io.File;
import java.nio.file.Files;
import java.sql.*;

/** 临时探针：用 duckdb_jdbc 1.4.3 复刻 ReadOnlyAttachPool 的 :memory: root + READ_ONLY ATTACH + duplicate 形态。 */
public class DuckProbe {
    static void run(Connection c, String sql) {
        try (Statement s = c.createStatement()) {
            boolean rs = s.execute(sql);
            String out = "";
            if (rs) {
                try (ResultSet r = s.getResultSet()) {
                    if (r.next()) out = " -> " + r.getString(1);
                }
            }
            System.out.println("OK   " + sql + out);
        } catch (SQLException e) {
            System.out.println("FAIL " + sql + "  => " + String.valueOf(e.getMessage()).split("\n")[0]);
        }
    }

    public static void main(String[] args) throws Exception {
        File dir = Files.createTempDirectory("duckprobe").toFile();
        String shard = new File(dir, "shard_a.duckdb").getAbsolutePath();
        String other = new File(dir, "shard_b.duckdb").getAbsolutePath();
        File csv = new File(dir, "secret.csv");
        Files.write(csv.toPath(), "k\nTOPSECRET\n".getBytes("UTF-8"));
        try (Connection w = DriverManager.getConnection("jdbc:duckdb:" + shard)) {
            run(w, "CREATE TABLE t_sales(id INT, amount INT)");
            run(w, "INSERT INTO t_sales VALUES (1, 10), (2, 20)");
        }
        try (Connection w = DriverManager.getConnection("jdbc:duckdb:" + other)) {
            run(w, "CREATE TABLE t_other(x INT)");
            run(w, "INSERT INTO t_other VALUES (42)");
        }
        System.out.println("== 1. root 形态");
        DuckDBConnection root = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb::memory:");
        run(root, "SELECT version()");
        run(root, "ATTACH '" + shard + "' AS s_a (READ_ONLY)");
        run(root, "ATTACH '" + other + "' AS s_b (READ_ONLY)");
        Connection session = root.duplicate();
        run(session, "CREATE OR REPLACE TEMP VIEW \"perm_t_sales\" AS SELECT * FROM s_a.t_sales WHERE id = 1");
        run(session, "SELECT count(*) FROM perm_t_sales");
        System.out.println("== 2. 其它会话 ATTACH 的分片在本会话可见吗");
        run(session, "SELECT x FROM s_b.t_other");
        System.out.println("== 3. TEMP VIEW 是否跨 duplicate 连接可见");
        Connection session2 = root.duplicate();
        run(session2, "SELECT count(*) FROM perm_t_sales");
        System.out.println("== 4. 双引号上下文关键字回退绑定");
        run(session, "SELECT \"current_user\"");
        run(session, "SELECT \"current_user\" FROM perm_t_sales");
        run(session, "SELECT \"user\"");
        System.out.println("== 5. 默认外部访问");
        run(session, "SELECT * FROM read_csv('" + csv.getAbsolutePath() + "')");
        run(session, "SELECT current_setting('enable_external_access')");
        run(session, "SELECT getvariable('x')");
        System.out.println("== 6. 关闭外部访问后的行为（在 root 上 SET，看 duplicate 会话是否继承）");
        run(root, "SET enable_external_access = false");
        Connection session3 = root.duplicate();
        run(session3, "SELECT * FROM read_csv('" + csv.getAbsolutePath() + "')");
        run(session3, "SELECT count(*) FROM s_a.t_sales");
        run(session3, "CREATE OR REPLACE TEMP VIEW \"perm_t_sales\" AS SELECT * FROM s_a.t_sales");
        run(root, "ATTACH '" + new File(dir, "shard_c.duckdb").getAbsolutePath() + "' AS s_c (READ_ONLY)");
        run(root, "DETACH s_b");
        run(root, "ATTACH '" + other + "' AS s_b (READ_ONLY)");
        run(session3, "SET enable_external_access = true");
        run(root, "SET lock_configuration = true");
        run(session3, "SET memory_limit = '1GB'");
        System.out.println("== 7. 查询超时");
        Connection session4 = root.duplicate();
        try (Statement s = session4.createStatement()) {
            s.setQueryTimeout(1);
            long t0 = System.currentTimeMillis();
            try {
                s.executeQuery("SELECT count(*) FROM range(1000000000) a, range(1000) b");
                System.out.println("timeout not triggered");
            } catch (SQLException e) {
                System.out.println("timeout after " + (System.currentTimeMillis() - t0) + "ms => "
                        + String.valueOf(e.getMessage()).split("\n")[0]);
            }
        }
        System.out.println("== 8. 列不存在时的报错是否回显视图/物理名");
        run(session, "SELECT nope FROM perm_t_sales");
        run(session, "SELECT amount FROM perm_t_sales p JOIN perm_t_sales q ON p.id = q.id");
    }
}
