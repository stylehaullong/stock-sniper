/**
 * Browserbase Context Manager
 * Handles persistent browser contexts for session reuse (login persistence).
 */

const BB_API = "https://api.browserbase.com/v1";

function bbHeaders() {
  return {
    "x-bb-api-key": process.env.BROWSERBASE_API_KEY!,
    "Content-Type": "application/json",
  };
}

/** Create a new persistent context */
export async function createContext(): Promise<string> {
  const res = await fetch(`${BB_API}/contexts`, {
    method: "POST",
    headers: bbHeaders(),
    body: JSON.stringify({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Browserbase context: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.id;
}

/** Delete a context */
export async function deleteContext(contextId: string): Promise<void> {
  await fetch(`${BB_API}/contexts/${contextId}`, {
    method: "DELETE",
    headers: bbHeaders(),
  });
}

// Mobile iPhone user agent — bypasses Target's bot detection
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Create a session with a persistent context and return session ID + live view URL */
export async function createSessionWithContext(contextId: string): Promise<{
  sessionId: string;
  connectUrl: string;
  liveViewUrl: string;
}> {
  // Create session with context persistence + mobile mode
  const sessionRes = await fetch(`${BB_API}/sessions`, {
    method: "POST",
    headers: bbHeaders(),
    body: JSON.stringify({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      keepAlive: true,
      proxies: true,
      browserSettings: {
        context: {
          id: contextId,
          persist: true,
        },
        solveCaptchas: true,
        viewport: MOBILE_VIEWPORT,
        fingerprint: {
          devices: ["mobile"],
          operatingSystems: ["ios"],
        },
      },
    }),
  });

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    throw new Error(`Failed to create session: ${sessionRes.status} ${err}`);
  }

  const session = await sessionRes.json();

  // Get live view URL
  const debugRes = await fetch(`${BB_API}/sessions/${session.id}/debug`, {
    headers: bbHeaders(),
  });

  if (!debugRes.ok) {
    throw new Error(`Failed to get live view URL: ${debugRes.status}`);
  }

  const debug = await debugRes.json();

  return {
    sessionId: session.id,
    connectUrl: session.connectUrl || `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${session.id}`,
    liveViewUrl: debug.debuggerFullscreenUrl,
  };
}

/** End a session (saves context if persist was true) */
export async function endSession(sessionId: string): Promise<void> {
  await fetch(`${BB_API}/sessions/${sessionId}`, {
    method: "PUT",
    headers: bbHeaders(),
    body: JSON.stringify({
      status: "REQUEST_RELEASE",
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    }),
  });
}

/** Check if a session is still running */
export async function getSessionStatus(sessionId: string): Promise<string> {
  const res = await fetch(`${BB_API}/sessions/${sessionId}`, {
    headers: bbHeaders(),
  });
  if (!res.ok) return "UNKNOWN";
  const data = await res.json();
  return data.status;
}