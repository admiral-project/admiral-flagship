const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = '<!DOCTYPE html><html><head><meta name="csrf-token" content="test-csrf-token"></head><body><div id="app"></div></body></html>';
const dom = new JSDOM(html, {
  url: 'https://localhost:5000/',
  runScripts: 'dangerously',
  resources: 'usable'
});

const win = dom.window;

global.window = win;
global.document = win.document;
global.navigator = win.navigator;
global.fetch = win.fetch;
global.Headers = win.Headers;
global.Request = win.Request;
global.Response = win.Response;
global.sessionStorage = win.sessionStorage;
global.localStorage = win.localStorage;
global.location = win.location;
global.URL = win.URL;
global.URLSearchParams = win.URLSearchParams;

// Load Vue 3
const vueSrc = fs.readFileSync(require.resolve('vue/dist/vue.global.prod.js'), 'utf8');
win.eval(vueSrc);

// Intercept Vue.createApp to capture root config for testing
let capturedAppConfig = null;
const originalCreateApp = win.Vue.createApp;
win.Vue.createApp = function(config) {
  capturedAppConfig = config;
  return originalCreateApp.apply(this, arguments);
};

// Load Vue Router
const vueRouterSrc = fs.readFileSync(require.resolve('vue-router/dist/vue-router.global.prod.js'), 'utf8');
win.eval(vueRouterSrc);

// Load app.js (support instrumented file for code coverage)
const instrumentedPath = path.resolve(__dirname, 'instrumented/app.js');
const normalPath = path.resolve(__dirname, '../../app/static/js/app.js');
const appJsPath = fs.existsSync(instrumentedPath) ? instrumentedPath : normalPath;
let appJs = fs.readFileSync(appJsPath, 'utf8');

// Mock window.location.href and window.location.reload for JSDOM testing
appJs = appJs.replace(/window\.location\.href\s*=\s*/g, 'window.__location_href = ');
appJs = appJs.replace(/window\.location\.reload\(\)/g, 'window.__location_reload()');

win.__location_href = '';
win.__location_reload = function() { win.__location_reloaded = true; };

win.eval(appJs);

// Link JSDOM window coverage to global Node coverage if running under nyc
if (win.__coverage__) {
  global.__coverage__ = win.__coverage__;
}

// Expose app.js globals to Node global scope for Mocha tests
var exposed = [
  'apiUrl',
  'csrfToken',
  'buildPagedUrl',
  'showToast',
  'normalizePagedData',
  '_durationSecondsFromJob',
  '_progressPercentFromJob',
  'formatBytes',
  'formatTimestamp',
  'formatRelativeTime',
  'formatDuration',
  'normalizeStatus',
  'instanceStatusClass',
  'nodeStatusClass',
  'jobStatusClass',
  'backupStatusClass',
  'healthStatusClass',
  'provisionResultCache',
  'provisionResultStorageKey',
  'parseProvisionResultSnapshot',
  'storeProvisionResultSnapshot',
  'normalizeProvisionCredential',
  'normalizeProvisionCredentials',
  'mergeProvisionCredentials',
  'LoginView',
  'DashboardView',
  'NodesView',
  'NodeDetailView',
  'CatalogAppsView',
  'CatalogAppFormView',
  'CatalogAppDetailView',
  'InstancesView',
  'InstanceCreateView',
  'InstanceProvisionedView',
  'InstanceDetailView',
  'InstanceRestoreView',
  'BackupsView',
  'BackupSettingsView',
  'BackupDetailView',
  'JobsView',
  'JobDetailView',
  'ChangePasswordView',
  'ChangePasswordStandaloneView',
  'bffFetch',
  '__location_href',
  '__location_reload',
  'Vue',
  'VueRouter',
  'routes',
  'router',
  'app'
];

exposed.forEach(function(name) {
  if (name in win) {
    global[name] = win[name];
  }
});

global.rootAppConfig = capturedAppConfig;
