// Popup: load/save settings, reflect background status.

const DEFAULTS = {
  vojBaseUrl: "http://172.18.114.170",
  sessionToken: "",
};

const $ = (id) => document.getElementById(id);

function setDot(state, text, detail) {
  $("dot").className = `dot ${state}`;
  $("status-text").textContent = text;
  $("detail").textContent = detail || "";
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
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

$("save").addEventListener("click", async () => {
  const baseUrl = $("voj-url").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  if (!baseUrl) { alert("请填写 VOJ 服务器地址"); return; }
  if (!token) { alert("请填写配对 Token"); return; }
  await chrome.storage.local.set({ vojBaseUrl: baseUrl, sessionToken: token });
  // background listens to storage changes and reconnects.
  $("save").textContent = "已保存";
  setTimeout(() => { $("save").textContent = "保存并连接"; }, 1500);
  refreshStatus();
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

loadSettings();
refreshStatus();
setInterval(refreshStatus, 2000);
