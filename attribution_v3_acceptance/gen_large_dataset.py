# 生成万级主子表验收数据：应收单表头 5,000 单 + 收款计划明细约 5 万行（UTF-8 无 BOM）
# 埋点：2026 相对 2025 的增长主要来自「华东销售组织」与「工业自动化」产品线，便于核对归因结论。
import csv
import random
from datetime import date, timedelta

random.seed(20261015)
OUT_DIR = "large"
YEARS = [2024, 2025, 2026]
ORGS = ["华东销售组织", "华南销售组织", "华北销售组织", "西南销售组织", "华中销售组织", "东北销售组织"]
PRODUCT_LINES = ["工业自动化", "智能仓储", "能源设备", "电子元件", "精密机床", "检测仪器", "配套服务", "软件许可"]
FEE_TYPES = ["货款", "运费", "服务费", "安装费"]
FEE_WEIGHTS = [0.7, 0.1, 0.12, 0.08]
STATUSES = ["已审核"] * 9 + ["暂存"]
CURRENCIES = ["人民币"] * 19 + ["美元"]
CUSTOMERS = ["客户%03d" % i for i in range(1, 201)]
CUSTOMER_ORG = {c: ORGS[i % len(ORGS)] for i, c in enumerate(CUSTOMERS)}


def doc_amount(year, org, line):
    base = random.uniform(40000, 160000)
    if year == 2026 and org == "华东销售组织":
        base *= 1.8
    if year == 2026 and line == "工业自动化":
        base *= 1.5
    if year == 2024:
        base *= 0.9
    return base


def main():
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    headers, details = [], []
    line_id = 0
    for i in range(1, 5001):
        year = YEARS[i % 3]
        customer = random.choice(CUSTOMERS)
        org = CUSTOMER_ORG[customer]
        line = random.choice(PRODUCT_LINES)
        doc_no = "AR%d%05d" % (year, i)
        sign_date = date(year, 1, 1) + timedelta(days=random.randint(0, 364))
        headers.append([doc_no, customer, org, line, random.choice(STATUSES), random.choice(CURRENCIES),
                        year, sign_date.isoformat()])
        total = doc_amount(year, org, line)
        for _ in range(random.randint(6, 14)):
            line_id += 1
            fee = random.choices(FEE_TYPES, FEE_WEIGHTS)[0]
            amount = round(total * random.uniform(0.05, 0.2) * (1.0 if fee == "货款" else 0.3), 2)
            due = sign_date + timedelta(days=random.randint(15, 240))
            details.append(["L%07d" % line_id, doc_no, fee, amount, due.isoformat()])

    with open(OUT_DIR + "/应收单表头_万级.csv", "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["单据编号", "客户名称", "销售组织", "产品线", "单据状态", "币种", "签订年份", "签订日期"])
        writer.writerows(headers)
    with open(OUT_DIR + "/收款计划明细_万级.csv", "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["行ID", "单据编号", "费用类型", "未结算金额", "计划收款日期"])
        writer.writerows(details)
    print("headers", len(headers), "details", len(details))


if __name__ == "__main__":
    main()
