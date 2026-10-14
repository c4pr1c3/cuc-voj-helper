// Popup: load/save settings, reflect background status, one-click OJ binding.
//
// 绑定流程（popup 内完成，不经过 background）：
//   点击「绑定洛谷/牛客」→ 请求该 OJ 域的 optional host 权限 →
//   chrome.cookies 读整域全量 cookie → POST /extension/oj-accounts
//   （Bearer 配对 token）→ 后端自动解析用户名；解析失败时 422，
//   popup 露出手填用户名输入框，复用已读 cookie 重试。

const DEFAULTS = {
  vojBaseUrl: "http://172.18.114.170",
  sessionToken: "",
};

// 数据驱动：后续加 Codeforces 只需在此追加一项。
const OJ_LIST = [
  {
    key: "luogu",
    label: "洛谷",
    domain: "luogu.com.cn",
    originPattern: "https://*.luogu.com.cn/*",
    requiredCookie: "_uid",
  },
  {
    key: "nowcoder",
    label: "牛客",
    domain: "nowcoder.com",
    originPattern: "https://*.nowcoder.com/*",
    requiredCookie: "NOWCODERUID",
  },
];

const $ = (id) => document.getElementById(id);

function setDot(state, text, detail) {
  $("dot").className = `dot ${state}`;
  $("status-text").textContent = text;
  $("detail").textContent = detail || "";
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function loadSettings() {
  const settings = await getSettings();
  $("voj-url").value = settings.vojBaseUrl || "";
  $("token").value = settings.sessionToken || "";
}

async function refreshStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "voj_get_status" });
    if (!resp) {
      setDot("offline", "未连接", "background 未响应");
      return;
    }
    if (resp.connected) {
      setDot("online", "已连接", `服务器：${resp.vojBaseUrl}`);
    } else if (!resp.hasToken) {
      setDot("offline", "未配置", "请填入配对 Token");
    } else if (resp.reconnectAttempts > 0) {
      setDot("error", `重连中 (${resp.reconnectAttempts})`, `服务器：${resp.vojBaseUrl}`);
    } else {
      setDot("offline", "未连接", `服务器：${resp.vojBaseUrl}`);
    }
  } catch (e) {
    setDot("error", "通讯失败", String(e));
  }
}

// ── 保存并连接：顺带请求 VOJ origin 的 optional 权限（REST 绑定绕 CORS 用）──

async function ensureVojOriginPermission(baseUrl) {
  // 必须在用户手势内调用；已被拒过时 request 会再次弹询问。
  const origin = `${baseUrl}/*`;
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    return granted;
  } catch (e) {
    console.warn("[VOJ] voj origin permission request failed:", e);
    return false;
  }
}

$("save").addEventListener("click", async () => {
  const baseUrl = $("voj-url").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  if (!baseUrl) { alert("请填写 VOJ 服务器地址"); return; }
  if (!token) { alert("请填写配对 Token"); return; }
  await chrome.storage.local.set({ vojBaseUrl: baseUrl, sessionToken: token });
  // 请求 VOJ origin 权限；拒绝不影响 WS 连接，仅 REST 绑定不可用。
  const granted = await ensureVojOriginPermission(baseUrl);
  // background listens to storage changes and reconnects.
  $("save").textContent = "已保存";
  setTimeout(() => { $("save").textContent = "保存并连接"; }, 1500);
  refreshStatus();
  if (!granted) {
    showBindResult("warn", "未授予 VOJ 服务器访问权限：连接不受影响，但「一键绑定」无法使用。可再次保存以重新授权。");
  }
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ── 一键绑定 ─────────────────────────────────────────────────────────────────

let lastBind = null; // { oj, cookie } — 422 兜底重试时复用

function showBindResult(kind, text) {
  const el = $("bind-result");
  el.hidden = false;
  el.className = `bind-result ${kind}`;
  el.textContent = text;
}

function hideFallback() {
  $("fallback-row").hidden = true;
  $("fallback-username").value = "";
}

function setBindButtonsDisabled(disabled) {
  for (const oj of OJ_LIST) {
    $(`bind-${oj.key}`).disabled = disabled;
  }
}

async function readOjCookie(oj) {
  // optional host 权限：点击绑定（用户手势）时请求，存量用户更新后无感。
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [oj.originPattern] });
  } catch (e) {
    console.warn("[VOJ] permission request failed:", e);
  }
  if (!granted) {
    return { error: `未授予「${oj.label}」域名访问权限，无法读取 Cookie。` };
  }
  const cookies = await chrome.cookies.getAll({ domain: oj.domain });
  if (!cookies.length) {
    return { error: `未检测到「${oj.label}」Cookie，请先在浏览器登录 ${oj.label} 后重试。` };
  }
  const names = new Set(cookies.map((c) => c.name));
  if (!names.has(oj.requiredCookie)) {
    return { error: `未检测到登录态（缺少 ${oj.requiredCookie}），请先在浏览器登录 ${oj.label}。` };
  }
  return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function uploadBind(oj, cookie, ojUsername) {
  const settings = await getSettings();
  if (!settings.sessionToken) {
    return { httpError: "尚未配对：请先在 VOJ 生成配对 Token 并保存。" };
  }
  // VOJ origin 权限兜底：存量用户在绑定时补请求（本点击即手势）。
  const vojOrigin = `${settings.vojBaseUrl}/*`;
  const hasVojPerm = await chrome.permissions.contains({ origins: [vojOrigin] });
  if (!hasVojPerm) {
    const granted = await ensureVojOriginPermission(settings.vojBaseUrl);
    if (!granted) {
      return { httpError: "未授予 VOJ 服务器访问权限，无法上传。请重新点击「保存并连接」授权。" };
    }
  }
  const body = { oj_type: oj.key, cookie };
  if (ojUsername) body.oj_username = ojUsername;
  try {
    const resp = await fetch(`${settings.vojBaseUrl}/api/v1/extension/oj-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.sessionToken}`,
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 200) {
      return { ok: await resp.json() };
    }
    if (resp.status === 401) {
      return { httpError: "配对 Token 无效或已被撤销，请在 VOJ 重新生成并填入。" };
    }
    if (resp.status === 422) {
      return { needUsername: true };
    }
    return { httpError: `VOJ 服务器返回 ${resp.status}，请稍后重试。` };
  } catch (e) {
    return { httpError: `无法连接 VOJ 服务器（${settings.vojBaseUrl}）：${e.message}` };
  }
}

async function doBind(oj) {
  hideFallback();
  const settings = await getSettings();
  if (!settings.sessionToken) {
    showBindResult("err", "尚未配对：请先在 VOJ 生成配对 Token 并保存。");
    return;
  }
  setBindButtonsDisabled(true);
  showBindResult("warn", `正在读取 ${oj.label} Cookie 并上传…`);
  try {
    const read = await readOjCookie(oj);
    if (read.error) {
      showBindResult("err", read.error);
      return;
    }
    lastBind = { oj, cookie: read.cookie };
    const result = await uploadBind(oj, read.cookie, null);
    handleBindResult(result, oj.label);
  } finally {
    setBindButtonsDisabled(false);
  }
}

function handleBindResult(result, label) {
  if (result.ok) {
    const name = result.ok.oj_username || "";
    const valid = result.ok.is_valid ? "Cookie 有效" : "Cookie 校验未通过（可稍后重试）";
    showBindResult("ok", `已绑定 ${label}：${name}（${valid}）`);
    hideFallback();
    return;
  }
  if (result.needUsername) {
    showBindResult("warn", `未能自动识别 ${label} 用户名，请在下方手填后重试。`);
    $("fallback-row").hidden = false;
    $("fallback-username").focus();
    return;
  }
  showBindResult("err", result.httpError || "未知错误");
}

for (const oj of OJ_LIST) {
  $(`bind-${oj.key}`).addEventListener("click", () => doBind(oj));
}

$("fallback-retry").addEventListener("click", async () => {
  if (!lastBind) return;
  const name = $("fallback-username").value.trim();
  if (!name) { alert("请填写 OJ 用户名"); return; }
  setBindButtonsDisabled(true);
  try {
    const result = await uploadBind(lastBind.oj, lastBind.cookie, name);
    handleBindResult(result, lastBind.oj.label);
  } finally {
    setBindButtonsDisabled(false);
  }
});

loadSettings();
refreshStatus();
setInterval(refreshStatus, 2000);
