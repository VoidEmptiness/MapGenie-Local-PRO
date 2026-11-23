// ==UserScript==
// @name         MapGenie Local PRO (ViolentMonkey)
// @namespace    mapgenie-local-pro
// @version      1.0.0
// @description  PRO-функции MapGenie без подписки: метки, заметки, пресеты и профили хранятся только в localStorage, с импортом/экспортом
// @author       Void Emptiness
// @match        https://mapgenie.io/*
// @icon         https://cdn.mapgenie.io/favicons/mapgenie/favicon-96x96.png
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

(function () {
  'use strict';

  function core() {
    'use strict';
    if (window.__mgLocalCore) return;
    window.__mgLocalCore = true;
    var STORE_KEY = 'mg_local_data_v2';
    var UNLIMITED = 1e9;
    var isGuidePage = /\/guides(\/|$)/.test(location.pathname);
    var isMiniMap = false;
    try { isMiniMap = new URLSearchParams(location.search).get('mini') === 'true'; } catch (e) {}
    var guideFoundRef = null;
    var guideInitialized = false;

    if (isGuidePage) {
      try {
        var _guideFound = {};
        guideFoundRef = _guideFound;
        Object.defineProperty(window, 'foundLocations', {
          configurable: true,
          enumerable: true,
          get: function () { return _guideFound; },
          set: function (v) {
            if (v && typeof v === 'object') {
              Object.keys(v).forEach(function (k) { _guideFound[k] = v[k]; });
            }
          }
        });
      } catch (e) {
        if (!window.foundLocations || typeof window.foundLocations !== 'object') window.foundLocations = {};
        guideFoundRef = window.foundLocations;
      }
      ['isPro', 'isLoggedIn'].forEach(function (flag) {
        try {
          Object.defineProperty(window, flag, { configurable: true, enumerable: true, get: function () { return true; }, set: function () {} });
        } catch (e) { window[flag] = true; }
      });
      try {
        Object.defineProperty(window, 'maxFoundLocations', { configurable: true, enumerable: true, get: function () { return UNLIMITED; }, set: function () {} });
      } catch (e) { window.maxFoundLocations = UNLIMITED; }
    }


    function emptyDb() {
      return { version: 2, locations: {}, notes: {}, presets: {}, categories: {}, profiles: {}, activeProfile: {}, updatedAt: null };
    }
    function normalizeDb(d) {
      var out = emptyDb();
      if (d && typeof d === 'object') {
        ['locations', 'notes', 'presets', 'categories', 'profiles', 'activeProfile'].forEach(function (k) {
          if (d[k] && typeof d[k] === 'object') out[k] = d[k];
        });
        if (d.updatedAt) out.updatedAt = d.updatedAt;
      }
      return out;
    }
    function loadDb() {
      try { return normalizeDb(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); }
      catch (e) { return emptyDb(); }
    }

    var db = loadDb();

    function persist() {
      db.updatedAt = new Date().toISOString();
      try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
      catch (e) { console.error('[MG] не удалось сохранить данные', e); }
      refreshPanel();
    }


    var mapDataRef = null;
    var userRef = null;

    function gameInfo() {
      var g = window.game || {};
      var md = mapDataRef || {};
      var map = md.map || {};
      return {
        gameId: g.id != null ? g.id : (map.game_id != null ? map.game_id : null),
        gameSlug: g.slug || null,
        mapId: map.id != null ? map.id : null
      };
    }
    function gameKey() {
      var g = gameInfo();
      return g.gameId != null ? String(g.gameId) : (g.gameSlug || 'unknown');
    }
    function mapKey() {
      var g = gameInfo();
      return gameKey() + ':' + (g.mapId != null ? g.mapId : 'x');
    }
    function dataKey(profileId) {
      var k = mapKey();
      return profileId ? k + ':p' + profileId : k;
    }

    function activeProfile() {
      try {
        var st = window.store && window.store.getState();
        if (st && st.user && st.user.activeProfileId) return st.user.activeProfileId;
      } catch (e) {}
      return db.activeProfile[gameKey()] || null;
    }

    function locationsFor(profileId) {
      return db.locations[dataKey(profileId)] || {};
    }
    function notesFor(profileId) {
      return db.notes[dataKey(profileId)] || [];
    }
    function trackedFor() {
      return db.categories[mapKey()] || [];
    }
    function presetsFor() {
      return db.presets[gameKey()] || [];
    }
    function profilesFor() {
      return db.profiles[gameKey()] || [];
    }

    function gameLocationsCount(profileId) {
      var prefix = gameKey() + ':';
      var suffix = profileId ? ':p' + profileId : '';
      var total = 0;
      Object.keys(db.locations).forEach(function (k) {
        if (k.indexOf(prefix) !== 0) return;
        var isProfileKey = /:p\d+$/.test(k);
        if (profileId) { if (k.slice(-suffix.length) !== suffix) return; }
        else if (isProfileKey) return;
        var map = db.locations[k] || {};
        total += Object.keys(map).length;
      });
      return total;
    }


    function setFound(locationId, found, profileId) {
      var key = dataKey(profileId);
      var map = db.locations[key] || (db.locations[key] = {});
      if (found) map[locationId] = true;
      else delete map[locationId];
      if (!Object.keys(map).length) delete db.locations[key];
      persist();
      refreshUser();
    }

    function setTracked(categoryId, on) {
      var key = mapKey();
      var list = (db.categories[key] || []).filter(function (id) { return id !== categoryId; });
      if (on) list.push(categoryId);
      if (list.length) db.categories[key] = list;
      else delete db.categories[key];
      persist();
      refreshUser();
    }

    function upsertNote(note, profileId) {
      var key = dataKey(profileId);
      var list = (db.notes[key] || []).slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === note.id) { idx = i; break; }
      if (idx >= 0) list[idx] = note; else list.push(note);
      db.notes[key] = list;
      persist();
    }

    function removeNote(noteId, mapId, profileId) {
      var keys = [dataKey(profileId)];
      if (mapId != null) keys.push(gameKey() + ':' + mapId + (profileId ? ':p' + profileId : ''));
      keys.forEach(function (key) {
        var list = db.notes[key];
        if (!list) return;
        var next = list.filter(function (n) { return n.id !== noteId; });
        if (next.length) db.notes[key] = next;
        else delete db.notes[key];
      });
      persist();
    }

    function upsertPreset(preset) {
      var key = gameKey();
      var list = (db.presets[key] || []).filter(function (p) { return p.id !== preset.id; });
      list.push(preset);
      db.presets[key] = list;
      persist();
    }
    function removePreset(id) {
      var key = gameKey();
      var list = (db.presets[key] || []).filter(function (p) { return p.id !== id; });
      if (list.length) db.presets[key] = list;
      else delete db.presets[key];
      persist();
    }
    function reorderPresets(ordering) {
      var key = gameKey();
      var list = db.presets[key] || [];
      var byId = {};
      list.forEach(function (p) { byId[p.id] = p; });
      var ordered = [];
      (ordering || []).forEach(function (id) { if (byId[id]) { ordered.push(byId[id]); delete byId[id]; } });
      Object.keys(byId).forEach(function (id) { ordered.push(byId[id]); });
      db.presets[key] = ordered;
      persist();
    }

    function ensureId(current, offset) {
      var id = Math.max(Date.now() + (offset || 0), (current || 0) + 1);
      return id;
    }
    function maxNoteId() {
      var max = 0;
      Object.keys(db.notes).forEach(function (k) {
        (db.notes[k] || []).forEach(function (n) { if (n && n.id > max) max = n.id; });
      });
      return max;
    }
    function maxPresetId() {
      var max = 0;
      Object.keys(db.presets).forEach(function (k) {
        (db.presets[k] || []).forEach(function (p) { if (p && p.id > max) max = p.id; });
      });
      return max;
    }
    function maxProfileId() {
      var max = 0;
      Object.keys(db.profiles).forEach(function (k) {
        (db.profiles[k] || []).forEach(function (p) { if (p && p.id > max) max = p.id; });
      });
      return max;
    }


    function buildMockUser(original) {
      var profileId = activeProfile();
      var user = {
        id: (original && original.id) || -1,
        username: (original && original.username) || 'local',
        email: (original && original.email) || null,
        email_verified: true,
        hasPro: true,
        isPro: true,
        pro: true,
        locations: {},
        gameLocationsCount: 0,
        trackedCategoryIds: [],
        profiles: [],
        activeProfileId: profileId,
        suggestions: (original && original.suggestions) || []
      };
      ['hasPro', 'isPro', 'pro'].forEach(function (flag) {
        try {
          Object.defineProperty(user, flag, {
            configurable: true,
            enumerable: true,
            get: function () { return true; },
            set: function () {}
          });
        } catch (e) {}
      });
      return user;
    }

    function refreshUser(profileId) {
      if (!userRef) return;
      if (profileId === undefined) profileId = activeProfile();

      var found = locationsFor(profileId);
      Object.keys(userRef.locations).forEach(function (k) { delete userRef.locations[k]; });
      Object.keys(found).forEach(function (k) { if (found[k]) userRef.locations[k] = true; });

      userRef.gameLocationsCount = gameLocationsCount(profileId);
      userRef.trackedCategoryIds = trackedFor();
      userRef.profiles = profilesFor();
      userRef.activeProfileId = profileId;
      userRef.hasPro = true;
      userRef.isPro = true;
    }

    function injectUserDescriptor() {
      var base = null;
      userRef = buildMockUser(null);
      refreshUser(null);

      try {
        Object.defineProperty(window, 'user', {
          configurable: true,
          enumerable: true,
          get: function () { return userRef; },
          set: function (value) {
            base = value;
            userRef = buildMockUser(value);
            refreshUser();
          }
        });
      } catch (e) {
        window.user = userRef;
      }
    }

    function injectMapDataDescriptor() {
      try {
        Object.defineProperty(window, 'mapData', {
          configurable: true,
          enumerable: true,
          get: function () { return mapDataRef; },
          set: function (value) {
            mapDataRef = enrichMapData(value);
            refreshUser();
          }
        });
      } catch (e) {}
    }

    function enrichMapData(md) {
      if (!md || typeof md !== 'object') return md;
      var profileId = activeProfile();
      try { md.maxMarkedLocations = UNLIMITED; } catch (e) {}
      try { md.maxNotes = UNLIMITED; } catch (e) {}
      try {
        var notes = notesFor(profileId);
        if (notes.length) md.notes = notes.slice();
      } catch (e) {}
      try {
        var presets = presetsFor();
        if (presets.length) {
          var existing = Array.isArray(md.presets) ? md.presets : [];
          var ids = {};
          presets.forEach(function (p) { ids[p.id] = true; });
          md.presets = presets.concat(existing.filter(function (p) { return p && !ids[p.id]; }));
        }
      } catch (e) {}
      return md;
    }


    function ok(data, status) {
      return Promise.resolve({
        data: data,
        status: status || 200,
        statusText: 'OK',
        headers: {},
        config: {}
      });
    }

    function parseBody(config) {
      var data = config.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { data = {}; }
      }
      return data && typeof data === 'object' ? data : {};
    }

    function mapDataPayload(profileId) {
      var pid = profileId != null ? profileId : activeProfile();
      return {
        locations: Object.assign({}, locationsFor(pid)),
        gameLocationsCount: gameLocationsCount(pid),
        notes: notesFor(pid).slice(),
        presets: presetsFor().slice(),
        profiles: profilesFor().slice(),
        profileId: pid,
        activeProfileId: pid,
        hasPro: true,
        isPro: true,
        trackedCategoryIds: trackedFor().slice(),
        maxMarkedLocations: UNLIMITED,
        suggestions: []
      };
    }

    function handleRequest(config) {
      config = config || {};
      var raw = String(config.url || '');
      var path;
      try { path = new URL(raw, location.origin).pathname; } catch (e) { return null; }
      if (path.indexOf('/api/v1/user/') !== 0) return null;

      var method = String(config.method || 'get').toLowerCase();
      var params = config.params || {};
      var body = parseBody(config);
      var profileId = params.profile_id != null ? params.profile_id : activeProfile();
      var m;
      var note;
      var preset;

      if ((m = path.match(/^\/api\/v1\/user\/map-data\/(\d+)$/)) && method === 'get') {
        return ok(mapDataPayload(params.profile_id || null));
      }

      if ((m = path.match(/^\/api\/v1\/user\/locations\/(\d+)$/))) {
        var locationId = Number(m[1]);
        if (method === 'put' || method === 'post') {
          setFound(locationId, true, profileId);
          return ok({});
        }
        if (method === 'delete') {
          setFound(locationId, false, profileId);
          return ok({});
        }
      }

      if (path === '/api/v1/user/categories' && method === 'post') {
        setTracked(body.category, true);
        return ok({});
      }
      if ((m = path.match(/^\/api\/v1\/user\/categories\/(\d+)$/)) && method === 'delete') {
        setTracked(Number(m[1]), false);
        return ok({});
      }

      if (path === '/api/v1/user/notes' && method === 'post') {
        var noteProfile = body.profile_id != null ? body.profile_id : profileId;
        note = {
          id: ensureId(maxNoteId()),
          map_id: body.map_id != null ? body.map_id : gameInfo().mapId,
          user_id: -1,
          title: body.title || '',
          description: body.description || '',
          color: body.color || null,
          latitude: body.latitude,
          longitude: body.longitude,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        upsertNote(note, noteProfile);
        return ok(note, 201);
      }
      if ((m = path.match(/^\/api\/v1\/user\/notes\/(\d+)$/))) {
        var noteId = Number(m[1]);
        if (method === 'put') {
          var key = dataKey(profileId);
          var list = db.notes[key] || [];
          var found = null;
          for (var i = 0; i < list.length; i++) if (list[i].id === noteId) { found = list[i]; break; }
          note = Object.assign({}, found || { id: noteId }, {
            map_id: body.map_id != null ? body.map_id : (found && found.map_id),
            title: body.title != null ? body.title : (found && found.title),
            description: body.description != null ? body.description : (found && found.description),
            color: body.color != null ? body.color : (found && found.color),
            latitude: body.latitude != null ? body.latitude : (found && found.latitude),
            longitude: body.longitude != null ? body.longitude : (found && found.longitude),
            updated_at: new Date().toISOString()
          });
          upsertNote(note, profileId);
          return ok(note);
        }
        if (method === 'delete') {
          removeNote(noteId, params.map_id, profileId);
          return ok({});
        }
      }

      if (path === '/api/v1/user/presets' && method === 'post') {
        preset = {
          id: ensureId(maxPresetId()),
          game_id: body.game_id != null ? body.game_id : gameInfo().gameId,
          title: body.title || 'Preset',
          categories: body.categories || [],
          tags: body.tags || {},
          ordering: body.ordering || [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        upsertPreset(preset);
        return ok(preset, 201);
      }
      if (path === '/api/v1/user/presets/reorder' && method === 'post') {
        reorderPresets(body.ordering);
        return ok({});
      }
      if ((m = path.match(/^\/api\/v1\/user\/presets\/(\d+)$/))) {
        if (method === 'delete') {
          removePreset(Number(m[1]));
          return ok({});
        }
        if (method === 'put') {
          var gkey = gameKey();
          var plist = db.presets[gkey] || [];
          var pfound = null;
          for (var j = 0; j < plist.length; j++) if (plist[j].id === Number(m[1])) { pfound = plist[j]; break; }
          preset = Object.assign({}, pfound || { id: Number(m[1]) }, body, { updated_at: new Date().toISOString() });
          upsertPreset(preset);
          return ok(preset);
        }
      }

      if ((m = path.match(/^\/api\/v1\/user\/games\/(\d+)\/profiles$/)) && method === 'post') {
        var gk = gameKey();
        var newProfile = {
          id: ensureId(maxProfileId()),
          game_id: Number(m[1]),
          name: body.name || 'Profile',
          created_at: new Date().toISOString()
        };
        db.profiles[gk] = (db.profiles[gk] || []).concat([newProfile]);
        if (body.copy_from) {
          var fromKey = gameInfo().mapId != null
            ? gk + ':' + gameInfo().mapId + (body.copy_from !== 'default' ? ':p' + body.copy_from : '')
            : null;
          var toKey = gameInfo().mapId != null
            ? gk + ':' + gameInfo().mapId + ':p' + newProfile.id
            : null;
          if (fromKey && toKey && db.locations[fromKey]) {
            db.locations[toKey] = JSON.parse(JSON.stringify(db.locations[fromKey]));
          }
        }
        persist();
        refreshUser();
        return ok(newProfile, 201);
      }
      if ((m = path.match(/^\/api\/v1\/user\/games\/(\d+)\/profiles\/active$/)) && method === 'post') {
        var agk = gameKey();
        db.activeProfile[agk] = body.profile_id != null ? body.profile_id : null;
        persist();
        refreshUser(body.profile_id || null);
        return ok({});
      }
      if ((m = path.match(/^\/api\/v1\/user\/profiles\/(\d+)$/))) {
        var pid = Number(m[1]);
        var pgk = gameKey();
        if (method === 'put') {
          db.profiles[pgk] = (db.profiles[pgk] || []).map(function (p) {
            return p.id === pid ? Object.assign({}, p, { name: body.name != null ? body.name : p.name }) : p;
          });
          persist();
          var renamed = (db.profiles[pgk] || []).filter(function (p) { return p.id === pid; })[0];
          refreshUser();
          return ok(renamed || { id: pid, name: body.name });
        }
        if (method === 'delete') {
          db.profiles[pgk] = (db.profiles[pgk] || []).filter(function (p) { return p.id !== pid; });
          Object.keys(db.locations).forEach(function (k) { if (k.slice(-3 - String(pid).length) === ':p' + pid && k.indexOf(pgk + ':') === 0) delete db.locations[k]; });
          Object.keys(db.notes).forEach(function (k) { if (k.slice(-3 - String(pid).length) === ':p' + pid && k.indexOf(pgk + ':') === 0) delete db.notes[k]; });
          if (db.activeProfile[pgk] === pid) db.activeProfile[pgk] = null;
          persist();
          refreshUser();
          return ok({});
        }
      }

      return null;
    }

    function wrapAxios(instance) {
      if (!instance || typeof instance.request !== 'function' || instance.__mgWrapped) return instance;
      var originalRequest = instance.request.bind(instance);

      function send(config) {
        var handled = null;
        try { handled = handleRequest(config); }
        catch (e) { console.error('[MG] ошибка обработки запроса', e); }
        if (handled) return handled;
        return originalRequest(config);
      }

      instance.request = send;

      ['get', 'delete', 'head', 'options'].forEach(function (name) {
        var orig = instance[name];
        if (typeof orig !== 'function') return;
        instance[name] = function (url, config) {
          return send(Object.assign({}, config || {}, { url: url, method: name }));
        };
      });
      ['post', 'put', 'patch'].forEach(function (name) {
        var orig = instance[name];
        if (typeof orig !== 'function') return;
        instance[name] = function (url, data, config) {
          return send(Object.assign({}, config || {}, { url: url, method: name, data: data }));
        };
      });

      instance.__mgWrapped = true;
      return instance;
    }

    function installAxiosHook() {
      var current = null;
      try {
        Object.defineProperty(window, 'axios', {
          configurable: true,
          enumerable: true,
          get: function () { return current; },
          set: function (value) { current = wrapAxios(value); }
        });
      } catch (e) {
        if (window.axios) window.axios = wrapAxios(window.axios);
      }
    }


    function installStyles() {
      var host = document.head || document.documentElement;
      if (!host) {
        document.addEventListener('DOMContentLoaded', installStyles, { once: true });
        return;
      }
      var css = [
        '.btn-upgrade, #button-upgrade, .heatmaps-upgrade, a.pro-link-text { display: none !important; }',
        '#user-panel .upgrade, #user-panel .inset a.pro-link-text { display: none !important; }',
        '.sidebar .pogo, .footer-large .pogo, .pro-upgrade-element, .info-tip, .tip-suggestions { display: none !important; }',
        '#mg-local-panel{position:fixed;right:14px;bottom:14px;z-index:2147483000;font:12px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8f0;background:rgba(18,18,26,.94);border:1px solid #3a3a4a;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.45);width:212px;overflow:hidden}',
        '#mg-local-panel .mg-head{display:flex;align-items:center;justify-content:space-between;padding:7px 9px;background:rgba(255,255,255,.05);cursor:pointer;font-weight:600}',
        '#mg-local-panel .mg-body{padding:8px;display:block}',
        '#mg-local-panel.collapsed .mg-body{display:none}',
        '#mg-local-panel button{display:block;width:100%;margin:0 0 5px;padding:5px 7px;background:#2a2a3a;color:#e8e8f0;border:1px solid #41415a;border-radius:6px;cursor:pointer;font-size:12px;text-align:left}',
        '#mg-local-panel button:hover{background:#35354a}',
        '#mg-local-panel button.mg-danger{color:#ff9c9c;border-color:#5a3a3a}',
        '#mg-local-panel .mg-stats{padding:4px 2px 2px;opacity:.75;font-size:11px}',
        '#mg-local-panel .mg-log{max-height:78px;overflow:auto;opacity:.7;font-size:11px;margin-top:4px;white-space:pre-wrap}',
        '.guide .check[data-location-id]:checked::after{left:0 !important;top:0 !important;right:0 !important;bottom:0 !important;display:flex !important;align-items:center !important;justify-content:center !important;width:auto !important;height:auto !important;margin:0 !important;padding:0 !important;font-size:18px !important;line-height:1 !important;background:none !important;border:none !important;box-shadow:none !important}'
      ].join('\n');
      var style = document.createElement('style');
      style.id = 'mg-local-style';
      style.textContent = css;
      host.appendChild(style);
    }


    function stats() {
      var pid = activeProfile();
      return {
        mapMarks: Object.keys(locationsFor(pid)).length,
        totalMarks: Object.keys(db.locations).reduce(function (acc, k) {
          return acc + Object.keys(db.locations[k] || {}).length;
        }, 0),
        notes: Object.keys(db.notes).reduce(function (acc, k) { return acc + (db.notes[k] || []).length; }, 0),
        presets: presetsFor().length,
        maps: Object.keys(db.locations).length
      };
    }

    function exportData() {
      return {
        app: 'mapgenie-local-pro',
        version: 2,
        exportedAt: new Date().toISOString(),
        data: db
      };
    }

    function download(filename, obj) {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 200);
    }

    function exportAll() {
      download('mapgenie-local-' + new Date().toISOString().slice(0, 10) + '.json', exportData());
    }

    function exportCurrentMap() {
      var g = gameInfo();
      var pid = activeProfile();
      var key = dataKey(pid);
      var payload = {
        app: 'mapgenie-local-pro',
        version: 2,
        exportedAt: new Date().toISOString(),
        partial: true,
        map: { gameId: g.gameId, gameSlug: g.gameSlug, mapId: g.mapId },
        data: {
          version: 2,
          locations: db.locations[key] ? JSON.parse(JSON.stringify({})) : {},
          notes: {},
          presets: {},
          categories: {},
          profiles: {},
          activeProfile: {},
          updatedAt: db.updatedAt
        }
      };
      if (db.locations[key]) payload.data.locations[key] = db.locations[key];
      if (db.notes[key]) payload.data.notes[key] = db.notes[key];
      download('mapgenie-map-' + (g.gameSlug || 'map') + '-' + (g.mapId != null ? g.mapId : 'x') + '.json', payload);
    }

    function importData(obj, replace) {
      if (!obj || typeof obj !== 'object') throw new Error('bad file');
      var incoming = obj.data && typeof obj.data === 'object' ? obj.data : obj;
      var norm = normalizeDb(incoming);

      if (replace) {
        db = norm;
      } else {
        ['locations', 'notes', 'categories', 'profiles', 'activeProfile'].forEach(function (k) {
          Object.keys(norm[k]).forEach(function (key) {
            if (k === 'locations' || k === 'categories') {
              db[k][key] = db[k][key] || {};
              if (k === 'locations') {
                Object.keys(norm.locations[key]).forEach(function (id) { db.locations[key][id] = true; });
              } else {
                (norm.categories[key] || []).forEach(function (id) {
                  if ((db.categories[key] || []).indexOf(id) === -1) (db.categories[key] = db.categories[key] || []).push(id);
                });
              }
            } else if (k === 'notes') {
              var byId = {};
              (db.notes[key] || []).forEach(function (n) { byId[n.id] = n; });
              (norm.notes[key] || []).forEach(function (n) { byId[n.id] = n; });
              db.notes[key] = Object.values(byId);
            } else if (k === 'profiles') {
              var pById = {};
              (db.profiles[key] || []).forEach(function (p) { pById[p.id] = p; });
              (norm.profiles[key] || []).forEach(function (p) { pById[p.id] = p; });
              db.profiles[key] = Object.values(pById);
            } else {
              db.activeProfile[key] = norm.activeProfile[key];
            }
          });
        });
        var pById2 = {};
        (db.presets[gameKey()] || []).forEach(function (p) { pById2[p.id] = p; });
        Object.keys(norm.presets).forEach(function (k) {
          db.presets[k] = db.presets[k] || [];
          var ids = {};
          db.presets[k].forEach(function (p) { ids[p.id] = true; });
          norm.presets[k].forEach(function (p) { if (p && !ids[p.id]) db.presets[k].push(p); });
        });
      }
      persist();
      refreshUser();
      if (mapDataRef) enrichMapData(mapDataRef);
    }


    var panel = null;

    function setStatus(text) {
      if (!panel) return;
      var log = panel.querySelector('.mg-log');
      if (log) log.textContent = text;
    }

    function refreshPanel() {
      if (!panel) return;
      var s = stats();
      var statsEl = panel.querySelector('.mg-stats');
      if (statsEl) {
        statsEl.textContent = 'Карта: ' + s.mapMarks + ' · Всего меток: ' + s.totalMarks +
          ' · Заметки: ' + s.notes + ' · Пресеты: ' + s.presets;
      }
    }

    function buildPanel() {
      if (panel || !document.body) return;
      if (isMiniMap || window.top !== window.self) return;
      var existing = document.getElementById('mg-local-panel');
      if (existing) { panel = existing; return; }
      panel = document.createElement('div');
      panel.id = 'mg-local-panel';
      panel.innerHTML = [
        '<div class="mg-head"><span>MapGenie Local</span><span class="mg-toggle">▾</span></div>',
        '<div class="mg-body">',
        '<div class="mg-stats"></div>',
        '<button data-act="export-all">Экспорт всех данных</button>',
        '<button data-act="export-map">Экспорт текущей карты</button>',
        '<button data-act="import">Импорт (объединить)</button>',
        '<button data-act="import-replace">Импорт (заменить всё)</button>',
        '<button data-act="refresh">Обновить счётчики</button>',
        '<button data-act="clear" class="mg-danger">Удалить локальные данные</button>',
        '<input type="file" accept="application/json,.json" style="display:none">',
        '<div class="mg-log"></div>',
        '</div>'
      ].join('');
      document.body.appendChild(panel);

      var input = panel.querySelector('input[type=file]');
      var mode = 'merge';

      panel.querySelector('.mg-head').addEventListener('click', function () {
        panel.classList.toggle('collapsed');
      });

      panel.addEventListener('click', function (ev) {
        var btn = ev.target.closest('button[data-act]');
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        if (act === 'export-all') { exportAll(); setStatus('Экспортировано.'); }
        else if (act === 'export-map') { exportCurrentMap(); setStatus('Карта экспортирована.'); }
        else if (act === 'import') { mode = 'merge'; input.click(); }
        else if (act === 'import-replace') { mode = 'replace'; input.click(); }
        else if (act === 'refresh') { refreshPanel(); }
        else if (act === 'clear') {
          if (confirm('Удалить все локальные данные MapGenie (метки, заметки, пресеты, профили)?')) {
            db = emptyDb();
            persist();
            refreshUser();
            refreshPanel();
            setStatus('Данные удалены. Перезагрузите страницу.');
          }
        }
      });

      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importData(JSON.parse(String(reader.result)), mode === 'replace');
            refreshPanel();
            setStatus('Импорт выполнен. Обновите страницу (F5), чтобы метки появились на карте.');
          } catch (e) {
            console.error(e);
            setStatus('Не удалось прочитать файл.');
          }
        };
        reader.readAsText(file);
        input.value = '';
      });

      refreshPanel();
    }

    function schedulePanel(delay) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(buildPanel, delay); }, { once: true });
      } else {
        setTimeout(buildPanel, delay);
      }
    }


    function guideExtractLocationId(row) {
      if (!row) return null;
      var link = row.querySelector ? (row.querySelector('a.location-link') || row.querySelector('td.location-link-wrapper a') || row.querySelector('a[href*="locationIds="]')) : null;
      if (!link) return null;
      var m = (link.getAttribute('href') || '').match(/locationIds=(\d+)/);
      return m ? m[1] : null;
    }

    function guideFixCheckboxes() {
      if (!isGuidePage) return;
      var boxes = document.querySelectorAll('.check');
      for (var i = 0; i < boxes.length; i++) {
        var cb = boxes[i];
        if (!cb.getAttribute('data-location-id')) {
          var row = (cb.closest ? (cb.closest('tr') || cb.closest('.guide-item') || cb.parentElement) : cb.parentElement);
          var id = guideExtractLocationId(row);
          if (id) cb.setAttribute('data-location-id', id);
        }
        cb.removeAttribute('disabled');
        cb.removeAttribute('aria-label');
        cb.removeAttribute('data-balloon-pos');
        cb.removeAttribute('data-balloon-length');
        var id2 = cb.getAttribute('data-location-id');
        var checked = !!(id2 && guideFoundRef && guideFoundRef[id2]);
        cb.checked = checked;
        var rowEl = cb.closest ? cb.closest('tr') : null;
        if (rowEl) {
          if (checked) rowEl.classList.add('found'); else rowEl.classList.remove('found');
        }
      }
      var label = document.getElementById('guide-hide-found-locations-checkbox-label');
      if (label && guideFoundRef) {
        label.textContent = 'Hide Found Items (' + Object.keys(guideFoundRef).length + ')';
      }
    }

    function guideTryInit() {
      if (!isGuidePage || guideInitialized) return;
      var iframe = document.querySelector('iframe[src*="/maps/"]');
      var cw = iframe && iframe.contentWindow;
      if (!cw || !cw.game || !cw.mapData) {
        setTimeout(guideTryInit, 300);
        return;
      }
      try { window.game = cw.game; } catch (e) {}
      try { window.mapData = cw.mapData; } catch (e) { mapDataRef = cw.mapData; }
      var pid = activeProfile();
      var found = locationsFor(pid);
      var target = guideFoundRef || window.foundLocations;
      if (target) {
        Object.keys(target).forEach(function (k) { delete target[k]; });
        Object.keys(found).forEach(function (k) { target[k] = k; });
      }
      guideFixCheckboxes();
      guideInitialized = true;
    }

    function scheduleGuideInit() {
      if (!isGuidePage) return;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(guideTryInit, 100); }, { once: true });
      } else {
        setTimeout(guideTryInit, 100);
      }
    }

    function installHooks() {
      if (window.__mgLocalHooks) return;
      window.__mgLocalHooks = true;
      installAxiosHook();
      injectMapDataDescriptor();
      injectUserDescriptor();
      installStyles();
    }

    installHooks();
    schedulePanel(1200);
    if (isGuidePage) scheduleGuideInit();

    var lastPath = location.pathname;
    function onNavigate() {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      setTimeout(function () {
        if (mapDataRef) enrichMapData(mapDataRef);
        refreshUser();
        refreshPanel();
      }, 400);
    }
    ['pushState', 'replaceState'].forEach(function (name) {
      var orig = history[name];
      history[name] = function () {
        var res = orig.apply(this, arguments);
        onNavigate();
        return res;
      };
    });
    window.addEventListener('popstate', onNavigate);

    console.log('[MapGenie Local] PRO + локальное хранилище активны');
  }

  try { core(); } catch (e) { console.error('[MapGenie Local] core error', e); }

  var injected = false;
  function injectCore() {
    if (injected) return;
    var host = document.head || document.documentElement;
    if (!host) return;
    injected = true;
    try {
      var script = document.createElement('script');
      script.textContent = 'if(!window.__mgLocalCore){(' + core.toString() + ')();}';
      host.appendChild(script);
      script.remove();
    } catch (e) {
      injected = false;
      console.error('[MapGenie Local] не удалось внедрить ядро', e);
    }
  }

  if (document.documentElement) {
    injectCore();
  } else {
    var observer = new MutationObserver(function () {
      if (!document.documentElement) return;
      observer.disconnect();
      injectCore();
    });
    try { observer.observe(document, { childList: true, subtree: true }); } catch (e) {}
    document.addEventListener('readystatechange', injectCore);
    setTimeout(injectCore, 0);
  }
})();
