// The only readable code on the published page (same lock as StrikeRX).
// It asks for the passphrase once, unscrambles the game (app.enc) on this device, saves the game's files
// in this device's offline storage, and opens the game. The unscrambling key is remembered on this device,
// so the passphrase is typed once. Without the passphrase, app.enc is unreadable.
(function () {
  var SALT = "7LnkkX+5SrdWmX9UQ6ieFA==";
  var ITERATIONS = 600000;
  var KEY_NAME = "rosesmoons-lock-key";
  var BUILD_NAME = "rosesmoons-build";
  var APP_CACHE = "rosesmoons-app";

  var swReady = ("serviceWorker" in navigator)
    ? navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function () { return navigator.serviceWorker.ready; })
    : Promise.reject(new Error("no sw"));

  function fromB64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function toB64(bytes) { var bin = ""; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
  // Must match normalize() in lock-shared.mjs exactly.
  function normalize(p) { return p.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }

  function deriveKeyBytes(passphrase) {
    var enc = new TextEncoder().encode(normalize(passphrase));
    return crypto.subtle.importKey("raw", enc, "PBKDF2", false, ["deriveBits"]).then(function (base) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(SALT), iterations: ITERATIONS }, base, 256);
    }).then(function (bits) { return new Uint8Array(bits); });
  }
  function decrypt(keyBytes, sealed) {
    var iv = sealed.slice(0, 12), body = sealed.slice(12);
    return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, body);
    }).then(function (plain) { return new Uint8Array(plain); });
  }

  // Unpack the game's files into offline storage (only when this build is new on this device), then open the game.
  function startGame(plain) {
    showMessage("Opening Rose's Moons...");
    var hlen = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0);
    var header = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + hlen)));
    var base = 4 + hlen, saved = null;
    try { saved = localStorage.getItem(BUILD_NAME); } catch (e) {}
    var gameUrl = new URL("app/index.html", location.href).href;
    return swReady.then(function () { return caches.open(APP_CACHE); }).then(function (cache) {
      return cache.match(gameUrl).then(function (hit) {
        if (hit && saved === header.build) return;
        return caches.delete(APP_CACHE).then(function () { return caches.open(APP_CACHE); }).then(function (fresh) {
          return Promise.all(header.files.map(function (f) {
            var body = plain.slice(base + f.at, base + f.at + f.len);
            return fresh.put(new URL("app/" + f.path, location.href).href, new Response(body, { headers: { "Content-Type": f.type } }));
          }));
        }).then(function () { try { localStorage.setItem(BUILD_NAME, header.build); } catch (e) {} });
      });
    }).then(function () { location.replace(gameUrl); });
  }

  function el(tag, style, text) { var e = document.createElement(tag); if (style) e.setAttribute("style", style); if (text) e.textContent = text; return e; }
  function showMessage(text) {
    var lock = document.getElementById("lock"); lock.textContent = "";
    lock.appendChild(el("p", "color:#f6dfa0;font:18px/1.5 Georgia,serif;max-width:300px;text-align:center;", text));
  }

  function showForm(sealed) {
    var lock = document.getElementById("lock"); lock.textContent = "";
    var img = el("img", "width:112px;height:112px;border-radius:24px;"); img.src = "icon-192.png"; img.alt = "Rose's Moons";
    var form = el("form", "display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;max-width:320px;");
    var label = el("label", "color:#f6dfa0;font:16px Georgia,serif;", "Enter your passphrase"); label.htmlFor = "pass";
    var input = el("input", "width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #6a4a1a;background:#0c0a2a;color:#fff6e0;font:16px system-ui,sans-serif;");
    input.id = "pass"; input.type = "password"; input.autocomplete = "current-password";
    input.setAttribute("autocapitalize", "off"); input.setAttribute("autocorrect", "off"); input.spellcheck = false;
    var showRow = el("label", "color:#c8b88a;font:14px system-ui,sans-serif;display:flex;gap:8px;align-items:center;");
    var show = el("input"); show.type = "checkbox"; show.addEventListener("change", function () { input.type = show.checked ? "text" : "password"; });
    showRow.appendChild(show); showRow.appendChild(document.createTextNode("Show what I type"));
    var button = el("button", "width:100%;padding:14px;border:0;border-radius:12px;background:#f6c64a;color:#2a1404;font:700 16px Georgia,serif;", "Unlock"); button.type = "submit";
    var note = el("p", "min-height:20px;margin:0;color:#fca5a5;font:14px system-ui,sans-serif;text-align:center;"); note.setAttribute("role", "alert");

    form.addEventListener("submit", function (ev) {
      ev.preventDefault(); if (!input.value.trim()) return;
      button.disabled = true; note.style.color = "#c8b88a"; note.textContent = "Checking...";
      var keyBytes;
      deriveKeyBytes(input.value).then(function (k) { keyBytes = k; return decrypt(k, sealed); }).then(function (plain) {
        try { localStorage.setItem(KEY_NAME, toB64(keyBytes)); } catch (e) {}
        return startGame(plain);
      }, function () {
        button.disabled = false; note.style.color = "#fca5a5"; note.textContent = "That passphrase did not work. Try again."; input.select();
      }).catch(function () { showMessage("Rose's Moons could not open here. Open the page in Safari with your signal on."); });
    });
    form.appendChild(label); form.appendChild(input); form.appendChild(showRow); form.appendChild(button); form.appendChild(note);
    lock.appendChild(img); lock.appendChild(form); input.focus();
  }

  if (!window.crypto || !crypto.subtle || !("serviceWorker" in navigator) || !window.caches) {
    showMessage("This browser cannot open Rose's Moons. Open the page in Safari or Chrome with https."); return;
  }

  // Download the game once: wait until the offline helper has saved it, then read that saved copy.
  // (Without this wait the first visit downloads the 4-5 MB file twice.)
  showMessage("Loading Rose's Moons... The first time can take a minute.");
  function controlled() {
    if (navigator.serviceWorker.controller) return Promise.resolve();
    return new Promise(function (res) { navigator.serviceWorker.addEventListener("controllerchange", res); setTimeout(res, 4000); });
  }
  swReady.then(controlled, function () {}).then(function () { return fetch("app.enc"); }).then(function (res) { if (!res.ok) throw new Error("load"); return res.arrayBuffer(); }).then(function (buf) {
    var sealed = new Uint8Array(buf), saved = null;
    try { saved = localStorage.getItem(KEY_NAME); } catch (e) {}
    if (!saved) return showForm(sealed);
    return decrypt(fromB64(saved), sealed).then(startGame, function () {
      // The passphrase was changed since this device last unlocked.
      try { localStorage.removeItem(KEY_NAME); } catch (e) {}
      showForm(sealed);
    });
  }).catch(function () { showMessage("Rose's Moons could not load. Check your signal and open it again."); });
})();
