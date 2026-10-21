# 本地调试服务登录会话 + request.do 通道调用（仿 CookieService 登录方式）
import gzip
import http.cookiejar
import json
import os
import sys
import urllib.parse
import urllib.request
import uuid

HOST = "http://localhost:8080/ierp"
ACCOUNT_ID = "2426992609034504192"
USER = os.environ.get("ABI_MOCK_USER", "13428719630")

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))


def login():
    query = urllib.parse.urlencode({"redirect": HOST + "/", "accountId": ACCOUNT_ID,
                                    "language": "zh_CN", "user": USER})
    with _opener.open(HOST + "/auth/loginCheck.do?" + query, timeout=60) as resp:
        resp.read()
    return [c.name for c in _jar]


def request(service_type, method, params, timeout=300):
    """走 /abishared/request.do：{serviceType, methodName, params:{...}}，params 值统一为字符串"""
    payload = {k: (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)) for k, v in params.items()}
    body = {"serviceType": service_type, "methodName": method, "params": payload}
    req = urllib.request.Request(HOST + "/abishared/request.do",
                                 data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with _opener.open(req, timeout=timeout) as resp:
        return _decode(resp.read())


def _decode(raw):
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8")


def upload(path):
    """multipart 上传到 /abi/parseAndUploadFile.do，字段 file + appId=qing"""
    boundary = "----abi" + uuid.uuid4().hex
    name = os.path.basename(path)
    with open(path, "rb") as f:
        content = f.read()
    # 后端取 fileItems.get(0) 作为文件，file 段必须排在第一位
    parts = [
        ("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
         "Content-Type: text/csv\r\n\r\n" % (boundary, name)).encode("utf-8") + content + b"\r\n",
        ("--%s\r\nContent-Disposition: form-data; name=\"appId\"\r\n\r\nqing\r\n" % boundary).encode("utf-8"),
        ("--%s--\r\n" % boundary).encode("utf-8"),
    ]
    req = urllib.request.Request(HOST + "/abi/parseAndUploadFile.do", data=b"".join(parts),
                                 headers={"Content-Type": "multipart/form-data; boundary=" + boundary},
                                 method="POST")
    with _opener.open(req, timeout=120) as resp:
        return _decode(resp.read())


if __name__ == "__main__":
    print(login())
    if len(sys.argv) > 3:
        print(request(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))[:3000])
