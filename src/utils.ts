import { addGlobalStyle, openInNewTab, randomId, type LooseUnion } from "@sv443-network/userutils";
import type resources from "../assets/resources.json";

//#region resources

/** Key of a resource in `assets/resources.json` and extra keys defined by `tools/post-build.ts` */
export type ResourceKey = keyof typeof resources;

/**
 * Returns the URL of a resource by its name, as defined in `assets/resources.json`, from GM resource cache - [see GM.getResourceUrl docs](https://wiki.greasespot.net/GM.getResourceUrl)  
 * Falls back to a `raw.githubusercontent.com` URL or base64-encoded data URI if the resource is not available in the GM resource cache.  
 * ⚠️ Requires the directive `@grant GM.getResourceUrl`
 */
export async function getResourceUrl(name: LooseUnion<ResourceKey>) {
  let url = await GM.getResourceUrl(name);
  if(!url || url.length === 0) {
    console.warn(`Couldn't get blob URL nor external URL for @resource '${name}', trying to use base64-encoded fallback`);
    // @ts-ignore
    url = await GM.getResourceUrl(name, false);
  }
  return url;
}

//#region requests / urls

/**
 * Sends a request with the specified parameters and returns the response as a Promise.  
 * Ignores the CORS policy, contrary to fetch and fetchAdvanced.  
 * ⚠️ Requires the directive `@grant GM.xmlhttpRequest`
 */
export function sendRequest<T = any>(details: GM.Request<T>) {
  return new Promise<GM.Response<T>>((resolve, reject) => {
    GM.xmlHttpRequest({
      timeout: 10_000,
      ...details,
      onload: resolve,
      onerror: reject,
      ontimeout: reject,
      onabort: reject,
    });
  });
}

/**
 * Opens the given URL in a new tab, using GM.openInTab if available  
 * ⚠️ Requires the directive `@grant GM.openInTab`
 */
export function openInTab(href: string, background = true) {
  try {
    openInNewTab(href, background);
  }
  catch(err) {
    window.open(href, "_blank", "noopener noreferrer");
  }
}

//#region DOM utils

export let domLoaded = document.readyState === "complete" || document.readyState === "interactive";
document.addEventListener("DOMContentLoaded", () => domLoaded = true);

/**
 * Adds generic, accessible interaction listeners to the passed element.  
 * All listeners have the default behavior prevented and stop immediate propagation.
 * @param listenerOptions Provide a {@linkcode listenerOptions} object to configure the listeners
 */
export function onInteraction<TElem extends HTMLElement>(elem: TElem, listener: (evt: MouseEvent | KeyboardEvent) => void, listenerOptions?: AddEventListenerOptions) {
  const proxListener = (e: MouseEvent | KeyboardEvent) => {
    if(e instanceof KeyboardEvent && !(["Enter", " ", "Space", "Spacebar"].includes(e.key)))
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    listenerOptions?.once && e.type === "keydown" && elem.removeEventListener("click", proxListener, listenerOptions);
    listenerOptions?.once && e.type === "click" && elem.removeEventListener("keydown", proxListener, listenerOptions);
    listener(e);
  };
  elem.addEventListener("click", proxListener, listenerOptions);
  elem.addEventListener("keydown", proxListener, listenerOptions);
}

/** Removes all child nodes of an element without invoking the slow-ish HTML parser */
export function clearInner(element: Element) {
  while(element.hasChildNodes())
    clearNode(element!.firstChild as Element);
}

function clearNode(element: Element) {
  while(element.hasChildNodes())
    clearNode(element!.firstChild as Element);
  element.parentNode!.removeChild(element);
}

/**
 * Adds a style element to the DOM at runtime.
 * @param css The CSS stylesheet to add
 * @param ref A reference string to identify the style element - defaults to a random 5-character string
 */
export function addStyle(css: string, ref?: string) {
  if(!domLoaded)
    throw new Error("DOM has not finished loading yet");
  const elem = addGlobalStyle(css);
  elem.id = `global-style-${ref ?? randomId(5, 36)}`;
  return elem;
}

//#region Gmail-specific utilities

/**
 * Validates an email address using a basic regex pattern
 */
export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Extracts email address from formats like "Name <email@example.com>" or just "email@example.com"
 */
export function extractEmailAddress(emailString: string): string {
  // Handle "Name <email@example.com>" format
  const match = emailString.match(/<([^>]+)>/);
  if (match) return match[1];

  // Handle plain email format
  const emailMatch = emailString.match(/[\w.-]+@[\w.-]+\.\w+/);
  return emailMatch ? emailMatch[0] : emailString.trim();
}

/**
 * Finds an input element by its associated label text in Gmail's settings UI
 * Gmail uses <label for="id">Text</label> to associate labels with inputs
 */
export function findInputByLabel(labelText: string): HTMLInputElement | null {
  const labels = Array.from(document.querySelectorAll("label"));

  // Try exact match first
  let label = labels.find((l) => l.textContent?.trim() === labelText);

  // If not found, try case-insensitive contains match
  if (!label) {
    label = labels.find((l) => l.textContent?.toLowerCase().includes(labelText.toLowerCase()));
  }

  if (!label) {
    console.warn(`[Gmail Auto-Label] Could not find label with text: "${labelText}"`);
    return null;
  }

  const inputId = label.getAttribute("for");
  if (!inputId) {
    console.warn(`[Gmail Auto-Label] Label "${labelText}" has no 'for' attribute`);
    return null;
  }

  const input = document.getElementById(inputId) as HTMLInputElement;
  if (!input) {
    console.warn(`[Gmail Auto-Label] Could not find input with id: "${inputId}"`);
    return null;
  }

  return input;
}

/**
 * Extracts sender email from a clicked email element by walking up the DOM tree
 */
export function extractSenderFromElement(element: HTMLElement): string | null {
  // Walk up the DOM tree to find the email container
  let current: HTMLElement | null = element;
  for (let i = 0; i < 15 && current; i++) {
    // Method 1: Look for email attribute
    const emailEl = current.querySelector("[email]");
    if (emailEl) {
      const email = emailEl.getAttribute("email");
      if (email && validateEmail(email)) return email;
    }

    // Method 2: Look in data attributes
    if (current.hasAttribute("email")) {
      const email = current.getAttribute("email");
      if (email && validateEmail(email)) return email;
    }

    // Method 3: Parse from text content of sender field
    const senderEl = current.querySelector(".go, .gD, .g2");
    if (senderEl) {
      const text = senderEl.textContent || "";
      const extracted = extractEmailAddress(text);
      if (extracted && validateEmail(extracted)) return extracted;
    }

    current = current.parentElement;
  }

  return null;
}
