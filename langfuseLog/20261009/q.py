import json, sys, urllib.request
TOKEN = "1536230697407890389_yf73I0MsvW2Yg4Rqy4IOQ1qq992YEmBaLxS2BuKAABUWmJX1NaQFdi4rtxD4t7wm9oFBdMZonoshHk4655EU62P4TuCEHtF15A8N06"
SID = "61fd1502-6b48-470f-b00d-1aa91f43afb8"
def q(sql):
    body = json.dumps({"dataSourceType": "ABI", "sql": sql, "subjectId": SID}).encode()
    req = urllib.request.Request("https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/sqlExecute", data=body,
        headers={"access_token": TOKEN, "Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=60).read())
    print(r.get("data") if r.get("status") else r)
if __name__ == "__main__":
    q(sys.argv[1])
