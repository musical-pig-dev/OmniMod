import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "./studio";
import { UnlockKeys } from "./vault-lock";
import { resetBugLookup } from "@/lib/omnimod/bugs";
import { createMod } from "@/lib/omnimod/mods";
import { MODS_KEY } from "@/lib/omnimod/storage";
import { VAULT_KEY } from "@/lib/omnimod/vault";

beforeEach(() => {
  resetBugLookup();
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ total_count: 0, items: [] }) }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  resetBugLookup();
});

describe("key protection", () => {
  it("encrypts every mod and host key behind one recovery key", async () => {
    const user = userEvent.setup();
    const mod = createMod("Lanterns");
    mod.configs.nexus.fields = { apiKey: "super-secret-token", modId: "9" };
    localStorage.setItem(MODS_KEY, JSON.stringify([mod]));
    render(<Studio />);
    expect(await screen.findByDisplayValue("Lanterns")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Encrypt Keys" }));
    expect(screen.getByRole("button", { name: "Protect" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Encrypt keys" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Encrypt Keys" }));
    const clip = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Copied" }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clip });
    const secret = document.querySelector("p.font-mono")?.textContent ?? "";
    expect(copied).toBe(secret);
    expect(secret.length).toBeGreaterThan(40);
    await user.click(screen.getByRole("checkbox", { name: "I saved this recovery key" }));
    await user.click(screen.getByRole("button", { name: "Protect" }));
    await screen.findByLabelText("Keys encrypted");
    expect(screen.queryByRole("button", { name: "Remove protection" })).toBeNull();
    await waitFor(() => expect(localStorage.getItem(VAULT_KEY)).toBeTruthy());
    const sealed = localStorage.getItem(VAULT_KEY) ?? "";
    expect(sealed.includes("super-secret-token")).toBe(false);
    expect(localStorage.getItem(MODS_KEY)).toBeNull();
    cleanup();
    render(<Studio />);
    expect(await screen.findByRole("heading", { name: "Keys are locked" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText("Key"), "wrong-key");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("That recovery key does not open this vault.")).toBeTruthy();
    await user.clear(screen.getByLabelText("Key"));
    await user.type(screen.getByLabelText("Key"), secret);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByDisplayValue("Lanterns")).toBeTruthy();
    expect(screen.getByLabelText("Keys encrypted").tagName).toBe("SPAN");
    expect(localStorage.getItem(VAULT_KEY)).toBeTruthy();
    expect(localStorage.getItem(MODS_KEY)).toBeNull();
  });

  it("reads a pasted key", async () => {
    const seen: string[] = [];
    render(
      <UnlockKeys
        onUnlock={async (value) => {
          seen.push(value);
          return value === "right-key";
        }}
      />,
    );
    const field = screen.getByLabelText("Key");
    fireEvent.paste(field, { clipboardData: { getData: () => "right-key" } });
    fireEvent.change(field, { target: { value: "wrong-key" } });
    expect(seen).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("That recovery key does not open this vault.")).toBeTruthy();
    fireEvent.change(field, { target: { value: " right-key " } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(seen).toEqual(["wrong-key", "right-key"]));
  });
});
