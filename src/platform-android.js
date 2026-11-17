/* Android (Capacitor) platform adapter: native Google sign-in plugin + localStorage */
(function () {
  var CFG = window.WHATDO_CONFIG;
  var SCOPES = ['profile', 'email', 'https://www.googleapis.com/auth/drive.appdata'];
  var inited = false;

  function plugin() {
    var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
    if (!p) throw new Error('Google sign-in plugin missing');
    if (!inited) { p.initialize({ clientId: CFG.GOOGLE_WEB_CLIENT_ID, scopes: SCOPES, grantOfflineAccess: false }); inited = true; }
    return p;
  }

  window.WhatdoPlatform = {
    type: 'android',
    store: {
      get: function (k) { try { return Promise.resolve(localStorage.getItem(k)); } catch (e) { return Promise.resolve(null); } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} return Promise.resolve(); }
    },
    getToken: function (interactive) {
      return new Promise(function (res, rej) {
        try {
          var p = plugin();
          // refresh() returns a fresh access token for an already signed-in user; signIn() shows the account picker
          var run = interactive ? p.signIn() : p.refresh();
          run.then(function (r) {
            var t = (r.authentication && r.authentication.accessToken) || r.accessToken;
            t ? res(t) : rej(new Error('no token'));
          }).catch(rej);
        } catch (e) { rej(e); }
      });
    },
    userInfo: function (token) {
      return fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { return r.json(); });
    },
    signOut: function () {
      try { return plugin().signOut().catch(function () {}); } catch (e) { return Promise.resolve(); }
    },
    openUrl: function (u) {
      var b = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
      if (b) b.open({ url: u }); else window.open(u, '_blank');
    }
  };
})();
