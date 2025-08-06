// TabZen Popup Script
class TabZen {
   constructor() {
      this.sessions = [];
   }

   static async initialize() {
      const app = new TabZen();
      await app.init();
      return app;
   }

   async init() {
      try {
         // Load sessions first
         await this.loadSessions();

         // Wait for DOM to be fully loaded
         if (document.readyState === "loading") {
            await new Promise((resolve) => {
               document.addEventListener("DOMContentLoaded", resolve);
            });
         }

         // Now bind events and update UI
         await this.bindEvents();
         this.updateUI();
         await this.updateCurrentTabCount();
      } catch (error) {
         console.error("Error initializing TabZen:", error);
         throw error; // Re-throw to be caught by the initializer
      }
   }

   async loadSessions() {
      try {
         const result = await chrome.storage.local.get(["tabzen_sessions"]);
         this.sessions = result.tabzen_sessions || [];
      } catch (error) {
         console.error("Error loading sessions:", error);
         this.sessions = [];
      }
   }

   async saveSessions() {
      try {
         await chrome.storage.local.set({ tabzen_sessions: this.sessions });
      } catch (error) {
         console.error("Error saving sessions:", error);
         throw error;
      }
   }

   async bindEvents() {
      try {
         // Static elements
         const elements = {
            saveAllTabs: document.getElementById("saveAllTabs"),
            restoreAllTabs: document.getElementById("restoreAllTabs"),
            searchTabs: document.getElementById("searchTabs"),
         };

         // Check if required elements exist
         if (!elements.saveAllTabs) {
            throw new Error("Required elements not found in the DOM");
         }

         // Bind static element events
         elements.saveAllTabs.addEventListener("click", () => this.saveAllTabs());

         if (elements.restoreAllTabs) {
            elements.restoreAllTabs.addEventListener("click", () => this.restoreAllTabs());
         }

         if (elements.searchTabs) {
            elements.searchTabs.addEventListener("input", (e) => this.searchTabs(e.target.value));
         }

         // Event delegation for dynamic elements
         document.addEventListener("click", async (e) => {
            const target = e.target.closest("[data-action]");
            if (!target) return;

            const action = target.dataset.action;
            const sessionId = target.dataset.sessionId;
            const tabIndex = target.dataset.tabIndex;

            switch (action) {
               case "restore-session":
                  await this.restoreSession(sessionId);
                  break;
               case "delete-session":
                  await this.deleteSession(sessionId);
                  break;
               case "restore-tab":
                  await this.restoreTab(sessionId, parseInt(tabIndex));
                  break;
               case "delete-tab":
                  await this.deleteTab(sessionId, parseInt(tabIndex));
                  break;
            }
         });
      } catch (error) {
         console.error("Error binding events:", error);
         throw error;
      }
   }

   async updateCurrentTabCount() {
      try {
         const tabs = await chrome.tabs.query({ currentWindow: true });
         const tabCount = document.getElementById("tabCount");
         tabCount.textContent = `${tabs.length} tab${tabs.length !== 1 ? "s" : ""}`;
      } catch (error) {
         console.error("Error getting current tabs:", error);
      }
   }

   async saveAllTabs() {
      try {
         const tabs = await chrome.tabs.query({ currentWindow: true });
         if (tabs.length === 0) return;

         const session = {
            id: Date.now().toString(),
            name: this.generateSessionName(),
            tabs: tabs.map((tab) => ({
               id: tab.id,
               title: tab.title,
               url: tab.url,
               favIconUrl: tab.favIconUrl,
            })),
            createdAt: new Date().toISOString(),
            tabCount: tabs.length,
         };

         this.sessions.unshift(session);
         await this.saveSessions();

         const tabsToClose = tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
         if (tabsToClose.length > 0) {
            await chrome.tabs.remove(tabsToClose);
         }

         this.updateUI();
         this.showNotification(`Saved ${session.tabCount} tabs!`);
      } catch (error) {
         console.error("Error saving tabs:", error);
         this.showNotification("Error saving tabs", "error");
      }
   }

   async restoreSession(sessionId) {
      try {
         const session = this.sessions.find((s) => s.id === sessionId);
         if (!session) return;

         for (const tab of session.tabs) {
            await chrome.tabs.create({ url: tab.url, active: false });
         }

         this.showNotification(`Restored ${session.tabs.length} tabs!`);
      } catch (error) {
         console.error("Error restoring session:", error);
         this.showNotification("Error restoring tabs", "error");
      }
   }

   async restoreTab(sessionId, tabIndex) {
      try {
         const session = this.sessions.find((s) => s.id === sessionId);
         if (!session || !session.tabs[tabIndex]) return;

         const tab = session.tabs[tabIndex];
         await chrome.tabs.create({ url: tab.url, active: true });
         session.tabs.splice(tabIndex, 1);

         if (session.tabs.length === 0) {
            this.sessions = this.sessions.filter((s) => s.id !== sessionId);
         }

         await this.saveSessions();
         this.updateUI();
      } catch (error) {
         console.error("Error restoring tab:", error);
         this.showNotification("Error restoring tab", "error");
      }
   }

   async deleteSession(sessionId) {
      try {
         this.sessions = this.sessions.filter((s) => s.id !== sessionId);
         await this.saveSessions();
         this.updateUI();
         this.showNotification("Session deleted");
      } catch (error) {
         console.error("Error deleting session:", error);
      }
   }

   async deleteTab(sessionId, tabIndex) {
      try {
         const session = this.sessions.find((s) => s.id === sessionId);
         if (!session || !session.tabs[tabIndex]) return;

         session.tabs.splice(tabIndex, 1);
         if (session.tabs.length === 0) {
            this.sessions = this.sessions.filter((s) => s.id !== sessionId);
         }

         await this.saveSessions();
         this.updateUI();
      } catch (error) {
         console.error("Error deleting tab:", error);
      }
   }

   updateUI() {
      const emptyState = document.getElementById("emptyState");
      const sessionsList = document.getElementById("sessionsList");
      const restoreAllBtn = document.getElementById("restoreAllTabs");

      if (this.sessions.length === 0) {
         emptyState.style.display = "flex";
         sessionsList.style.display = "none";
         restoreAllBtn.style.display = "none";
      } else {
         emptyState.style.display = "none";
         sessionsList.style.display = "block";
         restoreAllBtn.style.display = "inline-flex";
         this.renderSessions();
      }

      this.updateStats();
   }

   // Render sessions list
   renderSessions() {
      const sessionsList = document.getElementById("sessionsList");

      sessionsList.innerHTML = this.sessions
         .map(
            (session) => `
                <div class="session-card" data-session-id="${session.id}">
                    <div class="session-header">
                        <div class="session-info">
                            <h4 class="session-name">${this.escapeHtml(session.name)}</h4>
                            <div class="session-meta">
                                <span>${session.tabs.length} tab${session.tabs.length !== 1 ? "s" : ""}</span>
                                <span class="separator">•</span>
                                <span>${this.formatDate(session.createdAt)}</span>
                            </div>
                        </div>
                        <div class="session-actions">
                            <button class="btn-icon" data-action="restore-session" data-session-id="${session.id}" title="Restore all tabs">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="23,4 23,10 17,10"></polyline>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                </svg>
                            </button>
                            <button class="btn-icon btn-danger" data-action="delete-session" data-session-id="${
                               session.id
                            }" title="Delete session">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="m3 6 18 0"></path>
                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
               <div class="tabs-list ${session.tabs.length > 3 ? "collapsed" : ""}" id="tabs-${session.id}">
        <div class="tabs-preview">
          ${session.tabs
             .slice(0, 3)
             .map(
                (tab, index) => `
                            <div class="tab-item">
                                <div class="tab-favicon">
                                    <img src="${
                                       tab.favIconUrl ||
                                       'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>'
                                    }" 
                                         alt="" width="16" height="16" onerror="this.style.display='none'">
                                </div>
                                <div class="tab-content">
                                    <div class="tab-title">${this.escapeHtml(tab.title)}</div>
                                    <div class="tab-url">${this.escapeHtml(tab.url)}</div>
                                </div>
                                <div class="tab-actions">
                                        <button class="btn-icon-small" data-action="restore-tab" data-session-id="${
                                           session.id
                                        }" data-tab-index="${index}" title="Restore tab">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M21 9V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h7"></path>
                                            <path d="m16 16 5 5-5 5"></path>
                                        </svg>
                                    </button>
                                    <button class="btn-icon-small btn-danger" data-action="delete-tab" data-session-id="${
                                       session.id
                                    }" data-tab-index="${index}" title="Delete tab">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        `,
             )
             .join("")}
                    ${
                       session.tabs.length > 5
                          ? `
                            <div class="tab-item more-tabs">
                                <div class="more-tabs-text">+ ${session.tabs.length - 5} more tabs</div>
                            </div>
                        `
                          : ""
                    }
                </div>
            </div>
        `,
         )
         .join("");
   }

   updateStats() {
      const sessionsCount = document.getElementById("sessionsCount");
      const totalTabsCount = document.getElementById("totalTabsCount");

      const totalTabs = this.sessions.reduce((sum, session) => sum + session.tabs.length, 0);
      sessionsCount.textContent = `${this.sessions.length} session${this.sessions.length !== 1 ? "s" : ""}`;
      totalTabsCount.textContent = `${totalTabs} total tab${totalTabs !== 1 ? "s" : ""}`;
   }

   escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
   }

   formatDate(dateString) {
      const date = new Date(dateString);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const minutes = Math.floor(diff / (1000 * 60));
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      return `${days}d ago`;
   }

   showNotification(message, type = "success") {
      const notification = document.createElement("div");
      notification.className = `notification notification-${type}`;
      notification.textContent = message;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 3000);
   }

   generateSessionName() {
      const now = new Date();
      return `Session ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
   }

   // Search tabs by keyword
   searchTabs(keyword) {
      const lower = keyword.toLowerCase();
      const filtered = this.sessions.map((session) => {
         return {
            ...session,
            tabs: session.tabs.filter((tab) => tab.title.toLowerCase().includes(lower) || tab.url.toLowerCase().includes(lower)),
         };
      });
      this.renderSessions(filtered);
   }

   // Export sessions to JSON file
   exportSessions() {
      const blob = new Blob([JSON.stringify(this.sessions, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tabzen_sessions.json";
      link.click();
   }

   // Import sessions from JSON file
   async importSessions(file) {
      try {
         const text = await file.text();
         const imported = JSON.parse(text);
         if (!Array.isArray(imported)) throw new Error("Invalid format");
         this.sessions = [...imported, ...this.sessions];
         await this.saveSessions();
         this.updateUI();
         this.showNotification("Sessions imported!");
      } catch (err) {
         console.error("Import error:", err);
         this.showNotification("Failed to import", "error");
      }
   }

   // Restore all saved tabs
   async restoreAllTabs() {
      try {
         for (const session of this.sessions) {
            for (const tab of session.tabs) {
               await chrome.tabs.create({ url: tab.url, active: false });
            }
         }
         this.showNotification(`Restored all tabs from all sessions!`);
      } catch (error) {
         console.error("Error restoring all tabs:", error);
         this.showNotification("Error restoring all tabs", "error");
      }
   }
}

// Initialize TabZen when the popup loads
document.addEventListener("DOMContentLoaded", async () => {
   try {
      await TabZen.initialize();
   } catch (error) {
      console.error("Failed to initialize TabZen:", error);
      // Show error in the popup
      const errorDiv = document.createElement("div");
      errorDiv.className = "error-message";
      errorDiv.textContent = "Failed to initialize TabZen. Please try reloading.";
      document.body.prepend(errorDiv);
   }
});
