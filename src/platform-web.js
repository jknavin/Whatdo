/* Website platform adapter: Google Identity Services token client + localStorage */
(function () {
  var CFG = window.WHATDO_CONFIG;
  var SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
  var tokenClient = null, gisReady = null, pendingResolve = null, pendingReject = null, hint = '';

  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CFG.GOOGLE_WEB_CLIENT_ID,
          scope: SCOPES,
          callback: function (r) {
            if (r.error) { pendingReject && pendingReject(new Error(r.error)); }
            else { pendingResolve && pendingResolve(r.access_token); }
          },
          error_callback: function (e) { pendingReject && pendingReject(new Error(e.type || 'popup_error')); }
        });
        res();
      };
      s.onerror = function () { rej(new Error('Could not load Google sign-in')); };
      document.head.appendChild(s);
    });
    return gisReady;
  }

  window.WhatdoPlatform = {
    type: 'web',
    store: {
      get: function (k) { try { return Promise.resolve(localStorage.getItem(k)); } catch (e) { return Promise.resolve(null); } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} return Promise.resolve(); }
    },
    getToken: function (interactive) {
      return loadGis().then(function () {
        return new Promise(function (res, rej) {
          pendingResolve = res; pendingReject = rej;
          tokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : 'none', hint: hint });
        });
      });
    },
    userInfo: function (token) {
      return fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { return r.json(); })
        .then(function (u) { hint = u.email || ''; return u; });
    },
    signOut: function (token) {
      return loadGis().then(function () { if (token) google.accounts.oauth2.revoke(token, function () {}); }).catch(function () {});
    },
    openUrl: function (u) { window.open(u, '_blank', 'noopener'); }
  };
})();
