# 在本地服务上新建主题（可选）并把 CSV 上传为来源表、启动抽取（仿前端上传弹窗的请求序列）
# 用法：
#   python3 build_subject.py                       # 默认：向小主题追加两份 80 行 CSV
#   python3 build_subject.py --new "主题名" a.csv b.csv   # 新建主题再上传
import json
import sys

import abi_session as s

SPACE_ID = "2438005098631156736"
DM = "/abi/dataModeling.do"
DEFAULT_SUBJECT = "f015e8ac-b0cd-495f-958b-137b417546f3"
DEFAULT_FILES = ["收款计划表头.csv", "收款计划明细.csv"]


def dm(method, params):
    base = {"spaceId": SPACE_ID, "spaceFacadeSpaceId": SPACE_ID, "spaceFacadeAppId": "qing"}
    base.update(params)
    text = s.request(DM, method, base)
    data = json.loads(text)
    if "errorCode" in data and data.get("errorCode") not in (None, 0, "0"):
        raise RuntimeError("%s failed: %s" % (method, text[:800]))
    return data.get("data", data)


def create_subject(name):
    model = {"id": "", "subjectDirectoryId": "", "name": name,
             "introduction": "归因 v3 性能验收用（脚本生成）", "spaceId": SPACE_ID}
    data = json.loads(s.request("/abi/subject.do", "saveOrUpdateSubject",
                                {"model": json.dumps(model, ensure_ascii=False)}))
    if "data" not in data:
        raise RuntimeError("saveOrUpdateSubject failed: %s" % str(data)[:500])
    return data["data"]


def upload_tables(subject_id, files):
    models = []
    for path in files:
        up = json.loads(s.upload(path))
        if "data" not in up:
            raise RuntimeError("upload failed: %s" % str(up)[:500])
        file_url = up["data"]["fileUrl"]
        charset = dm("guessFileEncoding", {"filePath": file_url})
        name = path.split("/")[-1]
        source = {"name": "qing", "fileType": "CSV", "fileName": name, "fileUrl": file_url,
                  "characterSet": charset if isinstance(charset, str) and charset else "UTF-8",
                  "splitSign": ",", "textLimitSign": '"'}
        infos = dm("getTableInfos", {"source": source})
        child = infos["children"][0]
        fields = dm("getTableFields", {"source": source, "associateNames": [child["name"]]})
        entity = fields[0]["entity"] if isinstance(fields, list) and "entity" in fields[0] else fields[0]
        if isinstance(entity, str):
            entity = json.loads(entity)
        print(name, "charset=", source["characterSet"], "sheet=", child["name"],
              "props=", [(p["name"], p.get("dataType")) for p in entity.get("properties", [])])
        models.append({"source": source, "entity": entity, "schedule": None})

    saved = dm("saveTableModel", {"sourceType": "source", "subjectId": subject_id, "models": models})
    table_ids = [item.get("tableId") for item in saved]
    print("saved tableIds:", table_ids, [item.get("resourceName") for item in saved])
    for table_id in table_ids:
        execute_id = dm("startExtractData", {"sourceType": "source", "subjectId": subject_id, "tableId": table_id})
        print("extract", table_id, "->", execute_id)
    return table_ids


def main():
    s.login()
    if len(sys.argv) > 2 and sys.argv[1] == "--new":
        subject_id = create_subject(sys.argv[2])
        files = sys.argv[3:]
        print("new subject:", subject_id)
    else:
        subject_id, files = DEFAULT_SUBJECT, DEFAULT_FILES
    table_ids = upload_tables(subject_id, files)
    json.dump({"subjectId": subject_id, "tableIds": table_ids}, open("subject_tables.json", "w"))


if __name__ == "__main__":
    main()
