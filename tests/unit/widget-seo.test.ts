// @vitest-environment happy-dom
/**
 * SEO SAFETY — the widget must NEVER render <h1> or <h2>. NEVER delete.
 * Also covers targeting display, escaping, and a11y attributes.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const OFFER = {
  id: "offer-1",
  type: "quantity_break",
  title: "Buy More <b>Save</b> More",
  priority: 0,
  config: {
    tiers: [
      { qty: 2, type: "pct", value: 10 },
      { qty: 3, type: "pct", value: 20 },
    ],
  },
};

function mockFetch(offers: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ offers }),
    })),
  );
}

async function renderWidget(attrs: Record<string, string> = {}) {
  const el = document.createElement("bundlekit-widget");
  el.setAttribute("product-id", "gid://shopify/Product/111");
  el.setAttribute("current-price", "2500"); // cents
  el.setAttribute("currency", "USD");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  // connectedCallback kicks off async render — let microtasks settle
  await new Promise((resolve) => setTimeout(resolve, 10));
  return el;
}

beforeAll(async () => {
  // Side-effect import registers the custom element
  await import("../../extensions/bundle-widget/assets/bundle-widget.js" as string);
});

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("SEO safety", () => {
  it("widget HTML never contains h1 or h2 elements", async () => {
    mockFetch([OFFER]);
    const el = await renderWidget();
    expect(el.innerHTML).not.toMatch(/<h1[\s>]/i);
    expect(el.innerHTML).not.toMatch(/<h2[\s>]/i);
    expect(el.querySelectorAll("h1, h2").length).toBe(0);
  });

  it("offer title renders as h3", async () => {
    mockFetch([OFFER]);
    const el = await renderWidget();
    const heading = el.querySelector("h3.bk-offer-title");
    expect(heading).toBeTruthy();
  });

  it("progress bar uses role=heading aria-level=3 (no heading tags at all)", async () => {
    mockFetch([OFFER]);
    const el = await renderWidget({ "block-type": "progress-bar" });
    expect(el.querySelectorAll("h1, h2").length).toBe(0);
    const label = el.querySelector('[role="heading"]');
    expect(label?.getAttribute("aria-level")).toBe("3");
  });
});

describe("XSS safety", () => {
  it("escapes HTML in offer titles", async () => {
    mockFetch([{ ...OFFER, title: '<img src=x onerror=alert(1)>' }]);
    const el = await renderWidget();
    expect(el.querySelector("img")).toBeNull();
    expect(el.innerHTML).toContain("&lt;img");
  });
});

describe("rendering", () => {
  it("renders one button per tier with prices", async () => {
    mockFetch([OFFER]);
    const el = await renderWidget();
    const tiers = el.querySelectorAll(".bk-tier");
    expect(tiers.length).toBe(2);
    expect(tiers[0].textContent).toContain("Buy 2+");
    expect(tiers[1].textContent).toContain("Save 20%");
  });

  it("hides itself when there are no offers", async () => {
    mockFetch([]);
    const el = await renderWidget();
    expect((el as HTMLElement).hidden).toBe(true);
  });

  it("hides itself when the fetch fails (fail closed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const el = await renderWidget();
    expect((el as HTMLElement).hidden).toBe(true);
  });

  it("exposes a region landmark and list semantics", async () => {
    mockFetch([OFFER]);
    const el = await renderWidget();
    expect(el.querySelector('[role="region"]')).toBeTruthy();
    expect(el.querySelector('[role="list"]')).toBeTruthy();
    expect(el.querySelectorAll('[role="listitem"]').length).toBe(2);
  });
});
