import com.kingdee.abi.ai.attribution.model.AttributionDefinitions;
import com.kingdee.abi.ai.attribution.sql.AttributionSqlBuilder;
import com.kingdee.abi.ai.attribution.support.AttributionRequestParser;
import com.kingdee.abi.ai.attribution.support.AttributionRequestParserV3;
import com.kingdee.abi.table.sql.SqlQueryProcessor;
import com.kingdee.abi.table.sql.catalog.SqlRelationCatalog;
import com.kingdee.abi.table.sql.catalog.SqlRelationTarget;
import com.kingdee.abi.table.sql.pipeline.SqlProcessingRequest;
import com.kingdee.abi.table.sql.required.RequiredFieldsRelation;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 评审用临时验证：合并 SQL 能否通过 SqlGuard / 必须字段规则，且结论与逐条 SQL 一致。
 */
public class MergedSqlGuardCheck {

    public static void main(String[] args) throws Exception {
        List<String> fields = Arrays.asList("id", "region", "prod_code", "biz_date", "yr", "amount", "qty", "price", "flag");
        Map<String, List<String>> dep = new LinkedHashMap<String, List<String>>();
        dep.put("amount", Collections.singletonList("region"));
        SqlRelationCatalog noReq = new SqlRelationCatalog(Collections.singletonList(
                new SqlRelationTarget("sales", "perm_sales", "r1", "sales", fields,
                        new RequiredFieldsRelation(new LinkedHashMap<String, List<String>>()))));
        SqlRelationCatalog withReq = new SqlRelationCatalog(Collections.singletonList(
                new SqlRelationTarget("sales", "perm_sales", "r1", "sales", fields, new RequiredFieldsRelation(dep))));

        AttributionSqlBuilder builder = new AttributionSqlBuilder();
        AttributionDefinitions.ResolvedRequest v2 = new AttributionRequestParser()
                .parse(MergedSqlDuckDbCheck.v2Request("sum", "as_group", false));
        List<String> dims = Arrays.asList("region", "prod_code", "biz_date");
        List<String> branches = new ArrayList<String>();
        for (String d : dims) {
            branches.add(builder.buildDimensionSqlAbsolute("sales", d, v2.getMetric(), v2.getComparison(), null,
                    "as_group", 1, null));
        }
        String base = builder.buildBaseSql("sales", v2.getMetric(), v2.getComparison(), null, "\"region\" = 'R1'").getSql();
        check("v2 single dim", branches.get(0), noReq, withReq);
        check("v2 base", base, noReq, withReq);
        check("v2 merged", builder.buildMergedSliceSql(branches, null, false), noReq, withReq);
        check("v2 merged+base", builder.buildMergedSliceSql(branches, base, false), noReq, withReq);

        AttributionDefinitions.ResolvedRequest v3 = new AttributionRequestParserV3().parse(MergedSqlDuckDbCheck.v3Request());
        List<String> v3Branches = new ArrayList<String>();
        for (String d : dims) {
            v3Branches.add(builder.buildDimensionSqlDataset(v3.getDatasetSql(), d, v3.getMetric(), v3.getComparison(),
                    "as_group", 1, null));
        }
        String v3Base = builder.buildBaseSqlDataset(v3.getDatasetSql(), v3.getMetric(), v3.getComparison(), null).getSql();
        check("v3 single dim", v3Branches.get(0), noReq, withReq);
        check("v3 merged+base", builder.buildMergedSliceSql(v3Branches, v3Base, false), noReq, withReq);
        String grain = com.kingdee.abi.ai.attribution.dataset.DatasetProbe.buildGrainCountSql(v3.getDatasetSql(), "id");
        check("v3 grain", grain, noReq, withReq);
        check("v3 grain+base", builder.buildGrainAndBaseSql(grain, v3Base, false), noReq, withReq);
        check("v3 probe", "SELECT * FROM " + AttributionSqlBuilder.datasetFrom(v3.getDatasetSql()) + " LIMIT 1", noReq, withReq);
    }

    static void check(String label, String sql, SqlRelationCatalog noReq, SqlRelationCatalog withReq) {
        System.out.println(label + " | noRequired: " + run(sql, noReq, false) + " | required(amount->region): " + run(sql, withReq, true));
    }

    static String run(String sql, SqlRelationCatalog catalog, boolean required) {
        try {
            String out = SqlQueryProcessor.getDuckDb().process(new SqlProcessingRequest(sql, catalog, required)).getSql();
            return "OK(" + out.replaceAll("\\s+", " ").length() + " chars, perm_sales x" + count(out, "perm_sales") + ")";
        } catch (Exception ex) {
            return "REJECT " + ex.getClass().getSimpleName() + ": " + String.valueOf(ex.getMessage()).replaceAll("\\s+", " ");
        }
    }

    static int count(String text, String token) {
        int n = 0;
        int i = 0;
        while ((i = text.indexOf(token, i)) >= 0) {
            n++;
            i += token.length();
        }
        return n;
    }
}
