import { fillCurseForgePage, type CurseFillResult, type CurseFormFill } from "@/lib/omnimod/publish";

declare const chrome: {
  action: { onClicked: { addListener: (cb: () => void) => void } };
  runtime: {
    getURL: (path: string) => string;
    onMessage: { addListener: (cb: MessageHandler) => void };
    onMessageExternal: { addListener: (cb: MessageHandler) => void };
  };
  tabs: {
    create: (opts: { url: string; active?: boolean }) => Promise<{ id?: number }>;
    query: (opts: { url: string }) => Promise<Array<{ id?: number }>>;
    update: (id: number, opts: { url: string; active: boolean }) => Promise<unknown>;
    get: (id: number) => Promise<{ status?: string }>;
    remove: (id: number) => Promise<void>;
  };
  scripting: {
    executeScript: (opts: {
      target: { tabId: number };
      func: typeof fillCurseForgePage;
      args: [CurseFormFill];
    }) => Promise<Array<{ result?: CurseFillResult }>>;
  };
};

type MessageHandler = (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean | void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntilReady(id: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let tab: { status?: string } | undefined;
    try {
      tab = await chrome.tabs.get(id);
    } catch {
      return;
    }
    if (tab.status !== "loading") return;
    await sleep(100);
  }
}

async function openTab(url: string): Promise<number | null> {
  const existing = await chrome.tabs.query({ url: "https://authors.curseforge.com/*" });
  const reuse = existing.find((tab) => tab.id != null);
  if (reuse?.id != null) {
    await chrome.tabs.update(reuse.id, { url, active: false });
    await waitUntilReady(reuse.id);
    return reuse.id;
  }
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id == null) return null;
  await waitUntilReady(tab.id);
  return tab.id;
}

async function fill(url: string, payload: CurseFormFill): Promise<CurseFillResult> {
  const tabId = await openTab(url);
  if (tabId == null) {
    return {
      ok: false,
      message: "CurseForge could not open the form tab.",
      step: "tab",
      reason: "no tab id",
      logs: ["tabs.create returned no tab"],
    };
  }
  const packed = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillCurseForgePage,
    args: [payload],
  });
  const result = packed?.[0]?.result;
  if (!result || typeof result.ok !== "boolean") {
    return {
      ok: false,
      message: "CurseForge form could not be filled. The tab was left open.",
      step: "scripting",
      reason: "the form script returned nothing",
      logs: ["scripting.executeScript returned no result"],
    };
  }
  if (result.ok) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* the upload is already done */
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function handle(message: unknown, sendResponse: (value: unknown) => void): boolean {
  if (!isRecord(message) || typeof message.type !== "string") return false;
  if (message.type === "omnimod-open-tab" && typeof message.url === "string") {
    const url = message.url;
    openTab(url).then(
      (id) => sendResponse({ id }),
      (error) => sendResponse({ error: error instanceof Error ? error.message : "The tab could not be opened." }),
    );
    return true;
  }
  if (message.type === "omnimod-curse-fill" && typeof message.url === "string" && isRecord(message.fill)) {
    const url = message.url;
    fill(url, message.fill as CurseFormFill).then(sendResponse, (error) => {
      const detail = error instanceof Error ? error.message : "The tab could not be opened.";
      sendResponse({
        ok: false,
        message: `CurseForge could not open the form tab. ${detail}`,
        step: "tab",
        reason: detail,
        logs: [detail],
      });
    });
    return true;
  }
  return false;
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => handle(message, sendResponse));
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => handle(message, sendResponse));
