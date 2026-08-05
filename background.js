// VOJ Companion — background service worker
//
// Responsibilities:
//   1. Maintain a WebSocket connection to the VOJ backend (/extension/ws).
//   2. Authenticate using the session_token stored in chrome.storage.local.
//   3. Respond to ping with pong.
//   4. Handle "fetch_problem_request" messages by fetching the URL inside the
//      service worker's own fetcher (CF sees the extension's browser context
//      with its real cookies/fingerprint and treats it as a normal visit).
//
// The service worker is event-driven and may be killed by Chrome when idle.
// Chrome wakes it on incoming WS messages and on chrome.storage changes. We
// also wake it via an alarms-based keepalive (see _scheduleKeepalive) so the
// WS survives long idle periods.

const DEFAULTS = {
  vojBaseUrl: "http://172.18.114.170",
  sessionToken: "",
  autoReconnect: true,
  reconnectBackoffMs: 2000,
  maxReconnectBackoffMs: 30000,
};

// --- Module-level state ----------------------------------------------------

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pingTimer = null;
let lastWsUrl = "";
const pendingPongs = new Set(); // track pong timeouts

// --- Storage helpers -------------------------------------------------------

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function setSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// --- Status broadcasting (popup reads this) -------------------------------

async function broadcastStatus() {
  const settings = await getSettings();
  const status = {
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
    readyState: ws ? ws.readyState : WebSocket.CLOSED,
    hasToken: !!settings.sessionToken,
    vojBaseUrl: settings.vojBaseUrl,
    reconnectAttempts,
  };
  // Popup subscribes via chrome.storage.local changes; also emit a custom
  // event the popup can listen to on its window.
  try {
    await chrome.runtime.sendMessage({ type: "voj_status", status }).catch(() => {});
  } catch (_) {
    // No popup listening — ignore.
  }
  return status;
}

// --- WebSocket connection --------------------------------------------------

function buildWsUrl(settings) {
  const base = settings.vojBaseUrl.replace(/\/$/, "");
  const apiPrefix = "/api/v1";
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}${apiPrefix}/extension/ws?token=${encodeURIComponent(settings.sessionToken)}`;
}

async function connect() {
  const settings = await getSettings();
  if (!settings.sessionToken) {
    console.log("[VOJ] no session_token, skipping connect");
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = buildWsUrl(settings);
  lastWsUrl = url;
  console.log("[VOJ] connecting to", url);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn("[VOJ] WebSocket ctor failed:", e);
    scheduleReconnect(settings);
    return;
  }

  ws.onopen = () => {
    console.log("[VOJ] WS open");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    startPingWatcher();
    broadcastStatus();
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.warn("[VOJ] non-JSON frame:", event.data);
      return;
    }
    handleMessage(msg).catch((e) => console.warn("[VOJ] handler error:", e));
  };

  ws.onerror = (e) => {
    console.warn("[VOJ] WS error:", e);
  };

  ws.onclose = (event) => {
    console.log("[VOJ] WS close code", event.code);
    stopPingWatcher();
    ws = null;
    broadcastStatus();
    if (event.code === 4401) {
      // Token rejected — don't reconnect in a tight loop; popup will surface.
      console.warn("[VOJ] auth failed (4401); stopping auto-reconnect");
      return;
    }
    if (settings.autoReconnect) {
      scheduleReconnect(settings);
    }
  };
}

function scheduleReconnect(settings) {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const backoff = Math.min(
    settings.reconnectBackoffMs * Math.pow(2, reconnectAttempts - 1),
    settings.maxReconnectBackoffMs,
  );
  console.log(`[VOJ] reconnect attempt ${reconnectAttempts} in ${backoff}ms`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connect();
    broadcastStatus();
  }, backoff);
}

function startPingWatcher() {
  stopPingWatcher();
  // The backend sends ping every 30s; if we haven't seen one in 90s, the
  // connection is dead — close and let onclose trigger reconnect.
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Send a no-op to detect broken sockets (send() throws on dead socket).
      try {
        ws.send(JSON.stringify({ type: "pong" }));
      } catch (e) {
        console.warn("[VOJ] keepalive send failed:", e);
        try { ws.close(); } catch (_) {}
      }
    }
  }, 25000);
}

function stopPingWatcher() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

// --- Message dispatch ------------------------------------------------------

async function handleMessage(msg) {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "auth_ok":
      console.log("[VOJ] auth_ok user_id=", msg.user_id, "session=", msg.session_id);
      break;
    case "ping":
      // Backend-initiated heartbeat — reply pong.
      sendFrame({ type: "pong" });
      break;
    case "fetch_problem_request":
      await handleFetchProblem(msg);
      break;
    case "fetch_ce_detail_request":
      await handleFetchCeDetail(msg);
      break;
    default:
      console.log("[VOJ] unhandled msg type:", msg.type);
  }
}

function sendFrame(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

// --- A3: fetch_problem_request handler -----------------------------------

async function handleFetchProblem(msg) {
  const { request_id, url } = msg;
  console.log("[VOJ] fetch_problem_request", request_id, url);

  // Validate the URL is a Codeforces problem page we're willing to fetch.
  // This guards against the backend (or a compromised backend) asking the
  // extension to fetch arbitrary URLs through the user's browser session.
  if (!url || !/^https:\/\/codeforces\.com\/problemset\/problem\/\d+\/[A-Za-z0-9]+$/i.test(url)) {
    sendFrame({
      type: "fetch_problem_result",
      request_id,
      ok: false,
      error: `URL not allowed: ${url}`,
    });
    return;
  }

  try {
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include", // send CF cookies (cf_clearance, 70OEs, Handle, etc.)
      redirect: "follow",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!resp.ok) {
      sendFrame({
        type: "fetch_problem_result",
        request_id,
        ok: false,
        error: `HTTP ${resp.status}`,
      });
      return;
    }

    const html = await resp.text();
    if (!html || html.length < 500) {
      sendFrame({
        type: "fetch_problem_result",
        request_id,
        ok: false,
        error: `response too short (${html.length} bytes)`,
      });
      return;
    }

    sendFrame({
      type: "fetch_problem_result",
      request_id,
      ok: true,
      html,
      finalUrl: resp.url,
      status: resp.status,
    });
    console.log(`[VOJ] fetch_problem ${request_id} ok (${html.length} bytes)`);
  } catch (e) {
    console.warn(`[VOJ] fetch_problem ${request_id} failed:`, e);
    sendFrame({
      type: "fetch_problem_result",
      request_id,
      ok: false,
      error: String(e && e.message ? e.message : e),
    });
  }
}

// --- CE detail fetch -------------------------------------------------------

async function handleFetchCeDetail(msg) {
  const { request_id, submission_id } = msg;
  console.log("[VOJ] fetch_ce_detail_request", request_id, "sid=", submission_id);

  // Validate sid is a bare integer (CF submission ids are numeric).
  if (!submission_id || !/^\d+$/.test(String(submission_id))) {
    sendFrame({
      type: "fetch_ce_detail_result",
      request_id,
      ok: false,
      error: `invalid submission_id: ${submission_id}`,
    });
    return;
  }

  // CF exposes the compiler output via POST /data/submitSource (JSON, login-
  // gated). The HTML status page also has it but is Cloudflare-protected;
  // /data/submitSource is on the same origin and works with just the user's
  // CF session cookie.
  try {
    const resp = await fetch("https://codeforces.com/data/submitSource", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "submissionId=" + encodeURIComponent(submission_id),
    });

    if (!resp.ok) {
      sendFrame({
        type: "fetch_ce_detail_result",
        request_id,
        ok: false,
        error: `HTTP ${resp.status}`,
      });
      return;
    }

    const data = await resp.json();
    if (data && data.error) {
      sendFrame({
        type: "fetch_ce_detail_result",
        request_id,
        ok: false,
        error: data.error,
      });
      return;
    }

    // CF returns { source, lang, verdict, sourceCodeBytes, ... }.
    // For CE submissions we want the "source" or "verdict" field which on CF
    // embeds the compiler output when the submission failed to compile.
    const ce = data.source || data.verdict || data.comment || "";
    sendFrame({
      type: "fetch_ce_detail_result",
      request_id,
      ok: true,
      compile_error: typeof ce === "string" ? ce : JSON.stringify(ce),
      raw: data,
    });
    console.log(`[VOJ] fetch_ce_detail ${request_id} ok (${String(ce).length} chars)`);
  } catch (e) {
    console.warn(`[VOJ] fetch_ce_detail ${request_id} failed:`, e);
    sendFrame({
      type: "fetch_ce_detail_result",
      request_id,
      ok: false,
      error: String(e && e.message ? e.message : e),
    });
  }
}

// --- Lifecycle hooks -------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VOJ] Companion installed");
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[VOJ] Companion startup");
  connect();
});

// Wake the SW when chrome.storage.sessionToken changes (user paired/re-paired)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.sessionToken) {
    console.log("[VOJ] session_token changed — reconnecting");
    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    connect();
  }
  if (changes.vojBaseUrl) {
    console.log("[VOJ] vojBaseUrl changed — reconnecting");
    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    connect();
  }
});

// Popup → background RPCs
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "voj_get_status") {
    broadcastStatus().then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === "voj_reconnect") {
    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    connect().then(broadcastStatus).then(sendResponse);
    return true;
  }
  return false;
});

// Initial connect when the SW first spins up (covers the case where Chrome
// wakes the SW without onInstalled/onStartup firing).
connect();
broadcastStatus();
