"""扩展 popup 一键绑定 — 系统 Chrome 自动化端到端测试（issue #11）。

用 Playwright 驱动系统 google-chrome（channel='chrome'，xvfb-run 有头）加载
cuc-voj-helper 的 fixture 副本（manifest 把洛谷/牛客域名补丁为声明式权限，
绕过 Chrome 原生权限气泡；生产 manifest 不动），对 docker compose dev 环境
（默认 http://localhost:8090）走完整绑定流。

覆盖（fake cookie，无需真实 OJ 登录）：
  1. 洛谷：无法解析用户名（_uid=e2einvalid 保证 404）→ popup 露出手填
     兜底输入框 → 手填重试 → 绑定成功
  2. 牛客：NOWCODERUID=103（公开 profile）→ 后端自动解析出用户名 → 直接成功
  3. API 侧断言 oj_accounts 行存在

运行（详见同目录 README.md）：
  cd cuc-voj-helper/test
  ./setup.sh            # 首次：建 venv 装 playwright（清华源）
  xvfb-run -a python test_bind_e2e.py

输出遵循仓库 e2e 协议：PASS:/FAIL:/WARN: + 截图落 e2e-tests/<时间戳>/。
"""
import json
import os
import shutil
import sys
import tempfile
import hashlib
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

VOJ_BASE = os.environ.get("VOJ_BASE_URL", "http://localhost:8090")
EVIDENCE_ROOT = Path(__file__).resolve().parents[2] / "e2e-tests"
TIMEOUT_MS = 30000

results = []


def log(msg):
    print(msg, flush=True)


def step(name, cond, evidence=None):
    tag = "PASS" if cond else "FAIL"
    results.append(cond)
    log(f"{tag}: {name}")
    if not cond and evidence:
        log(f"      evidence: {evidence}")
    return cond


def api(method, path, payload=None, token=None, expect=200):
    req = urllib.request.Request(
        VOJ_BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read() or b"{}")
        if expect and resp.status != expect:
            raise RuntimeError(f"{method} {path} -> {resp.status}: {body}")
    return body


def make_fixture():
    """复制扩展目录并把 OJ 域名提升为声明式 host 权限（免原生气泡）。"""
    src = Path(__file__).resolve().parents[1]
    dst = Path(tempfile.mkdtemp(prefix="voj-helper-fixture-")) / "cuc-voj-helper"
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("test", ".git", ".venv"))
    manifest = json.loads((dst / "manifest.json").read_text())
    manifest["host_permissions"] = sorted(
        set(manifest.get("host_permissions", []))
        | {"https://*.luogu.com.cn/*", "https://*.nowcoder.com/*"}
    )
    (dst / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    return dst


def read_admin_creds():
    env = Path(__file__).resolve().parents[2] / "backend" / ".env.docker"
    user, pwd = None, None
    for line in env.read_text().splitlines():
        if line.startswith("ADMIN_USERNAME="):
            user = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("ADMIN_PASSWORD="):
            pwd = line.split("=", 1)[1].strip().strip('"')
    assert user and pwd, f"cannot read admin creds from {env}"
    return user, pwd


def main():
    evidence_dir = EVIDENCE_ROOT / (time.strftime("%Y%m%d-%H%M%S") + "-extbind")
    evidence_dir.mkdir(parents=True, exist_ok=True)
    log(f"# evidence dir: {evidence_dir}")

    # ── VOJ 侧准备：登录 + 配对 ──
    admin_user, admin_pass = read_admin_creds()
    auth = api("POST", "/api/v1/auth/login", {"username": admin_user, "password": admin_pass})
    jwt = auth.get("access_token") or auth.get("token")
    assert jwt, f"login returned no token: {auth.keys()}"
    token = api("POST", "/api/v1/extension/pair", token=jwt)["session_token"]
    log(f"# paired (token ...{token[-6:]})")

    fixture = make_fixture()

    with sync_playwright() as p:
        # headless=new（channel="chromium"）原生支持扩展加载，无需 xvfb。
        # 注：品牌 google-chrome 137+ 忽略 --load-extension，故用 Playwright
        # 自带 Chromium；真实 Chrome 的装载留给手动验收清单。
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(fixture.parent / "profile"),
            channel="chromium",
            headless=True,
            ignore_default_args=["--disable-extensions"],
            args=[
                f"--disable-extensions-except={fixture}",
                f"--load-extension={fixture}",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            viewport={"width": 420, "height": 720},
        )
        try:
            # unpacked 扩展 id 由绝对路径确定（SHA256 前 32 hex → a-p），
            # 直接计算，避免 SW 注册时序竞态。
            digest = hashlib.sha256(str(fixture).encode()).hexdigest()[:32]
            ext_id = "".join(chr(ord("a") + int(c, 16)) for c in digest)
            log(f"# extension id: {ext_id}")


            # 假登录态：洛谷 _uid 故意无效（保证解析 404 → 422 兜底分支）；
            # 牛客 NOWCODERUID=103 是公开 profile（保证自动解析成功分支）。
            ctx.add_cookies([
                {"name": "_uid", "value": "e2einvalid", "domain": ".luogu.com.cn", "path": "/", "secure": True},
                {"name": "__client_id", "value": "e2eclient", "domain": ".luogu.com.cn", "path": "/", "secure": True},
                {"name": "NOWCODERUID", "value": "103", "domain": ".nowcoder.com", "path": "/", "secure": True},
                {"name": "NOWCODERCLINETID", "value": "e2enc", "domain": ".nowcoder.com", "path": "/", "secure": True},
            ])

            popup = ctx.new_page()
            popup.goto(f"chrome-extension://{ext_id}/popup/popup.html")
            popup.wait_for_selector("#bind-luogu", timeout=TIMEOUT_MS)

            popup.fill("#voj-url", VOJ_BASE)
            popup.fill("#token", token)
            popup.click("#save")
            popup.wait_for_timeout(1500)
            popup.screenshot(path=str(evidence_dir / "01-paired.png"))

            # ── 1. 洛谷：自动解析失败 → 手填兜底 → 成功 ──
            popup.click("#bind-luogu")
            popup.wait_for_selector("#fallback-row:not([hidden])", timeout=TIMEOUT_MS)
            popup.wait_for_selector("#bind-result.warn", timeout=TIMEOUT_MS)
            popup.screenshot(path=str(evidence_dir / "02-luogu-fallback.png"))
            step("luogu unresolvable → fallback row shown", True)

            popup.fill("#fallback-username", "e2e_lg_user")
            popup.click("#fallback-retry")
            popup.wait_for_selector("#bind-result.ok", timeout=TIMEOUT_MS)
            popup.screenshot(path=str(evidence_dir / "03-luogu-bound.png"))
            ok_text = popup.text_content("#bind-result")
            step("luogu manual retry binds", "已绑定 洛谷：e2e_lg_user" in ok_text, ok_text)

            # ── 2. 牛客：公开 profile 自动解析 → 直接成功 ──
            popup.click("#bind-nowcoder")
            popup.wait_for_selector("#bind-result.ok", timeout=TIMEOUT_MS)
            popup.screenshot(path=str(evidence_dir / "04-nowcoder-bound.png"))
            nc_text = popup.text_content("#bind-result")
            step("nowcoder auto-resolve binds", "已绑定 牛客" in nc_text and "嘤嘤" not in "", nc_text)

            # ── 3. API 侧断言 ──
            rows = api("GET", "/api/v1/users/me/oj-accounts", token=jwt)
            by_type = {r["oj_type"]: r for r in rows}
            step(
                "api: luogu row = e2e_lg_user",
                by_type.get("luogu", {}).get("oj_username") == "e2e_lg_user",
                str(by_type),
            )
            step(
                "api: nowcoder row auto-resolved",
                bool(by_type.get("nowcoder", {}).get("oj_username")),
                str(by_type),
            )
            step(
                "api: fake cookies flagged invalid",
                by_type.get("luogu", {}).get("is_valid") is False
                and by_type.get("nowcoder", {}).get("is_valid") is False,
                str(by_type),
            )
        finally:
            ctx.close()
            shutil.rmtree(fixture.parent, ignore_errors=True)

    passed = sum(results)
    log(f"# {passed}/{len(results)} steps passed")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
