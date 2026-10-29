// Classic service worker of the test fixture. onInstalled writes the default of "viewMode" late,
// as an extension that overwrites a seed would; the launch's stop-before-seed order must beat it.
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => {
    chrome.storage.local.set({ viewMode: 'fullpage' })
  }, 700)
})

chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  chrome.storage.local.set({ lastCreated: bookmark.title })
})
