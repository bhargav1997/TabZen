// TabZen Background Script (Service Worker)
'use strict';

// Service worker setup
self.addEventListener('install', (event) => {
    console.log('Service worker installed');
});

self.addEventListener('activate', (event) => {
    console.log('Service worker activated');
    event.waitUntil(
        Promise.all([
            chrome.storage.local.get(['tabzen_sessions', 'settings']),
            setupAlarms()
        ])
    );
});

// Installation and setup
chrome.runtime.onInstalled.addListener(async (details) => {
   console.log("TabZen extension installed/updated:", details.reason);

   try {
      // Initialize storage if needed
      const storage = await chrome.storage.local.get(["tabzen_sessions", "settings"]);
      const updates = {};

      if (!storage.tabzen_sessions) {
         updates.tabzen_sessions = [];
      }

      if (!storage.settings) {
         updates.settings = {
            badgeThreshold: 5,
            autoCleanup: false,
            cleanupDays: 30,
         };
      }

      if (Object.keys(updates).length > 0) {
         await chrome.storage.local.set(updates);
      }

      // Set up initial badge
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setBadgeBackgroundColor({ color: "#3B82F6" });

      // Initial badge count update
      await updateBadgeCount();
   } catch (error) {
      console.error("Error during initialization:", error);
   }
});

// Handle extension icon click (optional - popup handles most interactions)
chrome.action.onClicked.addListener((tab) => {
   // This would run if no popup.html is defined
   // Currently handled by popup.html
   console.log("Extension icon clicked");
});

// Listen for tab updates to potentially update badge count
chrome.tabs.onCreated.addListener(() => {
   updateBadgeCount();
});

chrome.tabs.onRemoved.addListener(() => {
   updateBadgeCount();
});

chrome.tabs.onUpdated.addListener(() => {
   updateBadgeCount();
});

// Update badge with current tab count
async function updateBadgeCount() {
   try {
      // Get settings for badge threshold
      const { settings = { badgeThreshold: 5 } } = await chrome.storage.local.get(["settings"]);

      // Get all tabs in current window
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const count = tabs.length;

      // Show badge only if more than threshold
      if (count > settings.badgeThreshold) {
         await chrome.action.setBadgeText({ text: count.toString() });
         // Use different colors based on tab count
         const color = count > 10 ? "#EF4444" : "#3B82F6";
         await chrome.action.setBadgeBackgroundColor({ color });
      } else {
         await chrome.action.setBadgeText({ text: "" });
      }
   } catch (error) {
      console.error("Error updating badge count:", error);
      // Reset badge in case of error
      await chrome.action.setBadgeText({ text: "" });
   }
}

// Initialize the service worker
const initializeServiceWorker = async () => {
   try {
      // Initialize storage and settings
      const storage = await chrome.storage.local.get(["tabzen_sessions", "settings"]);
      if (!storage.settings) {
         await chrome.storage.local.set({
            settings: {
               badgeThreshold: 5,
               autoCleanup: false,
               cleanupDays: 30
            }
         });
      }
      
      // Set up alarms for cleanup
      await setupAlarms();
      
      console.log("Service worker initialized successfully");
   } catch (error) {
      console.error("Service worker initialization error:", error);
   }
};

// Call initialize function
initializeServiceWorker();

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
   console.log("Background script received message:", request);

   switch (request.action) {
      case "getTabs":
         // Get current tabs
         (async () => {
            try {
               const tabs = await chrome.tabs.query({ currentWindow: true });
               const simplifiedTabs = tabs.map((tab) => ({
                  id: tab.id,
                  title: tab.title || "",
                  url: tab.url || "",
                  favIconUrl: tab.favIconUrl || "",
               }));
               sendResponse({ tabs: simplifiedTabs, success: true });
            } catch (error) {
               console.error("Error getting tabs:", error);
               sendResponse({ error: "Failed to get tabs", success: false });
            }
         })();
         return true; // Keep message channel open for async response

      case "saveTabs":
         // Handle tab saving logic
         (async () => {
            try {
               // Get current tabs
               const tabs = await chrome.tabs.query({ currentWindow: true });

               // Filter out empty or invalid tabs
               const validTabs = tabs.filter((tab) => tab.url && !tab.url.startsWith("chrome://"));

               if (validTabs.length === 0) {
                  throw new Error("No valid tabs to save");
               }

               const session = {
                  id: Date.now().toString(),
                  name: `Session ${new Date().toLocaleString()}`,
                  tabs: validTabs.map((tab) => ({
                     id: tab.id,
                     title: tab.title || "Untitled",
                     url: tab.url,
                     favIconUrl: tab.favIconUrl || "",
                  })),
                  createdAt: new Date().toISOString(),
                  tabCount: validTabs.length,
               };

               // Get existing sessions
               const result = await chrome.storage.local.get(["tabzen_sessions"]);
               const sessions = result.tabzen_sessions || [];

               // Add new session at the beginning
               sessions.unshift(session);

               // Save updated sessions
               await chrome.storage.local.set({ tabzen_sessions: sessions });

               // Update badge
               await updateBadgeCount();

               sendResponse({ success: true, sessionId: session.id });
            } catch (error) {
               console.error("Error saving tabs:", error);
               sendResponse({ error: error.message || "Failed to save tabs", success: false });
            }
         })();
         return true;

      case "restoreTabs":
         // Handle tab restoration
         (async () => {
            try {
               const sessionId = request.sessionId;
               if (!sessionId) {
                  throw new Error("Session ID is required");
               }

               const result = await chrome.storage.local.get(["tabzen_sessions"]);
               const session = result.tabzen_sessions?.find((s) => s.id === sessionId);

               if (!session || !session.tabs || session.tabs.length === 0) {
                  throw new Error("Session not found or empty");
               }

               // Create new window for restored tabs
               const window = await chrome.windows.create({ focused: true });

               // Restore tabs in the new window
               for (const tab of session.tabs) {
                  if (tab.url && !tab.url.startsWith("chrome://")) {
                     try {
                        await chrome.tabs.create({
                           windowId: window.id,
                           url: tab.url,
                           active: false,
                        });
                     } catch (tabError) {
                        console.error(`Failed to restore tab ${tab.url}:`, tabError);
                     }
                  }
               }

               // Close the initial empty tab in the new window
               const tabs = await chrome.tabs.query({ windowId: window.id });
               if (tabs.length > 1) {
                  // Only close if we successfully restored some tabs
                  await chrome.tabs.remove(tabs[0].id);
               }

               // Update badge count
               await updateBadgeCount();

               sendResponse({ success: true });
            } catch (error) {
               console.error("Error restoring tabs:", error);
               sendResponse({ error: error.message || "Failed to restore tabs", success: false });
            }
         })();
         return true;

      default:
         console.log("Unknown action:", request.action);
         sendResponse({ error: "Unknown action" });
   }
});

// Storage change listener (for future sync features)
chrome.storage.onChanged.addListener((changes, namespace) => {
   if (namespace === "local" && changes.tabzen_sessions) {
      console.log("TabZen sessions updated");
      // Could trigger sync to cloud storage here in future
   }
});

// Context menu creation (future feature)
// chrome.contextMenus.create({
//     id: "saveCurrentTab",
//     title: "Save current tab to TabZen",
//     contexts: ["page"]
// });

// chrome.contextMenus.onClicked.addListener((info, tab) => {
//     if (info.menuItemId === "saveCurrentTab") {
//         // Save single tab logic
//     }
// });

// Setup and handle alarms for session cleanup
async function setupAlarms() {
    try {
        // Create alarm for daily cleanup check
        await chrome.alarms.create('cleanupOldSessions', {
            periodInMinutes: 1440 // 24 hours
        });
        console.log('Cleanup alarm created successfully');
    } catch (error) {
        console.error('Error setting up alarms:', error);
    }
}

// Alarm listener for cleanup
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cleanupOldSessions') {
        try {
            const { settings, tabzen_sessions } = await chrome.storage.local.get(['settings', 'tabzen_sessions']);
            if (!settings?.autoCleanup || !tabzen_sessions) return;

            const cleanupDays = settings.cleanupDays || 30;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - cleanupDays);

            const filteredSessions = tabzen_sessions.filter(session => 
                new Date(session.createdAt) > cutoffDate
            );

            if (filteredSessions.length !== tabzen_sessions.length) {
                await chrome.storage.local.set({ tabzen_sessions: filteredSessions });
                console.log(`Cleaned up old sessions older than ${cleanupDays} days`);
            }
        } catch (error) {
            console.error('Error during session cleanup:', error);
        }
    }
});


// Set up periodic cleanup (future feature)
// chrome.alarms.create('cleanupOldSessions', {
//     delayInMinutes: 1440, // 24 hours
//     periodInMinutes: 1440
// });

// Future features (commented placeholders):
// TODO: Cloud sync functionality
// TODO: Backup and restore from external sources
// TODO: Cross-device session sharing
// TODO: Automatic session cleanup
// TODO: Tab grouping and smart organization
// TODO: Integration with external bookmark services

console.log("TabZen background script loaded successfully");
