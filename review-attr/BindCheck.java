import com.kingdee.abi.api.openapi.ai.request.AttributionAnalysisRequest;

/**
 * 评审用临时验证：Jackson / FastJSON 能否绑定带双 setter 的 Dataset。
 */
public class BindCheck {
    public static void main(String[] args) {
        String v2 = "{\"sessionId\":\"s\",\"subjectId\":\"x\",\"table\":\"t\",\"metric\":{\"field\":\"a\"}}";
        String v3 = "{\"version\":\"v3\",\"sessionId\":\"s\",\"subjectId\":\"x\",\"dataset\":{\"sql\":\"SELECT 1\",\"grainKey\":\"id\"}}";
        for (String body : new String[] {v2, v3}) {
            try {
                AttributionAnalysisRequest r = new com.fasterxml.jackson.databind.ObjectMapper()
                        .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                        .readValue(body, AttributionAnalysisRequest.class);
                System.out.println("jackson OK table=" + r.getTable() + " dataset=" + (r.getDataset() == null ? null : r.getDataset().getSql()));
            } catch (Exception ex) {
                System.out.println("jackson FAIL: " + ex.getClass().getSimpleName() + ": " + ex.getMessage().split("\n")[0]);
            }
            try {
                AttributionAnalysisRequest r = com.alibaba.fastjson.JSON.parseObject(body, AttributionAnalysisRequest.class);
                System.out.println("fastjson OK table=" + r.getTable() + " dataset=" + (r.getDataset() == null ? null : r.getDataset().getSql()));
            } catch (Exception ex) {
                System.out.println("fastjson FAIL: " + ex.getMessage());
            }
        }
    }
}
