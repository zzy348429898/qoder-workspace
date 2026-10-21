import org.duckdb.DuckDBConnection;

import java.sql.*;

/** 临时探针三：初始化 SET 项在 duplicate 会话上的可见性。 */
public class DuckProbe3 {
    static void run(Connection c, String sql) {
        try (Statement s = c.createStatement()) {
            boolean rs = s.execute(sql);
            String out = "";
            if (rs) try (ResultSet r = s.getResultSet()) { if (r.next()) out = " -> " + r.getString(1); }
            System.out.println("OK   " + sql + out);
        } catch (SQLException e) {
            System.out.println("FAIL " + sql + "  => " + String.valueOf(e.getMessage()).split("\n")[0]);
        }
    }

    public static void main(String[] args) throws Exception {
        DuckDBConnection root = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb::memory:");
        run(root, "SET jdbc_stream_results = 'true'");
        run(root, "SET scheduler_process_partial = 'true'");
        run(root, "SET memory_limit = '512MB'");
        run(root, "SET preserve_insertion_order = 'false'");
        Connection s = root.duplicate();
        run(s, "SELECT current_setting('memory_limit')");
        run(s, "SELECT current_setting('preserve_insertion_order')");
        run(s, "SET memory_limit = '8GB'");
        run(root, "SELECT current_setting('memory_limit')");
    }
}
