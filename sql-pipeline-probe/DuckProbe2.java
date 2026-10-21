import org.duckdb.DuckDBConnection;

import java.io.File;
import java.nio.file.Files;
import java.sql.*;

/** 临时探针二：外部访问关闭与 ATTACH 先后、allowed_directories、报错回显。 */
public class DuckProbe2 {
    static void run(Connection c, String sql) {
        try (Statement s = c.createStatement()) {
            boolean rs = s.execute(sql);
            String out = "";
            if (rs) {
                try (ResultSet r = s.getResultSet()) {
                    if (r.next()) out = " -> " + r.getString(1);
                }
            }
            System.out.println("OK   " + sql.replaceAll("/var/folders/\\S+?/duckprobe\\d+", "<dir>") + out);
        } catch (SQLException e) {
            System.out.println("FAIL " + sql.replaceAll("/var/folders/\\S+?/duckprobe\\d+", "<dir>") + "  => "
                    + String.valueOf(e.getMessage()).replaceAll("/var/folders/\\S+?/duckprobe\\d+", "<dir>").replace('\n', ' '));
        }
    }

    static String mk(File dir, String name) throws Exception {
        String p = new File(dir, name).getAbsolutePath();
        try (Connection w = DriverManager.getConnection("jdbc:duckdb:" + p)) {
            run(w, "CREATE TABLE t_" + name.replace(".duckdb", "") + "(id INT, amount INT)");
        }
        return p;
    }

    public static void main(String[] args) throws Exception {
        File dir = Files.createTempDirectory("duckprobe").toFile();
        File outside = Files.createTempDirectory("duckprobe").toFile();
        String a = mk(dir, "a.duckdb");
        String d = mk(dir, "d.duckdb");
        String o = mk(outside, "o.duckdb");
        File csvIn = new File(dir, "in.csv");
        Files.write(csvIn.toPath(), "k\nIN\n".getBytes("UTF-8"));

        System.out.println("== A. 只 SET enable_external_access=false：已挂载 vs 未挂载的已存在文件");
        DuckDBConnection r1 = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb::memory:");
        run(r1, "ATTACH '" + a + "' AS s_a (READ_ONLY)");
        run(r1, "SET enable_external_access = false");
        run(r1, "ATTACH '" + d + "' AS s_d (READ_ONLY)");
        run(r1, "SELECT current_setting('allowed_paths')");
        r1.close();

        System.out.println("== B. 先 SET allowed_directories=[dataDir] 再关闭外部访问");
        DuckDBConnection r2 = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb::memory:");
        run(r2, "SET allowed_directories = ['" + dir.getAbsolutePath() + "/']");
        run(r2, "SET enable_external_access = false");
        run(r2, "SET lock_configuration = true");
        run(r2, "ATTACH '" + d + "' AS s_d (READ_ONLY)");
        run(r2, "ATTACH '" + o + "' AS s_o (READ_ONLY)");
        Connection s = r2.duplicate();
        run(s, "SELECT count(*) FROM s_d.t_d");
        run(s, "SELECT * FROM read_csv('" + csvIn.getAbsolutePath() + "')");
        run(s, "SELECT * FROM read_text('" + a + "')");
        run(s, "SET enable_external_access = true");
        run(s, "SET allowed_directories = ['/']");
        r2.close();

        System.out.println("== C. 通过 JDBC 连接属性在打开时设置");
        java.util.Properties p = new java.util.Properties();
        p.setProperty("allowed_directories", "['" + dir.getAbsolutePath() + "/']");
        p.setProperty("enable_external_access", "false");
        try (Connection r3 = DriverManager.getConnection("jdbc:duckdb::memory:", p)) {
            run(r3, "SELECT current_setting('enable_external_access')");
            run(r3, "ATTACH '" + d + "' AS s_d (READ_ONLY)");
        } catch (SQLException e) {
            System.out.println("FAIL open with props => " + e.getMessage().split("\n")[0]);
        }

        System.out.println("== D. 报错回显");
        DuckDBConnection r4 = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb::memory:");
        run(r4, "ATTACH '" + a + "' AS s_a (READ_ONLY)");
        Connection s4 = r4.duplicate();
        run(s4, "CREATE TEMP VIEW \"perm_t_a\" AS SELECT * FROM s_a.t_a");
        run(s4, "SELECT amout FROM \"perm_t_a\"");
        run(s4, "SELECT x.amount FROM \"perm_t_a\"");
        run(s4, "SELECT amount + 'abc' FROM \"perm_t_a\"");
    }
}
