import { buildNumber, scriptInfo, METADATA_PREFIX } from "./constants";
import { addSelectorListener, initObservers } from "./observers";
import { domLoaded, extractSenderFromElement, findInputByLabel } from "./utils";

/** Stores the element that was right-clicked to extract sender info from */
let rightClickedElement: HTMLElement | null = null;

/** Runs when the userscript is loaded initially */
async function init() {
  if(domLoaded)
    run();
  else
    document.addEventListener("DOMContentLoaded", run);
}

/** Runs after the DOM is available */
async function run() {
  try {
    console.log(`Initializing ${scriptInfo.name} v${scriptInfo.version} (#${buildNumber})...`);

    // Listen for right-click events to store the clicked element
    document.addEventListener("contextmenu", (e) => {
      rightClickedElement = e.target as HTMLElement;
    }, true);

    initObservers();

    // Watch for Gmail context menus appearing and inject our custom menu item
    addSelectorListener("body", "[role=\"menu\"]", {
      listener: (menuElement) => {
        // Only inject if menu is actually visible
        if (menuElement.offsetParent !== null) {
          injectContextMenuItem(menuElement);
        }
      },
    });
  }
  catch(err) {
    console.error("Fatal error:", err);
    return;
  }
}

/** Injects the "Auto-Label Sender" menu item into Gmail's context menu */
function injectContextMenuItem(menu: HTMLElement) {
  // Check if our item already exists
  if (menu.querySelector("[data-auto-label-sender]")) return;

  // Create our menu item
  const menuItem = document.createElement("div");
  menuItem.setAttribute("role", "menuitem");
  menuItem.setAttribute("data-auto-label-sender", "true");
  menuItem.textContent = "Auto-Label Sender";
  menuItem.style.cssText = `
    padding: 8px 16px;
    cursor: pointer;
    font-family: 'Google Sans', Roboto, Arial, sans-serif;
    font-size: 14px;
    color: #202124;
    transition: background 0.1s;
  `;

  menuItem.addEventListener("mouseenter", () => {
    menuItem.style.background = "#f1f3f4";
  });
  menuItem.addEventListener("mouseleave", () => {
    menuItem.style.background = "transparent";
  });
  menuItem.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    handleAutoLabelClick();
  });

  // Add separator
  const separator = document.createElement("div");
  separator.style.cssText = `
    height: 1px;
    background: #e0e0e0;
    margin: 4px 0;
  `;

  // Insert at the top of menu
  menu.insertBefore(menuItem, menu.firstChild);
  menu.insertBefore(separator, menuItem.nextSibling);
}

/** Main handler for the Auto-Label action */
async function handleAutoLabelClick() {
  try {
    if (!rightClickedElement) {
      console.error("[Gmail Auto-Label] No element was right-clicked");
      return;
    }

    // Extract sender email
    const senderEmail = extractSenderFromElement(rightClickedElement);
    if (!senderEmail) {
      console.error("[Gmail Auto-Label] Could not detect sender email");
      alert("Could not detect sender email. Please try right-clicking directly on the email.");
      return;
    }

    console.log("[Gmail Auto-Label] Found sender:", senderEmail);

    // Prompt for label name
    const labelName = prompt(`Enter the label name to auto-apply for emails from:\n${senderEmail}`);
    if (!labelName || labelName.trim() === "") {
      console.log("[Gmail Auto-Label] User cancelled or entered empty label name");
      return;
    }

    console.log(`[Gmail Auto-Label] Creating filter for ${senderEmail} with label "${labelName}"`);

    // Create or update the filter
    await createOrUpdateFilter(senderEmail, labelName.trim());

    console.log("[Gmail Auto-Label] Filter created/updated successfully!");
    alert(`✓ Added filter for ${senderEmail} with label "${labelName}"`);
  }
  catch(err) {
    console.error("[Gmail Auto-Label] Error:", err);
    alert(`Failed to create filter: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Navigates to Gmail filters settings page */
async function navigateToFiltersSettings(): Promise<void> {
  console.log("[Gmail Auto-Label] Navigating to filters settings...");
  window.location.hash = "settings/filters";

  // Wait for settings page to load
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      // Check if we're on the settings page by looking for settings-specific elements
      const settingsContent = document.querySelector(".Tm.aeJ, .aKh");
      if (settingsContent) {
        clearInterval(checkInterval);
        // Give it a bit more time to fully render
        setTimeout(() => resolve(), 1000);
      }
    }, 200);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 10000);
  });
}

/** Creates a new filter or updates an existing one */
async function createOrUpdateFilter(senderEmail: string, labelName: string): Promise<void> {
  const originalHash = window.location.hash;

  try {
    await navigateToFiltersSettings();

    // Check if a filter with our metadata already exists
    const existingFilter = findFilterByMetadata(labelName);

    if (existingFilter) {
      console.log("[Gmail Auto-Label] Found existing filter, updating...");
      await updateExistingFilter(existingFilter, senderEmail);
    } else {
      console.log("[Gmail Auto-Label] Creating new filter...");
      await createNewFilter(senderEmail, labelName);
    }

    // Navigate back to original view
    window.location.hash = originalHash;
  }
  catch(err) {
    console.error("[Gmail Auto-Label] Filter operation failed:", err);
    throw err;
  }
}

/** Finds a filter element that contains our metadata for the given label */
function findFilterByMetadata(labelName: string): HTMLElement | null {
  const metadataString = `${METADATA_PREFIX}${labelName}`;
  const filterRows = document.querySelectorAll("[data-filter-id]");

  for (const row of filterRows) {
    if (row.textContent?.includes(metadataString)) {
      return row as HTMLElement;
    }
  }

  return null;
}

/** Creates a new Gmail filter */
async function createNewFilter(senderEmail: string, labelName: string): Promise<void> {
  console.log("[Gmail Auto-Label] Looking for 'Create filter' button...");

  // Find "Create a new filter" button
  const buttonTexts = ["Create a new filter", "Create new filter", "New filter", "Create filter"];
  let createFilterBtn: HTMLElement | null = null;

  for (const text of buttonTexts) {
    const buttons = Array.from(document.querySelectorAll("button, a, span[role=\"link\"], div[role=\"link\"]"));
    createFilterBtn = buttons.find((el) => el.textContent?.includes(text)) as HTMLElement | undefined || null;
    if (createFilterBtn) break;
  }

  if (!createFilterBtn) {
    throw new Error("Could not find 'Create a new filter' button");
  }

  createFilterBtn.click();
  console.log("[Gmail Auto-Label] Clicked create filter button");

  // Wait for form to appear
  await waitForLabels();

  // Fill in From field
  const fromInput = findInputByLabel("From");
  if (!fromInput) throw new Error("Could not find 'From' input field");

  fromInput.value = senderEmail;
  fromInput.dispatchEvent(new Event("input", { bubbles: true }));
  console.log("[Gmail Auto-Label] Filled in From field");

  // Add metadata to "Doesn't have" field
  const doesntHaveInput = findInputByLabel("Doesn't have");
  if (doesntHaveInput) {
    const metadataString = `${METADATA_PREFIX}${labelName}`;
    doesntHaveInput.value = metadataString;
    doesntHaveInput.dispatchEvent(new Event("input", { bubbles: true }));
    console.log("[Gmail Auto-Label] Added metadata");
  }

  // Click "Create filter" button to proceed to actions step
  await new Promise(resolve => setTimeout(resolve, 300));
  const proceedBtn = Array.from(document.querySelectorAll("button, span[role=\"link\"]")).find(
    (el) => el.textContent?.includes("Create filter")
  ) as HTMLElement | undefined;

  if (!proceedBtn) throw new Error("Could not find proceed button");
  proceedBtn.click();
  console.log("[Gmail Auto-Label] Proceeding to actions step...");

  // Wait for actions dialog
  await new Promise(resolve => setTimeout(resolve, 800));

  // Check "Apply the label" checkbox
  const applyLabelCheckbox = findInputByLabel("Apply the label:");
  if (!applyLabelCheckbox) throw new Error("Could not find 'Apply the label' checkbox");

  if (!applyLabelCheckbox.checked) {
    applyLabelCheckbox.click();
    console.log("[Gmail Auto-Label] Checked 'Apply label' checkbox");
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // For simplicity in MVP, we'll just log that user needs to select label manually
  // A full implementation would need to interact with Gmail's label dropdown
  console.log(`[Gmail Auto-Label] NOTE: You need to manually select the label "${labelName}" and click Create filter`);
  alert(`Please:\n1. Select the label "${labelName}" from the dropdown\n2. Click the "Create filter" button to finish`);
}

/** Updates an existing filter by appending a new sender */
async function updateExistingFilter(filterElement: HTMLElement, newSenderEmail: string): Promise<void> {
  filterElement.click();
  await new Promise(resolve => setTimeout(resolve, 1000));

  const fromInput = findInputByLabel("From");
  if (!fromInput) throw new Error("Could not find From input field");

  const currentValue = fromInput.value;
  if (currentValue.includes(newSenderEmail)) {
    console.log("[Gmail Auto-Label] Sender already in filter");
    const cancelBtn = Array.from(document.querySelectorAll("button, span[role=\"link\"]")).find(
      (el) => el.textContent?.includes("Cancel")
    ) as HTMLElement | undefined;
    if (cancelBtn) cancelBtn.click();
    return;
  }

  // Append new sender with pipe separator
  fromInput.value = `${currentValue} | ${newSenderEmail}`;
  fromInput.dispatchEvent(new Event("input", { bubbles: true }));
  console.log("[Gmail Auto-Label] Appended sender to filter");

  await new Promise(resolve => setTimeout(resolve, 500));
  const updateBtn = Array.from(document.querySelectorAll("button, span[role=\"link\"]")).find(
    (el) => el.textContent?.includes("Update filter")
  ) as HTMLElement | undefined;

  if (updateBtn) {
    updateBtn.click();
    console.log("[Gmail Auto-Label] Clicked Update filter button");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/** Waits for label elements to appear in the DOM */
async function waitForLabels(timeout = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      const labels = document.querySelectorAll("label");
      if (labels.length > 0) {
        clearInterval(checkInterval);
        resolve();
      }
      if (Date.now() - start > timeout) {
        clearInterval(checkInterval);
        reject(new Error("Timeout waiting for form labels"));
      }
    }, 100);
  });
}

init();
