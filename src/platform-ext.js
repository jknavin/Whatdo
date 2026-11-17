/* Chrome extension platform adapter: chrome.identity + chrome.storage.local */
(function () {
  var CFG = window.WHATDO_CONFIG;
  var SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'];

  function viaGetAuthToken(interactive) {
    return new Promise(function (res, rej) {
      chrome.identity.getAuthToken({ interactive: interactive }, function (token) {
        if (chrome.runtime.lastError || !token) rej(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no token'));
        else res(token);
      });
    });
  }
  // Fallback for Chromium browsers without getAuthToken (needs a *Web* client with the chromiumapp.org redirect)
  function viaWebAuthFlow(interactive) {
    return new Promise(function (res, rej) {
      var redirect = chrome.identity.getRedirectURL();
      var url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=token&client_id=' +
        encodeURIComponent(CFG.GOOGLE_WEB_CLIENT_ID) + '&redirect_uri=' + encodeURIComponent(redirect) +
        '&scope=' + encodeURIComponent(SCOPES.join(' '));
      chrome.identity.launchWebAuthFlow({ url: url, interactive: interactive }, function (resp) {
        if (chrome.runtime.lastError || !resp) return rej(new Error('auth cancelled'));
        var m = /access_token=([^&]+)/.exec(resp);
        m ? res(decodeURIComponent(m[1])) : rej(new Error('no token'));
      });
    });
  }

  window.WhatdoPlatform = {
    type: 'ext',
    store: {
      get: function (k) { return new Promise(function (r) { chrome.storage.local.get(k, function (o) { r(o[k] || null); }); }); },
      set: function (k, v) { return new Promise(function (r) { var o = {}; o[k] = v; chrome.storage.local.set(o, r); }); }
    },
    getToken: function (interactive) {
      return viaGetAuthToken(interactive).catch(function (e) {
        return viaWebAuthFlow(interactive).catch(function () { throw e; });
      });
    },
    userInfo: function (token) {
      return fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) {
          if (r.status === 401 && chrome.identity.removeCachedAuthToken) {
            return new Promise(function (res) { chrome.identity.removeCachedAuthToken({ token: token }, res); }).then(function () { throw new Error('token expired'); });
          }
          return r.json();
        });
    },
    signOut: function (token) {
      return new Promise(function (res) {
        if (!token || !chrome.identity.removeCachedAuthToken) return res();
        chrome.identity.removeCachedAuthToken({ token: token }, function () {
          fetch('https://oauth2.googleapis.com/revoke?token=' + token, { method: 'POST' }).catch(function () {}).then(res);
        });
      });
    },
    openUrl: function (u) { chrome.tabs.create({ url: u }); },
    onExternalChange: function (cb) {
      chrome.storage.onChanged.addListener(function (c, area) { if (area === 'local' && c.whatdo_state) cb(); });
    }
  };
})();
