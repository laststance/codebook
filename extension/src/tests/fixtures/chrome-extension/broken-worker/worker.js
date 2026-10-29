// A syntax error on purpose: Chrome installs the extension and fails to start its worker.
chrome.runtime.onInstalled.addListener(() => {
