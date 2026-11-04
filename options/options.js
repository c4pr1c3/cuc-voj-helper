const DEFAULTS = {
  vojBaseUrl: "https://voj.cuc.edu.cn",
  sessionToken: "",
  autoReconnect: true,
  reconnectBackoffMs: 2000,
  maxReconnectBackoffMs: 30000,
};

const $ = (id) => document.getElementById(id);

async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
  $("voj-url").value = settings.vojBaseUrl;
  $("token").value = settings.sessionToken;
  $("auto-reconnect").checked = !!settings.autoReconnect;
  $("reconnect-backoff").value = settings.reconnectBackoffMs;
  $("max-backoff").value = settings.maxReconnectBackoffMs;
}

$("save").addEventListener("click", async () => {
  const settings = {
    vojBaseUrl: $("voj-url").value.trim().replace(/\/$/, ""),
    sessionToken: $("token").value.trim(),
    autoReconnect: $("auto-reconnect").checked,
    reconnectBackoffMs: Math.max(500, Number($("reconnect-backoff").value) || 2000),
    maxReconnectBackoffMs: Math.max(1000, Number($("max-backoff").value) || 30000),
  };
  await chrome.storage.local.set(settings);
  $("save").textContent = "已保存";
  setTimeout(() => { $("save").textContent = "保存"; }, 1500);
});

$("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "voj_reconnect" });
  $("reconnect").textContent = "已触发";
  setTimeout(() => { $("reconnect").textContent = "立即重连"; }, 1500);
});

load();
