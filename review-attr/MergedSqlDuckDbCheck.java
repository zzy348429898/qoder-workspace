import com.kingdee.abi.ai.attribution.model.AttributionDefinitions;
import com.kingdee.abi.ai.attribution.sql.AttributionSqlBuilder;
import com.kingdee.abi.ai.attribution.support.AttributionRequestParser;
import com.kingdee.abi.ai.attribution.support.AttributionRequestParserV3;
import com.kingdee.abi.api.openapi.ai.request.AttributionAnalysisRequest;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 评审用临时验证：在真实 DuckDB 上执行合并 SQL 与逐条 SQL，比较结果是否一致。
 */
public class MergedSqlDuckDbCheck {

    static Connection conn;

    public static void main(String[] args) throws Exception {
        conn = new org.duckdb.DuckDBDriver().connect("jdbc:duckdb:", new java.util.Properties());
        try (Statement st = conn.createStatement()) {
            st.execute("CREATE TABLE sales(id INTEGER, region VARCHAR, prod_code INTEGER, biz_date DATE, yr INTEGER,"
                    + " amount DECIMAL(18,2), qty INTEGER, price DOUBLE, flag BOOLEAN)");
            st.execute("INSERT INTO sales SELECT i, CASE WHEN i % 3 = 0 THEN NULL ELSE 'R' || (i % 4) END, i % 5,"
                    + " DATE '2024-01-01' + (i % 7) * INTERVAL 1 DAY, 2024 + (i % 2), (i * 1.25)::DECIMAL(18,2), i % 9,"
                    + " i * 0.5, i % 2 = 0 FROM range(1, 400) t(i)");
        }
        AttributionSqlBuilder builder = new AttributionSqlBuilder();
        for (String agg : Arrays.asList("sum", "avg", "count", "count_distinct", "median")) {
            for (String nullHandling : Arrays.asList("as_group", "exclude")) {
                AttributionDefinitions.ResolvedRequest req = new AttributionRequestParser().parse(v2Request(agg, nullHandling, false));
                runV2(builder, req, "v2 abs " + agg + " " + nullHandling);
            }
        }
        AttributionDefinitions.ResolvedRequest ratio = new AttributionRequestParser().parse(v2Request("sum", "as_group", true));
        runV2(builder, ratio, "v2 ratio");

        AttributionDefinitions.ResolvedRequest v3 = new AttributionRequestParserV3().parse(v3Request());
        List<String> dims = Arrays.asList("region", "prod_code", "biz_date", "flag");
        List<String> branches = new ArrayList<String>();
        for (String d : dims) {
            branches.add(builder.buildDimensionSqlDataset(v3.getDatasetSql(), d, v3.getMetric(), v3.getComparison(),
                    v3.getDimensionConfig().getNullHandling(), v3.getDimensionConfig().getMinGroupSize(), null));
        }
        String base = builder.buildBaseSqlDataset(v3.getDatasetSql(), v3.getMetric(), v3.getComparison(), null).getSql();
        compare("v3 WITH+comment", builder.buildMergedSliceSql(branches, base, false), branches, base);
        String grain = com.kingdee.abi.ai.attribution.dataset.DatasetProbe.buildGrainCountSql(v3.getDatasetSql(), "id");
        System.out.println("v3 grain+base: " + query(builder.buildGrainAndBaseSql(grain, base, false)));
    }

    static void runV2(AttributionSqlBuilder builder, AttributionDefinitions.ResolvedRequest req, String label) throws Exception {
        List<String> dims = Arrays.asList("region", "prod_code", "biz_date", "flag", "amount");
        List<String> branches = new ArrayList<String>();
        for (String d : dims) {
            branches.add(req.getMetric().isRatio()
                    ? builder.buildDimensionSqlRatio(req.getTable(), d, req.getMetric(), req.getComparison(), req.getFilters(),
                    req.getDimensionConfig().getNullHandling(), req.getDimensionConfig().getMinGroupSize(), null)
                    : builder.buildDimensionSqlAbsolute(req.getTable(), d, req.getMetric(), req.getComparison(), req.getFilters(),
                    req.getDimensionConfig().getNullHandling(), req.getDimensionConfig().getMinGroupSize(), null));
        }
        String base = builder.buildBaseSql(req.getTable(), req.getMetric(), req.getComparison(), req.getFilters(),
                "\"region\" = 'R1'").getSql();
        compare(label + " (no base)", builder.buildMergedSliceSql(branches, null, req.getMetric().isRatio()), branches, null);
        compare(label + " (with base)", builder.buildMergedSliceSql(branches, base, req.getMetric().isRatio()), branches, base);
    }

    static void compare(String label, String merged, List<String> branches, String base) throws Exception {
        List<Map<String, Object>> mergedRows;
        try {
            mergedRows = query(merged);
        } catch (Exception ex) {
            System.out.println("[FAIL-MERGED] " + label + ": " + ex.getMessage());
            return;
        }
        Map<String, String> fromMerged = new TreeMap<String, String>();
        Map<String, String> typesMerged = new TreeMap<String, String>();
        for (Map<String, Object> row : mergedRows) {
            Object idx = row.remove("dim_idx");
            fromMerged.put(idx + "|" + row.get("slice"), normalize(row));
            typesMerged.put(String.valueOf(idx), types(row));
        }
        Map<String, String> fromSingle = new TreeMap<String, String>();
        Map<String, String> typesSingle = new TreeMap<String, String>();
        for (int i = 0; i < branches.size(); i++) {
            for (Map<String, Object> row : query(branches.get(i))) {
                fromSingle.put(i + "|" + row.get("slice"), normalize(row));
                typesSingle.put(String.valueOf(i), types(row));
            }
        }
        if (base != null) {
            for (Map<String, Object> row : query(base)) {
                row.put("slice", null);
                Map<String, Object> ordered = new LinkedHashMap<String, Object>();
                ordered.put("slice", null);
                ordered.putAll(row);
                fromSingle.put("-1|null", normalize(ordered));
                typesSingle.put("-1", types(ordered));
            }
        }
        boolean same = fromMerged.equals(fromSingle);
        System.out.println((same ? "[OK] " : "[DIFF] ") + label + " rows=" + mergedRows.size()
                + " typesMerged=" + typesMerged.values().iterator().next() + " typesSingle=" + typesSingle);
        if (!same) {
            for (String key : fromSingle.keySet()) {
                if (!fromSingle.get(key).equals(fromMerged.get(key))) {
                    System.out.println("   single " + key + " -> " + fromSingle.get(key));
                    System.out.println("   merged " + key + " -> " + fromMerged.get(key));
                }
            }
        }
    }

    static String normalize(Map<String, Object> row) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> e : row.entrySet()) {
            Object v = e.getValue();
            String text = v instanceof Number ? String.valueOf(((Number) v).doubleValue()) : String.valueOf(v);
            sb.append(e.getKey()).append('=').append(text).append(',');
        }
        return sb.toString();
    }

    static String types(Map<String, Object> row) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> e : row.entrySet()) {
            sb.append(e.getKey()).append(':').append(e.getValue() == null ? "null" : e.getValue().getClass().getSimpleName()).append(' ');
        }
        return sb.toString();
    }

    static List<Map<String, Object>> query(String sql) throws Exception {
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                for (int i = 1; i <= md.getColumnCount(); i++) {
                    row.put(md.getColumnLabel(i), rs.getObject(i));
                }
                rows.add(row);
            }
        }
        return rows;
    }

    static AttributionAnalysisRequest v2Request(String agg, String nullHandling, boolean ratio) {
        AttributionAnalysisRequest r = new AttributionAnalysisRequest();
        r.setSessionId("s");
        r.setSubjectId("sub");
        r.setTable("sales");
        Map<String, Object> metric = new LinkedHashMap<String, Object>();
        if (ratio) {
            metric.put("kind", "ratio");
            metric.put("numerator", "amount");
            Map<String, Object> den = new LinkedHashMap<String, Object>();
            den.put("field", "qty");
            den.put("aggregation", "sum");
            metric.put("denominator", den);
        } else {
            metric.put("field", "count".equals(agg) ? "id" : "amount");
            metric.put("aggregation", agg);
        }
        r.setMetric(metric);
        r.setComparison(category());
        Map<String, Object> dim = new LinkedHashMap<String, Object>();
        dim.put("candidates", Arrays.asList("region", "prod_code"));
        dim.put("null_handling", nullHandling);
        dim.put("min_group_size", 1);
        r.setDimensionAttribution(dim);
        return r;
    }

    static Map<String, Object> category() {
        Map<String, Object> c = new LinkedHashMap<String, Object>();
        c.put("type", "category");
        c.put("field", "yr");
        c.put("groupA", "2025");
        c.put("groupB", "2024");
        return c;
    }

    static AttributionAnalysisRequest v3Request() {
        AttributionAnalysisRequest r = new AttributionAnalysisRequest();
        r.setVersion("v3");
        r.setSessionId("s");
        r.setSubjectId("sub");
        AttributionAnalysisRequest.Dataset ds = new AttributionAnalysisRequest.Dataset();
        ds.setSql("WITH x AS (SELECT * FROM sales WHERE id > 5)\nSELECT id, region, prod_code, biz_date, yr, amount, flag FROM x -- trailing comment;");
        ds.setGrainKey("id");
        r.setDataset(ds);
        Map<String, Object> metric = new LinkedHashMap<String, Object>();
        metric.put("field", "amount");
        metric.put("aggregation", "sum");
        r.setMetric(metric);
        r.setComparison(category());
        Map<String, Object> dim = new LinkedHashMap<String, Object>();
        dim.put("candidates", Arrays.asList("region", "prod_code"));
        dim.put("min_group_size", 1);
        r.setDimensionAttribution(dim);
        return r;
    }
}
