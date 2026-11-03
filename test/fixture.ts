export const fixture = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>X fixture</title>
<style>
body{font:15px -apple-system,sans-serif;margin:0}
article[data-testid="tweet"]{border-bottom:1px solid #ddd;padding:10px;width:560px}
[data-testid="tweetText"]{white-space:pre-wrap}
[data-testid="tweetTextarea_0"][contenteditable="true"]{border:1px solid #ccc;min-height:44px;padding:8px;width:480px}
[role="dialog"]{position:fixed;inset:0;background:#fff;z-index:10;padding:16px;display:flex;flex-direction:column}
#hidden-dialog{position:fixed;left:0;top:0;height:0;width:0;overflow:hidden;padding:0}
[data-testid="tweetButton"]{padding:6px 14px;margin-top:8px}
[data-testid="tweetButton"][aria-disabled="true"]{opacity:.5}
</style></head><body>
<nav><a data-testid="AppTabBar_Profile_Link" href="/fixture_user">Profile</a>
<button data-testid="SideNav_AccountSwitcher_Button"><span data-testid="UserAvatar-Container-fixture_user"></span></button></nav>

<main id="column">
<!-- The root status. Its id is read from the timestamp link; the handle is read
     from the user-name block, which is how the adapter identifies the author. -->
<article data-testid="tweet">
  <div data-testid="User-Name"><a role="link" href="/fixture_user"><span>Fixture User</span></a><a role="link" href="/fixture_user"><span>@fixture_user</span></a></div>
  <div data-testid="tweetText">a root tweet</div>
  <a href="/fixture_user/status/1001"><time datetime="2026-01-01T00:00:00.000Z">Jan 1</time></a>
  <button data-testid="reply" aria-label="3 Replies. Reply">reply</button>
</article>

<!-- A reply. The "Replying to" line is the page's statement of the target; the
     adapter reads it rather than inferring the relation from position. -->
<article data-testid="tweet">
  <div>Replying to <a role="link" href="/fixture_user">@fixture_user</a></div>
  <div data-testid="User-Name"><a role="link" href="/other_user"><span>Other User</span></a><a role="link" href="/other_user"><span>@other_user</span></a></div>
  <div data-testid="tweetText">a reply from someone else</div>
  <a href="/other_user/status/1002"><time datetime="2026-01-01T00:01:00.000Z">Jan 1</time></a>
  <button data-testid="reply" aria-label="0 Replies. Reply">reply</button>
</article>

<!-- A promoted post. Its article has no marker of its own: the wrapper is
     placementTracking and the label is a leaf "Ad". Both are how the reader
     tells it apart from an ordinary post that happens to mention ads. -->
<div data-testid="placementTracking"><article data-testid="tweet">
  <div data-testid="User-Name"><a role="link" href="/advertiser"><span>Advertiser</span></a></div>
  <div data-testid="tweetText">buy this now</div>
  <span>Ad</span>
  <a href="/advertiser/status/1004"><time datetime="2026-01-01T00:03:00.000Z">Jan 1</time></a>
</article></div>

<!-- An ordinary post whose body contains the word "Ad". The label test must not
     match it: only a short leaf element that says nothing else counts. -->
<article data-testid="tweet">
  <div data-testid="User-Name"><a role="link" href="/talker"><span>Talker</span></a></div>
  <div data-testid="tweetText">Ad blocking is the whole reason I use it</div>
  <a href="/talker/status/1005"><time datetime="2026-01-01T00:04:00.000Z">Jan 1</time></a>
  <button data-testid="reply" aria-label="0 Replies. Reply">reply</button>
</article>

<!-- A quote post: its inner status link belongs to the quoted tweet and must not
     become the outer tweet's id. -->
<article data-testid="tweet" id="quote">
  <div data-testid="User-Name"><a role="link" href="/quoter"><span>Quoter</span></a><a role="link" href="/quoter"><span>@quoter</span></a></div>
  <div data-testid="tweetText">quoting this</div>
  <div data-testid="quoteTweet"><article data-testid="tweet">
    <div data-testid="User-Name"><a role="link" href="/quoted"><span>Quoted</span></a></div>
    <div data-testid="tweetText">the quoted body</div>
    <a href="/quoted/status/9999"><time datetime="2025-12-31T00:00:00.000Z">Dec 31</time></a>
  </article></div>
  <a href="/quoter/status/1003"><time datetime="2026-01-01T00:02:00.000Z">Jan 1</time></a>
</article>
</main>

<!-- X keeps a second, collapsed dialog mounted. Its editor still has a size, so
     only the dialog's own box can tell which one is on screen. The fixture keeps
     that shape with #hidden-dialog, whose editor is inside a laid-out child. -->
<div id="hidden-dialog" role="dialog">
  <div style="width:480px;height:96px">
    <div data-testid="tweetTextarea_0" contenteditable="true"></div>
  </div>
</div>

<div id="modal" role="dialog" style="display:none">
  <div id="modal-quote"></div>
  <div data-testid="tweetTextarea_0_label"><div>Post your reply</div></div>
  <div data-testid="tweetTextarea_0" contenteditable="true"></div>
  <button data-testid="tweetButton" aria-disabled="true">Post</button>
</div>

<div data-testid="toast" id="toast" style="display:none"></div>
<script>
// The fixture's own behaviour: pressing a reply control opens the modal with the
// tweet it was pressed on, the post button enables once there is text, and
// pressing post adds a row and shows a toast.
(function () {
  const modal = document.getElementById('modal');
  const editor = modal.querySelector('[data-testid="tweetTextarea_0"]');
  const post = modal.querySelector('[data-testid="tweetButton"]');

  function quotedFrom(article) {
    const handle = (article.textContent.match(/@([A-Za-z0-9_]+)/) || [])[1] || null;
    const text = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
    return { handle, text };
  }
  function openReply(article) {
    const q = quotedFrom(article);
    document.getElementById('modal-quote').innerHTML =
      '<article data-testid="tweet"><div data-testid="User-Name"><a role="link" href="/' + q.handle + '"><span>@' +
      q.handle + '</span></a></div><div data-testid="tweetText">' + q.text + '</div></article>';
    modal.style.display = 'flex';
    editor.textContent = '';
    post.setAttribute('aria-disabled', 'true');
    window.__fixtureOpened = article.querySelector('a[href*="/status/"]')?.getAttribute('href') || null;
  }
  for (const btn of document.querySelectorAll('article [data-testid="reply"]')) {
    btn.addEventListener('click', () => openReply(btn.closest('article')));
  }
  editor.addEventListener('input', () => {
    const empty = !editor.innerText.trim();
    if (empty) post.setAttribute('aria-disabled', 'true');
    else post.removeAttribute('aria-disabled');
  });
  post.addEventListener('click', () => {
    if (post.getAttribute('aria-disabled') === 'true') return;
    const text = editor.innerText;
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.innerHTML = '<div data-testid="User-Name"><a role="link" href="/fixture_user"><span>@fixture_user</span></a></div>' +
      '<div data-testid="tweetText"></div>' +
      '<a href="/fixture_user/status/' + (2000 + Math.floor(Math.random() * 1000)) + '"><time datetime="' + new Date().toISOString() + '">now</time></a>';
    article.querySelector('[data-testid="tweetText"]').textContent = text;
    document.getElementById('column').appendChild(article);
    const toast = document.getElementById('toast');
    toast.textContent = 'Your post was sent.';
    toast.style.display = 'block';
    modal.style.display = 'none';
  });
})();
</script>
</body></html>`;
