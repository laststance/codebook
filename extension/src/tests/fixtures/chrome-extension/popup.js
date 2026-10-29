document.getElementById('go').addEventListener('click', () => {
  chrome.bookmarks.create({ title: document.getElementById('answer').value })
})
