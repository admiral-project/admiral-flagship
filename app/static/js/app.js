// SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
// SPDX-License-Identifier: Apache-2.0

var __ = Object.assign;

function apiUrl(path) {
  return '/flagship/api' + path;
}

function csrfToken() {
  var meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

async function bffFetch(url, opts) {
  opts = opts || {};
  var headers = __({ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, opts.headers || {});
  var method = String(opts.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) !== -1) {
    headers['X-CSRF-Token'] = csrfToken();
  }
  var res = await fetch(url, __({ headers: headers }, opts));
  var data;
  try { data = await res.json(); } catch(e) { data = {}; }
  if (!res.ok) {
    if (res.status === 401 && url.indexOf('/auth/') === -1) {
      sessionStorage.setItem('session_expired', '1');
      window.location.href = '/';
      return;
    }
    throw new Error(data.error || 'Request failed (' + res.status + ')');
  }
  // Update CSRF token from response header (rotated on each state change)
  var newToken = res.headers.get('X-CSRF-Token');
  if (newToken) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) { meta.setAttribute('content', newToken); }
  }
  return data;
}

function buildPagedUrl(path, page, pageSize, extra) {
  var params = new URLSearchParams();
  params.set('page', page || 1);
  params.set('page_size', pageSize || 20);
  extra = extra || {};
  Object.keys(extra).forEach(function(key) {
    if (extra[key] !== undefined && extra[key] !== null && extra[key] !== '') {
      params.set(key, extra[key]);
    }
  });
  return path + '?' + params.toString();
}

window.showToast = function(type, message) {
  var container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.innerHTML = '<span>' + (message || '') + '</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentElement) toast.remove(); }, 5000);
};

function normalizePagedData(data, legacyKey) {
  if (data && Array.isArray(data.items)) {
    return {
      items: data.items,
      page: data.page || 1,
      pageSize: data.page_size || 20,
      total: data.total || 0
    };
  }

  var items = [];
  if (data && Array.isArray(data[legacyKey])) {
    items = data[legacyKey];
  } else if (Array.isArray(data)) {
    items = data;
  }

  return {
    items: items,
    page: 1,
    pageSize: items.length || 20,
    total: items.length
  };
}

function _durationSecondsFromJob(job) {
  if (!job) return null;
  if (job.duration_seconds !== undefined && job.duration_seconds !== null) return job.duration_seconds;
  var started = job.started_at || job.created_at || job.timestamp;
  var ended = job.completed_at || job.finished_at || job.updated_at;
  if (!started || !ended) return null;
  var startDate = new Date(started);
  var endDate = new Date(ended);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
}

function _progressPercentFromJob(job) {
  if (!job) return null;
  var candidates = [job.progress_percent, job.progress, job.percent_complete];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = candidates[i];
    if (value === undefined || value === null || value === '') continue;
    var num = Number(value);
    if (!isNaN(num)) return Math.max(0, Math.min(100, Math.round(num)));
  }
  return null;
}

var LoginView = {
  template: '\
    <div class="login-page">\
      <div class="login-card">\
        <div class="login-card-header">\
          <img src="/static/img/admiral-flagship.png" alt="Admiral" class="login-logo">\
          <h1>Admiral</h1>\
          <p class="login-subtitle">Platform Admin Console</p>\
        </div>\
        <div class="login-card-body">\
          <div v-if="flashMessage" class="pf-c-alert pf-m-info pf-m-inline pf-u-mb-md" role="alert">\
            <div class="pf-c-alert__icon"><i class="fas fa-fw fa-info-circle" aria-hidden="true"></i></div>\
            <p class="pf-c-alert__title">{{ flashMessage }}</p>\
          </div>\
          <div v-if="error" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert">\
            <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
            <p class="pf-c-alert__title">{{ error }}</p>\
          </div>\
          <form class="pf-c-form" @submit.prevent="login">\
            <div class="pf-c-form__group">\
              <label class="pf-c-form__label" for="login-username">\
                <span class="pf-c-form__label-text">Username</span>\
              </label>\
              <input id="login-username" class="pf-c-form-control" type="text" v-model="username" required autocomplete="username" autofocus placeholder="Enter your username">\
            </div>\
            <div class="pf-c-form__group">\
              <label class="pf-c-form__label" for="login-password">\
                <span class="pf-c-form__label-text">Password</span>\
              </label>\
              <input id="login-password" class="pf-c-form-control" type="password" v-model="password" required autocomplete="current-password" placeholder="Enter your password">\
            </div>\
            <div class="pf-c-form__group pf-m-action">\
              <button class="pf-c-button pf-m-primary pf-m-block" type="submit" :disabled="loading">\
                <span v-if="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Signing in...</span>\
                <span v-else><i class="fas fa-sign-in-alt pf-u-mr-sm"></i>Sign In</span>\
              </button>\
            </div>\
          </form>\
        </div>\
      </div>\
    </div>',
  data: function() {
    var flash = sessionStorage.getItem('session_expired') === '1' ? 'Your session has expired. Please log in again.' : '';
    if (flash) sessionStorage.removeItem('session_expired');
    return { username: '', password: '', error: '', loading: false, flashMessage: flash };
  },
  methods: {
    login: async function() {
      this.loading = true;
      this.error = '';
      try {
        var resp = await bffFetch('/flagship/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: this.username, password: this.password })
        });
        if (resp.username) {
          sessionStorage.setItem('first_login_username', resp.username);
        }
        window.location.href = '/';
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  }
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  var i = 0;
  var val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return val.toFixed(1) + ' ' + units[i];
}

function formatTimestamp(value) {
  if (!value) return '-';
  var parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) return '';
  var parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  var seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function formatDuration(seconds) {
  if (seconds === undefined || seconds === null || seconds === '') return '-';
  var total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '-';
  if (total < 60) return total + 's';
  if (total < 3600) return Math.floor(total / 60) + 'm ' + (total % 60) + 's';
  return Math.floor(total / 3600) + 'h ' + Math.floor((total % 3600) / 60) + 'm';
}

function normalizeStatus(value) {
  return String(value || '').toLowerCase();
}

function instanceStatusClass(status) {
  var s = normalizeStatus(status);
  if (s === 'running') return 'pf-m-green';
  if (s === 'paused') return 'pf-m-orange';
  if (s === 'stopped' || s === 'deprovisioned') return 'pf-m-slate';
  if (s === 'error' || s === 'failed') return 'pf-m-red';
  if (s === 'past_due' || s === 'suspended' || s === 'provisioning') return 'pf-m-blue';
  return 'pf-m-grey';
}

function nodeStatusClass(status) {
  var s = normalizeStatus(status);
  if (s === 'online' || s === 'healthy' || s === 'active') return 'pf-m-green';
  if (s === 'offline' || s === 'unreachable' || s === 'down') return 'pf-m-red';
  if (s === 'pending' || s === 'joining') return 'pf-m-blue';
  return 'pf-m-grey';
}

function jobStatusClass(status) {
  var s = normalizeStatus(status);
  if (s === 'completed' || s === 'success' || s === 'succeeded') return 'pf-m-green';
  if (s === 'running' || s === 'in_progress') return 'pf-m-blue';
  if (s === 'queued' || s === 'pending') return 'pf-m-orange';
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'pf-m-red';
  return 'pf-m-grey';
}

function backupStatusClass(status) {
  var s = normalizeStatus(status);
  if (s === 'completed' || s === 'success' || s === 'succeeded') return 'pf-m-green';
  if (s === 'running' || s === 'in_progress' || s === 'pending') return 'pf-m-blue';
  if (s === 'failed' || s === 'error' || s === 'deleted') return 'pf-m-red';
  return 'pf-m-grey';
}

function healthStatusClass(health) {
  var s = normalizeStatus(health);
  if (s === 'healthy' || s === 'ok' || s === 'passing') return 'pf-m-green';
  if (s === 'degraded' || s === 'warning') return 'pf-m-orange';
  if (s === 'unhealthy' || s === 'critical' || s === 'down') return 'pf-m-red';
  return 'pf-m-grey';
}

var DashboardView = {
  template: '\
    <section class="pf-c-page__main-section">\
      <div class="dashboard-hero pf-u-mb-lg">\
        <div>\
          <p class="dashboard-eyebrow">Platform Overview</p>\
          <h1 class="pf-c-title pf-m-2xl">Dashboard</h1>\
          <p class="dashboard-subtitle">Live operational summary for nodes, instances, jobs, and backups.</p>\
        </div>\
        <div class="dashboard-hero-actions">\
          <div class="dashboard-last-updated">Updated {{ lastUpdatedLabel }}</div>\
          <button class="pf-c-button pf-m-secondary" @click="refresh" :disabled="refreshing">\
            <i class="fas" :class="refreshing ? \'fa-spinner fa-spin\' : \'fa-sync-alt\'"></i>{{ refreshing ? "Refreshing..." : "Refresh" }}\
          </button>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading dashboard...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else>\
        <div v-if="visibleAlerts.length" class="dashboard-alerts pf-u-mb-lg">\
          <div v-for="alert in visibleAlerts" :key="alertKey(alert)" class="dashboard-alert-link">\
            <router-link :to="alert.target || \'/dashboard\'" class="dashboard-alert-link__body">\
              <article class="pf-c-alert dashboard-alert" :class="\'pf-m-\' + alert.severity" role="alert">\
                <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
                <div class="dashboard-alert-copy">\
                  <p class="dashboard-alert-title">{{ alert.title }}</p>\
                  <p class="pf-c-alert__title">{{ alert.message }}</p>\
                </div>\
                <span class="dashboard-alert-action">Open</span>\
              </article>\
            </router-link>\
            <button class="dashboard-alert-close" type="button" @click.stop="dismissAlert(alert)" aria-label="Dismiss alert" title="Dismiss alert">X</button>\
          </div>\
        </div>\
        <div class="dashboard-stats-grid pf-u-mb-lg">\
          <div class="dashboard-stat-item">\
            <router-link :to="dashboardLink(\'/instances\')" class="stat-card-link">\
              <div class="pf-c-card pf-m-hoverable stat-card stat-card-blue">\
                <div class="stat-card-icon"><i class="fas fa-cube"></i></div>\
                <div class="stat-card-value">{{ summary.total_instances }}</div>\
                <div class="stat-card-label">Total Instances</div>\
                <div class="stat-card-meta">{{ summary.error_instances }} in error</div>\
              </div>\
            </router-link>\
          </div>\
          <div class="dashboard-stat-item">\
            <router-link :to="dashboardLink(\'/instances\', { status: \'running\' })" class="stat-card-link">\
              <div class="pf-c-card pf-m-hoverable stat-card stat-card-green">\
                <div class="stat-card-icon"><i class="fas fa-play"></i></div>\
                <div class="stat-card-value">{{ summary.running_instances }}</div>\
                <div class="stat-card-label">Running</div>\
                <div class="stat-card-meta">Healthy workload pool</div>\
              </div>\
            </router-link>\
          </div>\
          <div class="dashboard-stat-item">\
            <router-link :to="dashboardLink(\'/instances\', { status: \'stopped\' })" class="stat-card-link">\
              <div class="pf-c-card pf-m-hoverable stat-card stat-card-slate">\
                <div class="stat-card-icon"><i class="fas fa-stop-circle"></i></div>\
                <div class="stat-card-value">{{ summary.stopped_instances }}</div>\
                <div class="stat-card-label">Stopped</div>\
                <div class="stat-card-meta">{{ summary.paused_instances }} paused</div>\
              </div>\
            </router-link>\
          </div>\
          <div class="dashboard-stat-item">\
            <router-link :to="dashboardLink(\'/nodes\')" class="stat-card-link">\
              <div class="pf-c-card pf-m-hoverable stat-card stat-card-slate">\
                <div class="stat-card-icon"><i class="fas fa-server"></i></div>\
                <div class="stat-card-value">{{ summary.active_nodes }}</div>\
                <div class="stat-card-label">Active Nodes</div>\
                <div class="stat-card-meta">{{ summary.offline_nodes }} offline</div>\
              </div>\
            </router-link>\
          </div>\
        </div>\
        <div class="dashboard-capacity-grid pf-u-mb-lg" v-if="hasCapacity">\
          <div class="pf-c-card dashboard-capacity-card">\
            <div class="dashboard-capacity-header">\
              <div class="stat-card-icon stat-card-icon-inline"><i class="fas fa-memory"></i></div>\
              <div>\
                <div class="dashboard-panel-title">RAM Committed</div>\
                <div class="dashboard-panel-meta">{{ formatBytes(capacity.committed_ram_bytes) }} / {{ formatBytes(capacity.total_ram_bytes) }}</div>\
              </div>\
            </div>\
            <div class="dashboard-progress-track"><div class="dashboard-progress-fill dashboard-progress-fill-blue" :style="{ width: capacityPercent(capacity.committed_ram_bytes, capacity.total_ram_bytes) + \'%\' }"></div></div>\
          </div>\
          <div class="pf-c-card dashboard-capacity-card">\
            <div class="dashboard-capacity-header">\
              <div class="stat-card-icon stat-card-icon-inline"><i class="fas fa-database"></i></div>\
              <div>\
                <div class="dashboard-panel-title">Disk Committed</div>\
                <div class="dashboard-panel-meta">{{ formatBytes(capacity.committed_disk_bytes) }} / {{ formatBytes(capacity.total_disk_bytes) }}</div>\
              </div>\
            </div>\
            <div class="dashboard-progress-track"><div class="dashboard-progress-fill dashboard-progress-fill-slate" :style="{ width: capacityPercent(capacity.committed_disk_bytes, capacity.total_disk_bytes) + \'%\' }"></div></div>\
          </div>\
        </div>\
        <div class="pf-c-card pf-u-mb-lg">\
          <div class="pf-c-card__header dashboard-toolbar">\
            <div>\
              <h2 class="pf-c-title pf-m-lg"><i class="fas fa-cube"></i> Instances Overview</h2>\
              <p class="dashboard-panel-meta">Focused view with quick filters across state, app, node and customer.</p>\
            </div>\
            <router-link :to="dashboardLink(\'/instances\', activeInstanceFilters)" class="pf-c-button pf-m-link">Open filtered list</router-link>\
          </div>\
          <div class="pf-c-card__body">\
            <div class="filter-bar dashboard-filter-bar">\
              <label for="dashboard-status-filter">Status</label>\
              <select id="dashboard-status-filter" class="pf-c-form-control" v-model="instanceFilters.status">\
                <option value="">All</option>\
                <option value="running">Running</option>\
                <option value="paused">Paused</option>\
                <option value="error">Error</option>\
                <option value="stopped">Stopped</option>\
              </select>\
              <label for="dashboard-app-filter">App</label>\
              <select id="dashboard-app-filter" class="pf-c-form-control" v-model="instanceFilters.app_definition_name">\
                <option value="">All</option>\
                <option v-for="app in appOptions" :key="app" :value="app">{{ app }}</option>\
              </select>\
              <label for="dashboard-node-filter">Node</label>\
              <select id="dashboard-node-filter" class="pf-c-form-control" v-model="instanceFilters.node_id">\
                <option value="">All</option>\
                <option v-for="node in nodeOptions" :key="node.id" :value="node.id">{{ node.label }}</option>\
              </select>\
              <label for="dashboard-customer-filter">Customer</label>\
              <select id="dashboard-customer-filter" class="pf-c-form-control" v-model="instanceFilters.customer_id">\
                <option value="">All</option>\
                <option v-for="customer in customerOptions" :key="customer" :value="customer">{{ customer }}</option>\
              </select>\
              <button class="pf-c-button pf-m-secondary pf-m-small" @click="clearInstanceFilters" :disabled="!hasInstanceFilters">Reset</button>\
            </div>\
          </div>\
          <div class="pf-c-card__body pf-m-0">\
            <table class="pf-c-table" role="grid">\
              <thead>\
                <tr><th>ID</th><th>Customer</th><th>App</th><th>Node</th><th>Tier</th><th>Status</th><th>Created</th><th>Updated</th></tr>\
              </thead>\
              <tbody>\
                <tr v-for="inst in filteredInstances" :key="inst.id || inst.instance_id" class="dashboard-row-link" @click="goToInstance(inst)">\
                  <td data-label="ID"><router-link :to="\'/instances/\' + (inst.id || inst.instance_id)" class="table-primary-link" :title="inst.id || inst.instance_id" @click.stop>{{ shortId(inst.id || inst.instance_id) }}</router-link></td>\
                  <td data-label="Customer">{{ inst.customer_id || inst.customer || "-" }}</td>\
                  <td data-label="App">{{ inst.app_definition_name || inst.app_id || inst.app || "-" }}</td>\
                  <td data-label="Node">{{ nodeLabel(inst.node_id || inst.node) }}</td>\
                  <td data-label="Tier">{{ inst.tier_name || inst.tier_id || inst.tier || "-" }}</td>\
                  <td data-label="Status"><span class="pf-c-label" :class="instanceStatusClass(inst.status)">{{ inst.status || "unknown" }}</span></td>\
                  <td data-label="Created">{{ formatTimestamp(inst.created_at || inst.created) }}</td>\
                  <td data-label="Updated">{{ formatRelativeTime(inst.updated_at || inst.updated) || "-" }}</td>\
                </tr>\
                <tr v-if="filteredInstances.length === 0">\
                  <td colspan="8" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No instances match the current filters</td>\
                </tr>\
              </tbody>\
            </table>\
          </div>\
        </div>\
        <div class="dashboard-grid">\
          <div class="dashboard-grid-main">\
            <div class="pf-c-card">\
              <div class="pf-c-card__header dashboard-toolbar">\
                <h2 class="pf-c-title pf-m-lg"><i class="fas fa-chart-line"></i> Operational Highlights</h2>\
                <router-link :to="dashboardLink(\'/instances\', { status: \'error\' })" class="pf-c-button pf-m-link">Open errors</router-link>\
              </div>\
              <div class="pf-c-card__body dashboard-highlights">\
                <article class="dashboard-highlight-card dashboard-highlight-card-danger">\
                  <div class="dashboard-highlight-value">{{ summary.error_instances }}</div>\
                  <div class="dashboard-highlight-label">Instances in Error</div>\
                </article>\
                <article class="dashboard-highlight-card dashboard-highlight-card-slate">\
                  <div class="dashboard-highlight-value">{{ summary.stopped_instances }}</div>\
                  <div class="dashboard-highlight-label">Stopped Instances</div>\
                </article>\
                <article class="dashboard-highlight-card dashboard-highlight-card-blue">\
                  <div class="dashboard-highlight-value">{{ summary.failed_jobs }}</div>\
                  <div class="dashboard-highlight-label">Failed Jobs</div>\
                </article>\
                <article class="dashboard-highlight-card dashboard-highlight-card-slate">\
                  <div class="dashboard-highlight-value">{{ summary.failed_backups }}</div>\
                  <div class="dashboard-highlight-label">Failed Backups</div>\
                </article>\
              </div>\
            </div>\
          </div>\
          <div class="dashboard-grid-side">\
            <div class="pf-c-card">\
              <div class="pf-c-card__header dashboard-toolbar">\
                <h2 class="pf-c-title pf-m-lg"><i class="fas fa-tasks"></i> Recent Jobs</h2>\
                <router-link :to="dashboardLink(\'/jobs\')" class="pf-c-button pf-m-link">All jobs</router-link>\
              </div>\
              <div class="pf-c-card__body pf-m-0">\
                <table class="pf-c-table" role="grid">\
                  <thead>\
                    <tr><th>ID</th><th>Type</th><th>Status</th><th>Started</th><th>Duration</th><th>Actions</th></tr>\
                  </thead>\
                  <tbody>\
                    <tr v-for="job in recentJobs" :key="job.id || job.operation_id" class="dashboard-row-link" @click="goToJob(job)">\
                      <td data-label="ID"><router-link :to="job.detail_path" class="table-primary-link" :title="job.id || job.operation_id" @click.stop>{{ shortId(job.id || job.operation_id) }}</router-link></td>\
                      <td data-label="Type">{{ job.type || job.action || "-" }}</td>\
                      <td data-label="Status">\
                        <span class="pf-c-label" :class="jobStatusClass(job.status)">{{ job.status || "unknown" }}</span>\
                        <div v-if="job.progress_percent !== null && job.progress_percent !== undefined" class="dashboard-job-progress">\
                          <div class="dashboard-progress-track dashboard-progress-track-small"><div class="dashboard-progress-fill dashboard-progress-fill-blue" :style="{ width: job.progress_percent + \'%\' }"></div></div>\
                          <span>{{ job.progress_percent }}%</span>\
                        </div>\
                      </td>\
                      <td data-label="Started">{{ formatRelativeTime(job.created_at || job.timestamp) || "-" }}</td>\
                      <td data-label="Duration">{{ formatDuration(job.duration_seconds) }}</td>\
                      <td data-label="Actions">\
                        <router-link :to="job.detail_path" class="pf-c-button pf-m-link" @click.stop>Inspect</router-link>\
                      </td>\
                    </tr>\
                    <tr v-if="recentJobs.length === 0">\
                      <td colspan="6" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No recent jobs</td>\
                    </tr>\
                  </tbody>\
                </table>\
              </div>\
            </div>\
          </div>\
        </div>\
        <div v-if="recentFailedBackups.length" class="pf-c-card pf-u-mt-lg">\
          <div class="pf-c-card__header dashboard-toolbar">\
            <h2 class="pf-c-title pf-m-lg"><i class="fas fa-exclamation-triangle"></i> Recent Failed Backups</h2>\
            <router-link to="/backups" class="pf-c-button pf-m-link">All backups</router-link>\
          </div>\
          <div class="pf-c-card__body pf-m-0">\
            <table class="pf-c-table" role="grid">\
              <thead>\
                <tr><th>ID</th><th>Instance</th><th>Type</th><th>Status</th><th>Created</th><th>Diagnosis</th></tr>\
              </thead>\
              <tbody>\
                <tr v-for="bk in recentFailedBackups" :key="bk.id || bk.backup_id" class="dashboard-row-link" @click="goToBackup(bk)">\
                  <td data-label="ID"><router-link :to="bk.detail_path" class="table-primary-link" :title="bk.id || bk.backup_id" @click.stop>{{ shortId(bk.id || bk.backup_id) }}</router-link></td>\
                  <td data-label="Instance">{{ bk.instance_id || bk.instance || "-" }}</td>\
                  <td data-label="Type">{{ bk.type || bk.backup_type || "-" }}</td>\
                  <td data-label="Status"><span class="pf-c-label" :class="backupStatusClass(bk.status)">{{ bk.status || "unknown" }}</span></td>\
                  <td data-label="Created">{{ formatRelativeTime(bk.created_at || bk.created) || "-" }}</td>\
                  <td data-label="Diagnosis">{{ bk.error_message || bk.error || bk.message || "Unknown" }}</td>\
                </tr>\
              </tbody>\
            </table>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() {
    return {
      loading: true,
      refreshing: false,
      error: null,
      instances: [],
      nodes: [],
      jobs: [],
      backups: [],
      recentJobsData: [],
      capacity: {},
      alerts: [],
      summary: {},
      recentFailedBackups: [],
      lastUpdatedAt: null,
      dismissedAlertKeys: [],
      instanceFilters: { status: '', app_definition_name: '', node_id: '', customer_id: '' }
    };
  },
  computed: {
    hasCapacity: function() {
      return this.capacity && (this.capacity.total_ram_bytes > 0 || this.capacity.total_disk_bytes > 0);
    },
    recentJobs: function() {
      return this.recentJobsData || [];
    },
    appOptions: function() {
      var values = {};
      (this.instances || []).forEach(function(item) {
        var name = item.app_definition_name || item.app_id || item.app;
        if (name) values[name] = true;
      });
      return Object.keys(values).sort();
    },
    customerOptions: function() {
      var values = {};
      (this.instances || []).forEach(function(item) {
        var name = item.customer_id || item.customer;
        if (name) values[name] = true;
      });
      return Object.keys(values).sort();
    },
    nodeOptions: function() {
      return (this.nodes || []).map(function(node) {
        return { id: node.id || node.node_id, label: node.hostname || node.id || node.node_id };
      });
    },
    hasInstanceFilters: function() {
      return !!(this.instanceFilters.status || this.instanceFilters.app_definition_name || this.instanceFilters.node_id || this.instanceFilters.customer_id);
    },
    activeInstanceFilters: function() {
      var filters = {};
      if (this.instanceFilters.status) filters.status = this.instanceFilters.status;
      if (this.instanceFilters.app_definition_name) filters.app_definition_name = this.instanceFilters.app_definition_name;
      if (this.instanceFilters.node_id) filters.node_id = this.instanceFilters.node_id;
      if (this.instanceFilters.customer_id) filters.customer_id = this.instanceFilters.customer_id;
      return filters;
    },
    filteredInstances: function() {
      var filters = this.instanceFilters;
      return (this.instances || []).filter(function(inst) {
        var status = normalizeStatus(inst.status);
        if (filters.status === 'stopped' && !['stopped', 'deprovisioned'].includes(status)) return false;
        if (filters.status && filters.status !== 'stopped' && status !== filters.status) return false;
        if (filters.app_definition_name && (inst.app_definition_name || inst.app_id || inst.app) !== filters.app_definition_name) return false;
        if (filters.node_id && (inst.node_id || inst.node) !== filters.node_id) return false;
        if (filters.customer_id && (inst.customer_id || inst.customer) !== filters.customer_id) return false;
        return true;
      }).slice(0, 6);
    },
    lastUpdatedLabel: function() {
      if (!this.lastUpdatedAt) return 'just now';
      return formatRelativeTime(this.lastUpdatedAt) || 'just now';
    },
    visibleAlerts: function() {
      var dismissed = {};
      (this.dismissedAlertKeys || []).forEach(function(key) {
        dismissed[key] = true;
      });
      return (this.alerts || []).filter(function(alert) {
        return !dismissed[this.alertKey(alert)];
      }, this);
    }
  },
  methods: {
    formatBytes: formatBytes,
    formatTimestamp: formatTimestamp,
    formatRelativeTime: formatRelativeTime,
    formatDuration: formatDuration,
    instanceStatusClass: instanceStatusClass,
    jobStatusClass: jobStatusClass,
    backupStatusClass: backupStatusClass,
    shortId: function(value) {
      var text = value || '-';
      return text.length > 12 ? text.substring(0, 12) + '...' : text;
    },
    dashboardLink: function(path, query) {
      return { path: path, query: query || {} };
    },
    nodeLabel: function(nodeId) {
      var match = (this.nodes || []).find(function(node) { return (node.id || node.node_id) === nodeId; });
      return match ? (match.hostname || match.id || match.node_id) : (nodeId || '-');
    },
    capacityPercent: function(used, total) {
      if (!total) return 0;
      return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
    },
    clearInstanceFilters: function() {
      this.instanceFilters = { status: '', app_definition_name: '', node_id: '', customer_id: '' };
    },
    goToInstance: function(inst) {
      var id = inst.id || inst.instance_id;
      if (id) this.$router.push('/instances/' + id);
    },
    goToJob: function(job) {
      var id = job.id || job.operation_id;
      if (id) this.$router.push('/jobs/' + id);
    },
    goToBackup: function(backup) {
      var id = backup.id || backup.backup_id;
      if (id) this.$router.push('/backups/' + id);
    },
    alertKey: function(alert) {
      return [(alert && alert.title) || '', (alert && alert.message) || '', (alert && alert.target) || ''].join('|');
    },
    loadDismissedAlerts: function() {
      try {
        var raw = window.sessionStorage.getItem('dashboard_dismissed_alerts');
        this.dismissedAlertKeys = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.dismissedAlertKeys = [];
      }
    },
    persistDismissedAlerts: function() {
      try {
        window.sessionStorage.setItem('dashboard_dismissed_alerts', JSON.stringify(this.dismissedAlertKeys || []));
      } catch (e) {
        return;
      }
    },
    dismissAlert: function(alert) {
      var key = this.alertKey(alert);
      if (!key) return;
      if ((this.dismissedAlertKeys || []).indexOf(key) !== -1) return;
      this.dismissedAlertKeys = (this.dismissedAlertKeys || []).concat([key]);
      this.persistDismissedAlerts();
    },
    refresh: async function() {
      this.refreshing = true;
      this.error = null;
      try {
        await this.fetchAll();
      } finally {
        this.refreshing = false;
      }
    },
    fetchAll: async function() {
      var self = this;
      try {
        var data = await bffFetch('/flagship/api/dashboard');
        self.instances = data.instances || [];
        self.nodes = data.nodes || [];
        self.jobs = data.jobs || [];
        self.backups = data.backups || [];
        self.recentJobsData = data.recent_jobs || [];
        self.capacity = data.capacity || {};
        self.alerts = data.alerts || [];
        self.summary = data.summary || {};
        self.recentFailedBackups = data.recent_failed_backups || [];
        self.lastUpdatedAt = new Date().toISOString();
      } catch (e) {
        self.error = e.message;
      }
    }
  },
  mounted: async function() {
    this.loadDismissedAlerts();
    try {
      await this.fetchAll();
    } finally {
      this.loading = false;
    }
  }
};

var NodesView = {
  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <div class="list-header-actions">\
          <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-server"></i> Nodes</h1>\
          <button class="pf-c-button pf-m-primary" @click="showRegisterForm = true" v-if="!showRegisterForm"><i class="fas fa-plus"></i>Register Node</button>\
        </div>\
        <div v-if="showRegisterForm" class="pf-c-card pf-u-mb-lg">\
          <div class="pf-c-card__body">\
            <h3 class="pf-c-title pf-m-md pf-u-mb-md">Register New Node</h3>\
            <form class="pf-c-form pf-m-limit-width" @submit.prevent="registerNode">\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label" for="reg-node-id"><span class="pf-c-form__label-text">Node ID</span></label>\
                <input id="reg-node-id" class="pf-c-form-control" type="text" v-model="regForm.node_id" required placeholder="e.g. node_001">\
              </div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label" for="reg-hostname"><span class="pf-c-form__label-text">Hostname</span></label>\
                <input id="reg-hostname" class="pf-c-form-control" type="text" v-model="regForm.hostname" required placeholder="e.g. worker-1">\
              </div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label" for="reg-ip"><span class="pf-c-form__label-text">IP Address</span></label>\
                <input id="reg-ip" class="pf-c-form-control" type="text" v-model="regForm.ip" required placeholder="e.g. 10.0.0.10">\
              </div>\
              <div class="pf-c-form__group pf-m-action">\
                <button class="pf-c-button pf-m-primary" type="submit" :disabled="regLoading"><i class="fas fa-save pf-u-mr-sm"></i>Register</button>\
                <button class="pf-c-button pf-m-secondary" type="button" @click="cancelRegister">Cancel</button>\
              </div>\
              <div v-if="regError" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mt-md" role="alert">\
                <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle"></i></div>\
                <p class="pf-c-alert__title">{{ regError }}</p>\
              </div>\
              <div v-if="regSuccess" class="pf-c-alert pf-m-success pf-m-inline pf-u-mt-md" role="alert">\
                <div class="pf-c-alert__icon"><i class="fas fa-fw fa-check-circle"></i></div>\
                <p class="pf-c-alert__title">Node registered successfully</p>\
              </div>\
            </form>\
          </div>\
        </div>\
      </div>\
      <div class="pf-c-card pf-u-mb-lg">\
        <div class="filter-bar">\
          <label for="node-filter-status">Status:</label>\
          <select id="node-filter-status" class="pf-c-form-control" v-model="statusFilter">\
            <option value="">All</option>\
            <option value="online">Online</option>\
            <option value="offline">Offline</option>\
            <option value="down">Down</option>\
            <option value="unreachable">Unreachable</option>\
            <option value="pending">Pending</option>\
          </select>\
          <button class="pf-c-button pf-m-secondary" @click="applyFilter"><i class="fas fa-search"></i>Filter</button>\
          <button class="pf-c-button pf-m-link" @click="clearFilters" v-if="statusFilter"><i class="fas fa-times"></i>Clear</button>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading nodes...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else class="pf-c-card">\
        <div class="pf-c-card__body pf-m-0">\
          <table class="pf-c-table" role="grid">\
            <thead>\
              <tr>\
                <th>ID</th>\
                <th>Hostname</th>\
                <th>Status</th>\
                <th>Fleet Agent</th>\
                <th>Health</th>\
                <th>Last Heartbeat</th>\
              </tr>\
            </thead>\
            <tbody>\
              <tr v-for="node in nodes" :key="node.id || node.node_id">\
                <td data-label="ID"><router-link :to="\'/nodes/\' + (node.id || node.node_id)" class="pf-c-button pf-m-link pf-m-inline" :title="node.id || node.node_id" style="font-size:0.8125rem;">{{ node.id || node.node_id || "-" }}</router-link></td>\
                <td data-label="Hostname">{{ node.hostname || node.host || "-" }}</td>\
                <td data-label="Status"><span class="pf-c-label" :class="statusLabelClass(node.status)">{{ node.status || "unknown" }}</span></td>\
                <td data-label="Fleet Agent"><span class="pf-c-label" :class="fleetLabelClass(node)">{{ node.fleet_version ? "v" + node.fleet_version : "Not installed" }}</span></td>\
                <td data-label="Health"><span class="pf-c-label" :class="healthLabelClass(node.health_status)">{{ node.health_status || "-" }}</span></td>\
                <td data-label="Last Heartbeat">{{ node.last_heartbeat || node.heartbeat_at || node.last_seen || "-" }}</td>\
              </tr>\
              <tr v-if="nodes.length === 0">\
                <td colspan="6" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No nodes registered</td>\
              </tr>\
            </tbody>\
          </table>\
        </div>\
        <div class="pf-c-card__footer list-pagination">\
          <span class="list-pagination-summary">Showing {{ pageStart }}-{{ pageEnd }} of {{ total }}</span>\
          <div class="list-pagination-actions">\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page - 1)" :disabled="page <= 1">Previous</button>\
            <span class="list-pagination-page">Page {{ page }}</span>\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page + 1)" :disabled="pageEnd >= total">Next</button>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() {
    return {
      loading: true, error: null, nodes: [], page: 1, pageSize: 10, total: 0, statusFilter: '',
      showRegisterForm: false, regForm: { node_id: '', hostname: '', ip: '' },
      regLoading: false, regError: null, regSuccess: false
    };
  },
  computed: {
    pageStart: function() { return this.total === 0 ? 0 : ((this.page - 1) * this.pageSize) + 1; },
    pageEnd: function() { return Math.min(this.page * this.pageSize, this.total); }
  },
  methods: {
    statusLabelClass: function(status) {
      return nodeStatusClass(status);
    },
    fleetLabelClass: function(node) {
      return node.fleet_version ? 'pf-m-green' : 'pf-m-orange';
    },
    healthLabelClass: function(status) {
      return healthStatusClass(status);
    },
    cancelRegister: function() {
      this.showRegisterForm = false;
      this.regForm = { node_id: '', hostname: '', ip: '' };
      this.regError = null;
      this.regSuccess = false;
    },
    applyFilter: function() {
      this.page = 1;
      this.fetchNodes();
    },
    clearFilters: function() {
      this.statusFilter = '';
      this.page = 1;
      this.fetchNodes();
    },
    registerNode: async function() {
      this.regLoading = true;
      this.regError = null;
      this.regSuccess = false;
      try {
        await bffFetch('/flagship/api/nodes/register', {
          method: 'POST',
          body: JSON.stringify(this.regForm)
        });
        this.regSuccess = true;
        this.regForm = { node_id: '', hostname: '', ip: '' };
        this.fetchNodes();
      } catch (e) {
        this.regError = e.message;
      } finally {
        this.regLoading = false;
      }
    },
    changePage: function(page) {
      if (page < 1 || page === this.page) return;
      this.page = page;
      this.fetchNodes();
    },
    fetchNodes: async function() {
      try {
        var data = await bffFetch(buildPagedUrl('/flagship/api/nodes', this.page, this.pageSize, {
          status: this.statusFilter
        }));
        var paged = normalizePagedData(data, 'nodes');
        this.nodes = paged.items;
        this.page = paged.page;
        this.pageSize = paged.pageSize;
        this.total = paged.total;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: async function() {
    this.statusFilter = this.$route.query.status || '';
    await this.fetchNodes();
  }
};

var NodeDetailView = {
  template: `\
    <section class="pf-c-page__main-section detail-page">\
      <div class="detail-hero">\
        <div class="detail-hero__breadcrumb">\
          <router-link to="/nodes" class="back-link"><i class="fas fa-arrow-left"></i>Nodes</router-link>\
          <span class="detail-muted">/</span>\
          <span>{{ node ? (node.hostname || node.id || "Node Detail") : "Node Detail" }}</span>\
        </div>\
        <div class="detail-hero__header">\
          <div class="detail-hero__copy">\
            <h1 class="pf-c-title pf-m-2xl detail-hero__title">{{ node ? (node.hostname || node.id || "Node Detail") : "Node Detail" }}</h1>\
            <div class="detail-inline-meta">\
              <span class="detail-inline-meta__item"><i class="fas fa-hashtag"></i>{{ node.id || "-" }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-network-wired"></i>{{ node.ip || "-" }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-linux"></i>{{ node.os || "-" }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-server"></i>{{ node.podman_version || "-" }}</span>\
            </div>\
            <div class="detail-badge-row">\
              <span class="pf-c-label" :class="statusLabelClass(node.status)">{{ node.status || "unknown" }}</span>\
              <span class="pf-c-label" :class="node.fleet_version ? 'pf-m-green' : 'pf-m-orange'">{{ node.fleet_version ? ('Fleet v' + node.fleet_version) : 'Fleet not installed' }}</span>\
              <span class="pf-c-label" :class="node.available_for_provisioning ? 'pf-m-green' : 'pf-m-grey'">{{ node.available_for_provisioning ? 'Provisioning enabled' : 'Provisioning disabled' }}</span>\
              <span class="pf-c-label" :class="node.manual_disabled ? 'pf-m-orange' : 'pf-m-blue'">{{ node.manual_disabled ? 'Maintenance mode' : 'Normal mode' }}</span>\
            </div>\
          </div>\
          <div class="detail-hero__actions">\
            <button class="pf-c-button pf-m-secondary" @click="reloadNode" :disabled="loadingAction"><i class="fas fa-sync-alt"></i>Refresh status</button>\
            <button class="pf-c-button pf-m-secondary" @click="toggleMaintenance" :disabled="loadingAction">{{ node.manual_disabled ? 'Exit maintenance' : 'Enter maintenance' }}</button>\
            <button class="pf-c-button pf-m-danger pf-m-secondary" @click="openRemoveModal" :disabled="loadingAction"><i class="fas fa-trash pf-u-mr-xs"></i>Remove node</button>\
          </div>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading node...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else-if="!node" class="pf-u-text-align-center pf-u-color-400 pf-u-py-xl">Node not found</div>\
      <template v-else>\
        <div v-if="nodeIssue" class="detail-callout" :class="'detail-callout--' + nodeIssue.severity">\
          <div class="detail-callout__icon"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i></div>\
          <div class="detail-callout__body">\
            <p class="detail-callout__title">{{ nodeIssue.title }}</p>\
            <p class="detail-callout__text">{{ nodeIssue.text }}</p>\
            <div class="detail-callout__actions">\
              <button v-if="nodeIssue.canRefresh" class="pf-c-button pf-m-secondary pf-m-small" type="button" @click="reloadNode">Refresh status</button>\
              <button v-if="nodeIssue.canToggleMaintenance" class="pf-c-button pf-m-secondary pf-m-small" type="button" @click="toggleMaintenance">{{ node.manual_disabled ? 'Exit maintenance' : 'Enter maintenance' }}</button>\
            </div>\
          </div>\
        </div>\
        <div v-else class="detail-callout detail-callout--success">\
          <div class="detail-callout__icon"><i class="fas fa-check" aria-hidden="true"></i></div>\
          <div class="detail-callout__body">\
            <p class="detail-callout__title">Node ready for provisioning</p>\
            <p class="detail-callout__text">The node is online, reporting metrics, and available for new work.</p>\
          </div>\
        </div>\
        <div class="detail-summary-grid">\
          <div class="pf-c-card detail-summary-card">\
            <div class="pf-c-card__header">\
              <h2 class="detail-section-title"><i class="fas fa-memory"></i>Capacity</h2>\
              <p class="detail-section-meta">Reserved and committed resources on this node.</p>\
            </div>\
            <div class="pf-c-card__body">\
              <div class="detail-summary-list">\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">RAM</div>\
                  <div class="detail-summary-value">\
                    <div class="detail-progress-row">\
                      <div class="detail-progress-label"><span>{{ capacityDisplay(node.ram_used_bytes, node.ram_total_bytes) }}</span><span>{{ capacityPercent(node.ram_used_bytes, node.ram_total_bytes) }}%</span></div>\
                      <div class="dashboard-progress-track dashboard-progress-track-small"><div class="dashboard-progress-fill" :class="ramUsageBarClass" :style="{ width: capacityPercent(node.ram_used_bytes, node.ram_total_bytes) + '%' }"></div></div>\
                      <div class="detail-progress-note">Committed {{ capacityDisplay(node.committed_ram_bytes, node.ram_commit_limit_bytes) }}</div>\
                    </div>\
                  </div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Disk</div>\
                  <div class="detail-summary-value">\
                    <div class="detail-progress-row">\
                      <div class="detail-progress-label"><span>{{ capacityDisplay(node.disk_used_bytes, node.disk_total_bytes) }}</span><span>{{ capacityPercent(node.disk_used_bytes, node.disk_total_bytes) }}%</span></div>\
                      <div class="dashboard-progress-track dashboard-progress-track-small"><div class="dashboard-progress-fill" :class="diskUsageBarClass" :style="{ width: capacityPercent(node.disk_used_bytes, node.disk_total_bytes) + '%' }"></div></div>\
                      <div class="detail-progress-note">Committed {{ capacityDisplay(node.committed_disk_bytes, node.disk_commit_limit_bytes) }}</div>\
                    </div>\
                  </div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Pods</div>\
                  <div class="detail-summary-value">\
                    {{ node.pods_active || 0 }} active · {{ node.pods_paused || 0 }} paused · {{ node.pods_failed || 0 }} failed\
                    <p class="detail-panel-note">The current node API exposes counts, not a per-pod list.</p>\
                  </div>\
                </div>\
              </div>\
            </div>\
          </div>\
          <div class="pf-c-card detail-summary-card">\
            <div class="pf-c-card__header">\
              <h2 class="detail-section-title"><i class="fas fa-server"></i>Node status</h2>\
              <p class="detail-section-meta">Operational summary and the latest timestamps.</p>\
            </div>\
            <div class="pf-c-card__body">\
              <div class="detail-summary-list">\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Fleet agent</div>\
                  <div class="detail-summary-value"><span class="pf-c-label" :class="node.fleet_version ? 'pf-m-green' : 'pf-m-orange'">{{ node.fleet_version ? ('v' + node.fleet_version) : 'Not installed' }}</span></div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Health</div>\
                  <div class="detail-summary-value"><span class="pf-c-label" :class="healthLabelClass(node.health_status)">{{ node.health_status || 'unknown' }}</span></div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Maintenance</div>\
                  <div class="detail-summary-value"><span class="pf-c-label" :class="node.manual_disabled ? 'pf-m-orange' : 'pf-m-green'">{{ node.manual_disabled ? 'Enabled' : 'Disabled' }}</span></div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Provisioning</div>\
                  <div class="detail-summary-value"><span class="pf-c-label" :class="node.available_for_provisioning ? 'pf-m-green' : 'pf-m-grey'">{{ node.available_for_provisioning ? 'Enabled' : 'Disabled' }}</span></div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Last heartbeat</div>\
                  <div class="detail-summary-value">{{ heartbeatLabel }}</div>\
                </div>\
                <div class="detail-summary-row">\
                  <div class="detail-summary-label">Metrics updated</div>\
                  <div class="detail-summary-value">{{ metricsLabel }}</div>\
                </div>\
              </div>\
              <p v-if="node.health_reason_codes && node.health_status !== 'healthy'" class="detail-panel-note">Health reasons: {{ node.health_reason_codes }}</p>\
              <p v-if="node.unavailable_reason_codes" class="detail-panel-note">Unavailable reasons: {{ node.unavailable_reason_codes }}</p>\
            </div>\
          </div>\
        </div>\
        <div class="detail-section-card pf-c-card">\
          <div class="pf-c-card__header detail-table-meta">\
            <div>\
              <h2 class="detail-section-title"><i class="fas fa-boxes"></i>Pods</h2>\
              <p class="detail-section-meta">Pod counters available from the node record.</p>\
            </div>\
            <div class="detail-chip-row">\
              <span class="pf-c-label pf-m-green"><i class="fas fa-play pf-u-mr-xs"></i>{{ node.pods_active || 0 }} Active</span>\
              <span class="pf-c-label pf-m-orange"><i class="fas fa-pause pf-u-mr-xs"></i>{{ node.pods_paused || 0 }} Paused</span>\
              <span class="pf-c-label pf-m-red"><i class="fas fa-times pf-u-mr-xs"></i>{{ node.pods_failed || 0 }} Failed</span>\
            </div>\
          </div>\
          <div class="pf-c-card__body">\
            <div class="empty-state" v-if="(node.pods_active || 0) + (node.pods_paused || 0) + (node.pods_failed || 0) === 0">\
              <p>No pods are currently deployed on this node.</p>\
              <p class="detail-panel-note">Pods will appear here after an application instance is provisioned.</p>\
            </div>\
            <div v-else class="detail-panel-note">The API currently exposes aggregate pod counts. A per-pod table can be added when the backend provides pod records.</div>\
          </div>\
        </div>\
        <div class="detail-section-card pf-c-card">\
          <div class="pf-c-card__header detail-table-meta">\
            <div>\
              <h2 class="detail-section-title"><i class="fas fa-chart-line"></i>Activity & metrics</h2>\
              <p class="detail-section-meta">Latest telemetry and heartbeat timestamps.</p>\
            </div>\
          </div>\
          <div class="pf-c-card__body">\
            <div class="detail-summary-list">\
              <div class="detail-summary-row">\
                <div class="detail-summary-label">Collected at</div>\
                <div class="detail-summary-value">{{ metrics && metrics.collected_at ? formatTimestamp(metrics.collected_at) : 'Not reported' }}</div>\
              </div>\
              <div class="detail-summary-row">\
                <div class="detail-summary-label">Heartbeat age</div>\
                <div class="detail-summary-value">{{ heartbeatAgeLabel }}</div>\
              </div>\
            </div>\
          </div>\
        </div>\
      </template>\
      <div v-if="showRemoveModal" class="admiral-modal-backdrop" @click.self="closeRemoveModal">\
        <div class="admiral-modal" role="dialog" aria-modal="true" aria-labelledby="remove-node-modal-title">\
          <div class="admiral-modal__header">\
            <h2 id="remove-node-modal-title" class="pf-c-title pf-m-xl"><i class="fas fa-trash-alt"></i> Confirm Node Removal</h2>\
            <button class="pf-c-button pf-m-plain" type="button" aria-label="Close remove dialog" @click="closeRemoveModal">\
              <i class="fas fa-times" aria-hidden="true"></i>\
            </button>\
          </div>\
          <div class="admiral-modal__body">\
            <div class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">This removes the node, its routes, backups, and customer apps from the platform. If the node has active instances the operation will be refused unless forced.</p>\
            </div>\
            <dl class="pf-c-description-list compact-description-list">\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Node</dt><dd class="pf-c-description-list__description">{{ node.hostname || node.id }}</dd></div>\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Status</dt><dd class="pf-c-description-list__description">{{ node.status || 'unknown' }}</dd></div>\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Instances</dt><dd class="pf-c-description-list__description">{{ (node.pods_active || 0) + (node.pods_paused || 0) + (node.pods_failed || 0) }} pods</dd></div>\
            </dl>\
            <div class="danger-zone-list-wrapper">\
              <label class="pf-c-form__label" for="remove-confirm-input"><span class="pf-c-form__label-text">Type the node ID to confirm</span></label>\
              <input id="remove-confirm-input" class="pf-c-form-control" type="text" v-model="removeConfirmInput" :placeholder="removeConfirmPlaceholder">\
            </div>\
            <div v-if="removeError" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mt-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">{{ removeError }}</p>\
            </div>\
          </div>\
          <div class="admiral-modal__footer">\
            <button class="pf-c-button pf-m-link" type="button" @click="closeRemoveModal">Cancel</button>\
            <button class="pf-c-button pf-m-danger" type="button" @click="confirmRemove" :disabled="loadingAction || !removeReady">\
              <i class="fas fa-trash"></i>{{ loadingAction ? 'Removing...' : 'Confirm removal' }}\
            </button>\
          </div>\
        </div>\
      </div>\
    </section>`,
  data: function() { return { loading: true, error: null, node: null, metrics: null, loadingAction: false, showRemoveModal: false, removeConfirmInput: '', removeError: '' }; },
  computed: {
    nodeId: function() { return this.$route.params.id; },
    heartbeatLabel: function() {
      return this.node && this.node.last_heartbeat ? formatRelativeTime(this.node.last_heartbeat) || this.formatTimestamp(this.node.last_heartbeat) : 'Never';
    },
    heartbeatAgeLabel: function() {
      return this.node && this.node.last_heartbeat ? (formatRelativeTime(this.node.last_heartbeat) || 'just now') : 'Never';
    },
    metricsLabel: function() {
      return this.metrics && this.metrics.collected_at ? (formatRelativeTime(this.metrics.collected_at) || this.formatTimestamp(this.metrics.collected_at)) : 'Not reported';
    },
    nodeIssue: function() {
      if (!this.node) return null;
      if (!this.node.fleet_version) {
        return {
          severity: 'warning',
          title: 'Fleet agent is not installed',
          text: 'This node cannot receive workloads until Admiral Fleet is installed and the first valid heartbeat is received.',
          canRefresh: true,
          canToggleMaintenance: true
        };
      }
      if (!this.node.last_heartbeat) {
        return {
          severity: 'warning',
          title: 'Waiting for first heartbeat',
          text: 'Fleet Agent appears to be installed, but this node has not reported its status yet.',
          canRefresh: true,
          canToggleMaintenance: true
        };
      }
      var parsed = new Date(this.node.last_heartbeat);
      if (!Number.isNaN(parsed.getTime())) {
        var ageMs = Date.now() - parsed.getTime();
        if (ageMs > 15 * 60 * 1000) {
          return {
            severity: 'warning',
            title: 'Node heartbeat is stale',
            text: 'The last heartbeat was received ' + (formatRelativeTime(this.node.last_heartbeat) || 'some time ago') + '.',
            canRefresh: true,
            canToggleMaintenance: true
          };
        }
      }
      if (this.node.health_status === 'degraded') {
        var reasonText = this.node.health_reason_codes ? (' Reason: ' + this.node.health_reason_codes) : '';
        return {
          severity: 'warning',
          title: 'Node health is degraded',
          text: 'This node is reporting degraded health.' + reasonText,
          canRefresh: true,
          canToggleMaintenance: true
        };
      }
      return null;
    },
    ramUsageBarClass: function() {
      var pct = this.capacityPercent(this.node.ram_used_bytes, this.node.ram_total_bytes);
      if (pct >= 90) return 'dashboard-progress-fill-red';
      if (pct >= 75) return 'dashboard-progress-fill-orange';
      return 'dashboard-progress-fill-green';
    },
    removeReady: function() {
      return (this.removeConfirmInput || '').trim() === this.removeConfirmPlaceholder;
    },
    removeConfirmPlaceholder: function() {
      return this.node ? this.node.id || '' : '';
    },
    diskUsageBarClass: function() {
      var pct = this.capacityPercent(this.node.disk_used_bytes, this.node.disk_total_bytes);
      if (pct >= 90) return 'dashboard-progress-fill-red';
      if (pct >= 75) return 'dashboard-progress-fill-orange';
      return 'dashboard-progress-fill-green';
    }
  },
  methods: {
    formatBytes: formatBytes,
    formatTimestamp: formatTimestamp,
    capacityDisplay: function(used, total) {
      if (!total) return 'Not reported';
      return this.formatBytes(used) + ' / ' + this.formatBytes(total);
    },
    capacityPercent: function(used, total) {
      if (!total) return 0;
      return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
    },
    statusLabelClass: function(status) {
      var s = (status || '').toLowerCase();
      if (s === 'online' || s === 'healthy' || s === 'active') return 'pf-m-green';
      if (s === 'offline' || s === 'unreachable' || s === 'down') return 'pf-m-red';
      if (s === 'pending' || s === 'joining') return 'pf-m-orange';
      return 'pf-m-blue';
    },
    healthLabelClass: function(status) {
      var s = (status || '').toLowerCase();
      if (s === 'healthy' || s === 'ok') return 'pf-m-green';
      if (s === 'degraded' || s === 'warning') return 'pf-m-orange';
      if (s === 'unhealthy' || s === 'critical' || s === 'down') return 'pf-m-red';
      return 'pf-m-blue';
    },
    reloadNode: async function() {
      await this.loadNode();
    },
    openRemoveModal: function() {
      this.showRemoveModal = true;
      this.removeConfirmInput = '';
      this.removeError = '';
    },
    closeRemoveModal: function() {
      this.showRemoveModal = false;
      this.removeConfirmInput = '';
      this.removeError = '';
    },
    confirmRemove: async function() {
      if (!this.node || !this.node.id) return;
      this.loadingAction = true;
      try {
        await bffFetch('/flagship/api/nodes/' + this.node.id, { method: 'DELETE' });
        window.showToast('success', 'Node ' + (this.node.hostname || this.node.id) + ' removed.');
        this.$router.push('/nodes');
      } catch (e) {
        this.removeError = e.message;
      } finally {
        this.loadingAction = false;
      }
    },
    toggleMaintenance: async function() {
      if (!this.node || !this.node.id) return;
      this.loadingAction = true;
      try {
        var action = this.node.manual_disabled ? 'enable' : 'disable';
        var result = await bffFetch('/flagship/api/nodes/' + this.node.id + '/' + action, { method: 'POST' });
        this.node = result.node || this.node;
        window.showToast('success', this.node.manual_disabled ? 'Node moved into maintenance mode' : 'Node returned to normal mode');
        await this.loadNode();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loadingAction = false;
      }
    },
    loadNode: async function() {
      try {
        var data = await bffFetch('/flagship/api/nodes/' + this.nodeId);
        this.node = data.node || null;
        this.metrics = data.metrics || null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: function() { this.loadNode(); }
};

var CatalogAppsView = {

  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <div class="list-header-actions">\
          <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-cubes"></i> App Catalog</h1>\
          <router-link to="/catalog/apps/new" class="pf-c-button pf-m-primary"><i class="fas fa-plus"></i>Create App</router-link>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading catalog...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else class="pf-c-card">\
        <div class="pf-c-card__body pf-m-0">\
          <table class="pf-c-table" role="grid">\
            <thead>\
              <tr>\
                <th>ID</th>\
                <th>Name</th>\
                <th>Status</th>\
                <th>Description</th>\
              </tr>\
            </thead>\
            <tbody>\
              <tr v-for="app in apps" :key="app.id || app.app_id || app.name">\
                <td data-label="ID"><router-link :to="\'/catalog/apps/\' + appRouteId(app)" class="pf-c-button pf-m-link pf-m-inline" style="font-size:0.8125rem;">{{ app.id || app.app_id || app.name || "-" }}</router-link></td>\
                <td data-label="Name"><strong>{{ app.name || app.label || "-" }}</strong></td>\
                <td data-label="Status"><span class="pf-c-label" :class="(app.status || \'\').toLowerCase() === \'active\' ? \'pf-m-green\' : \'pf-m-red\'">{{ (app.status || \'unknown\') === \'active\' ? \'Available\' : \'Unavailable\' }}</span></td>\
                <td data-label="Description">{{ app.description || "-" }}</td>\
              </tr>\
              <tr v-if="apps.length === 0">\
                <td colspan="4" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No apps in catalog</td>\
              </tr>\
            </tbody>\
          </table>\
        </div>\
        <div class="pf-c-card__footer list-pagination">\
          <span class="list-pagination-summary">Showing {{ pageStart }}-{{ pageEnd }} of {{ total }}</span>\
          <div class="list-pagination-actions">\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page - 1)" :disabled="page <= 1">Previous</button>\
            <span class="list-pagination-page">Page {{ page }}</span>\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page + 1)" :disabled="pageEnd >= total">Next</button>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() { return { loading: true, error: null, apps: [], page: 1, pageSize: 10, total: 0 }; },
  computed: {
    pageStart: function() { return this.total === 0 ? 0 : ((this.page - 1) * this.pageSize) + 1; },
    pageEnd: function() { return Math.min(this.page * this.pageSize, this.total); }
  },
  methods: {
    appRouteId: function(app) {
      return app.id || app.app_id || app.name;
    },
    changePage: function(page) {
      if (page < 1 || page === this.page) return;
      this.page = page;
      this.fetchApps();
    },
    fetchApps: async function() {
      try {
        var data = await bffFetch(buildPagedUrl('/flagship/api/catalog/apps', this.page, this.pageSize));
        var paged = normalizePagedData(data, 'apps');
        this.apps = paged.items;
        this.page = paged.page;
        this.pageSize = paged.pageSize;
        this.total = paged.total;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: async function() {
    await this.fetchApps();
  }
};

var CatalogAppDetailView = {
  template: `\
    <section class="pf-c-page__main-section detail-page">\
      <div class="detail-hero">\
        <div class="detail-hero__breadcrumb">\
          <router-link to="/catalog/apps" class="back-link"><i class="fas fa-arrow-left"></i>Apps</router-link>\
          <span class="detail-muted">/</span>\
          <span>{{ app ? (app.name || app.id || 'App Detail') : 'App Detail' }}</span>\
        </div>\
        <div class="detail-hero__header">\
          <div class="detail-hero__copy">\
            <h1 class="pf-c-title pf-m-2xl detail-hero__title">{{ app ? (app.name || app.id || 'App Detail') : 'App Detail' }}</h1>\
            <div class="detail-inline-meta">\
              <span class="detail-inline-meta__item"><i class="fas fa-hashtag"></i>{{ app.id || app.name || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-code-branch"></i>{{ app.version || parsedVersion || 'latest' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-layer-group"></i>{{ versions.length ? versions.length + ' published versions' : 'Single active definition' }}</span>\
            </div>\
            <div class="detail-badge-row">\
              <span class="pf-c-label" :class="statusLabelClass(app.status)">{{ app.status || 'unknown' }}</span>\
              <span class="pf-c-label pf-m-blue">{{ app.created_at || 'No creation timestamp' }}</span>\
            </div>\
          </div>\
          <div class="detail-hero__actions">\
            <router-link :to="\'/catalog/apps/\' + appId + \'/edit\'" class="pf-c-button pf-m-secondary"><i class="fas fa-pen"></i>Edit</router-link>\
            <button class="pf-c-button pf-m-danger" @click="disableApp" :disabled="busy || !canDisable" v-if="canDisable"><i class="fas fa-ban"></i>Disable</button>\
            <button class="pf-c-button pf-m-secondary" @click="enableApp" :disabled="busy || !canEnable" v-if="canEnable"><i class="fas fa-check-circle"></i>Enable</button>\
          </div>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading app...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else-if="!app" class="pf-u-text-align-center pf-u-color-400 pf-u-py-xl">App not found</div>\
      <template v-else>\
        <div class="detail-summary-grid">\
          <div class="detail-stack">\
            <div class="pf-c-card detail-summary-card">\
              <div class="pf-c-card__header">\
                <h2 class="detail-section-title"><i class="fas fa-info-circle"></i>App overview</h2>\
                <p class="detail-section-meta">Definition metadata and the current release surface.</p>\
              </div>\
              <div class="pf-c-card__body">\
                <dl class="pf-c-description-list compact-description-list">\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">ID</dt><dd class="pf-c-description-list__description">{{ app.id || app.name || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Name</dt><dd class="pf-c-description-list__description">{{ app.name || app.label || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Description</dt><dd class="pf-c-description-list__description">{{ app.description || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Version</dt><dd class="pf-c-description-list__description">{{ app.version || parsedVersion || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Versions</dt><dd class="pf-c-description-list__description">{{ versions.length ? versions.join(', ') : 'latest' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Created</dt><dd class="pf-c-description-list__description">{{ app.created_at || '-' }}</dd></div>\
                </dl>\
                <div v-if="actionError" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mt-md" role="alert"><p class="pf-c-alert__title">{{ actionError }}</p></div>\
                <div v-if="actionSuccess" class="pf-c-alert pf-m-success pf-m-inline pf-u-mt-md" role="alert"><p class="pf-c-alert__title">{{ actionSuccess }}</p></div>\
              </div>\
            </div>\
            <div class="pf-c-card detail-section-card">\
              <div class="pf-c-card__header">\
                <h2 class="detail-section-title"><i class="fas fa-layer-group"></i>Tiers</h2>\
                <p class="detail-section-meta">Published size tiers and pricing.</p>\
              </div>\
              <div class="pf-c-card__body">\
                <div v-if="tiersLoading" class="loading-sm"><i class="fas fa-spinner fa-spin"></i> Loading tiers...</div>\
                <div v-else-if="tiers.length === 0" class="pf-u-text-align-center pf-u-color-400" style="padding: 1rem;">No tiers defined</div>\
                <div v-else class="pf-l-grid pf-m-gutter">\
                  <div v-for="tier in tiers" :key="tier.name" class="pf-l-grid__item pf-m-12-col pf-m-6-col-on-md pf-m-4-col-on-lg">\
                    <div class="pf-c-card pf-m-flat tier-card">\
                      <div class="pf-c-card__header">\
                        <h3 class="pf-c-title pf-m-md">{{ tier.name }}</h3>\
                      </div>\
                      <div class="pf-c-card__body">\
                        <div class="tier-stat"><span class="tier-stat-label">CPU</span><span class="tier-stat-value">{{ tier.cpu || '-' }} core</span></div>\
                        <div class="tier-stat"><span class="tier-stat-label">RAM</span><span class="tier-stat-value">{{ tryFormatBytes(tier.memory) }}</span></div>\
                        <div class="tier-stat"><span class="tier-stat-label">Storage</span><span class="tier-stat-value">{{ tryFormatBytes(tier.storage) }}</span></div>\
                      </div>\
                      <div class="pf-c-card__footer">\
                        <strong>\${{ tier.price_monthly ?? '-' }}</strong><span class="pf-u-color-400">/mo</span>\
                      </div>\
                    </div>\
                  </div>\
                </div>\
              </div>\
            </div>\
          </div>\
          <div class="pf-c-card detail-summary-card">\
            <div class="pf-c-card__header">\
              <h2 class="detail-section-title"><i class="fas fa-file-code"></i>Definition YAML</h2>\
              <p class="detail-section-meta">The current source of truth for the app definition.</p>\
            </div>\
            <div class="pf-c-card__body">\
              <pre class="detail-code-block">{{ yamlText || 'No YAML available' }}</pre>\
            </div>\
          </div>\
        </div>\
      </template>\
    </section>`,
  data: function() {
    return {
      loading: true, error: null, app: null, yamlText: '',
      busy: false, actionError: '', actionSuccess: '',
      tiers: [], tiersLoading: false, versions: []
    };
  },
  computed: {
    appId: function() { return this.$route.params.id; },
    canDisable: function() { return (this.app && (this.app.status || '').toLowerCase() !== 'inactive'); },
    canEnable: function() { return (this.app && (this.app.status || '').toLowerCase() === 'inactive'); },
    parsedVersion: function() {
      var match = /^version:\s*([^\n]+)$/m.exec(this.yamlText || '');
      return match ? match[1].trim() : '';
    }
  },
  methods: {
    statusLabelClass: function(status) {
      var s = (status || '').toLowerCase();
      if (s === 'active') return 'pf-m-green';
      if (s === 'inactive') return 'pf-m-red';
      return 'pf-m-blue';
    },
    tryFormatBytes: function(v) {
      if (!v && v !== 0) return "-";
      if (typeof v === 'string') return v;
      var n = Number(v);
      if (isNaN(n) || n <= 0) return "-";
      return formatBytes(n);
    },
    loadApp: async function() {
      try {
        var detail = await bffFetch('/flagship/api/catalog/apps/' + this.appId);
        var yaml = await bffFetch('/flagship/api/catalog/apps/' + this.appId + '/yaml');
        this.app = detail.app || null;
        this.yamlText = yaml.yaml || '';
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },
    loadTiers: async function() {
      this.tiersLoading = true;
      try {
        var data = await bffFetch('/flagship/api/catalog/apps/' + this.appId + '/tiers');
        this.tiers = data.tiers || [];
      } catch (e) {
        this.tiers = [];
      } finally {
        this.tiersLoading = false;
      }
    },
    loadVersions: async function() {
      try {
        var data = await bffFetch('/flagship/api/catalog/apps/' + this.appId + '/versions');
        this.versions = data.versions || [];
      } catch (e) {
        this.versions = [];
      }
    },
    disableApp: async function() {
      if (!confirm('Disable this app definition? New provisioning should stop using it.')) return;
      this.busy = true;
      this.actionError = '';
      this.actionSuccess = '';
      try {
        await bffFetch('/flagship/api/catalog/apps/' + this.appId + '/disable', { method: 'POST' });
        this.actionSuccess = 'App definition disabled';
        await this.loadApp();
      } catch (e) {
        this.actionError = e.message;
      } finally {
        this.busy = false;
      }
    },
    enableApp: async function() {
      if (!confirm('Enable this app definition? It will be available for new provisioning.')) return;
      this.busy = true;
      this.actionError = '';
      this.actionSuccess = '';
      try {
        await bffFetch('/flagship/api/catalog/apps/' + this.appId + '/enable', { method: 'POST' });
        this.actionSuccess = 'App definition enabled';
        await this.loadApp();
      } catch (e) {
        this.actionError = e.message;
      } finally {
        this.busy = false;
      }
    }
  },
  mounted: function() {
    this.loadApp();
    this.loadTiers();
    this.loadVersions();
  }
};

var CatalogAppFormView = {


  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <router-link to="/catalog/apps" class="back-link"><i class="fas fa-arrow-left"></i>Back to Apps</router-link>\
        <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-edit"></i> {{ isEdit ? "Edit App Definition" : "Create App Definition" }}</h1>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading form...</div>\
      <div v-else class="pf-c-card">\
        <div class="pf-c-card__body">\
          <div v-if="error" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert"><p class="pf-c-alert__title">{{ error }}</p></div>\
          <div v-if="success" class="pf-c-alert pf-m-success pf-m-inline pf-u-mb-md" role="alert"><p class="pf-c-alert__title">{{ success }}</p></div>\
          <div class="pf-c-content pf-u-mb-md">\
            <p v-if="isEdit">Saving an edit increments the current <code>version</code> automatically.</p>\
          </div>\
          <div class="pf-c-form__group">\
            <label class="pf-c-form__label" for="app-name"><span class="pf-c-form__label-text">App name</span></label>\
            <input id="app-name" class="pf-c-form-control" type="text" v-model="appName" placeholder="my-app-name" :disabled="isEdit" @input="onNameInput">\
          </div>\
          <div class="pf-c-form__group" v-if="isEdit">\
            <label class="pf-c-form__label" for="app-version"><span class="pf-c-form__label-text">Version</span></label>\
            <input id="app-version" class="pf-c-form-control" type="text" v-model="appVersion" placeholder="1.0.0" @input="onVersionInput">\
          </div>\
          <div class="pf-c-form__group">\
            <label class="pf-c-form__label" for="app-yaml"><span class="pf-c-form__label-text">Application YAML</span></label>\
            <textarea id="app-yaml" class="pf-c-form-control yaml-editor" v-model="yamlText" spellcheck="false"></textarea>\
          </div>\
          <div class="action-buttons pf-u-mt-md">\
            <button class="pf-c-button pf-m-primary" @click="saveApp" :disabled="saving"><i class="fas fa-save"></i>{{ saving ? "Saving..." : "Save" }}</button>\
            <router-link v-if="isEdit" :to="\'/catalog/apps/\' + appId" class="pf-c-button pf-m-link">Cancel</router-link>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() {
    return { loading: false, saving: false, error: '', success: '', yamlText: '', appName: '', appVersion: '' };
  },
  computed: {
    appId: function() { return this.$route.params.id; },
    isEdit: function() { return !!this.appId; }
  },
  methods: {
    extractNameFromYaml: function(text) {
      var match = /^name:\s*(.+)$/m.exec(text || '');
      return match ? match[1].trim() : '';
    },
    setNameInYaml: function(text, name) {
      if (/^name:\s*/m.test(text)) {
        return text.replace(/^name:\s*.*$/m, 'name: ' + name);
      }
      return 'name: ' + name + '\n' + text;
    },
    extractVersionFromYaml: function(text) {
      var match = /^version:\s*(.+)$/m.exec(text || '');
      return match ? match[1].trim() : '';
    },
    setVersionInYaml: function(text, version) {
      if (/^version:\s*/m.test(text)) {
        return text.replace(/^version:\s*.*$/m, 'version: ' + version);
      }
      return text + '\nversion: ' + version;
    },
    onNameInput: function() {
      var name = (this.appName || '').trim();
      if (name) {
        var oldName = this.extractNameFromYaml(this.yamlText);
        if (oldName !== name) {
          this.yamlText = this.setNameInYaml(this.yamlText, name);
        }
      }
    },
    onVersionInput: function() {
      var version = (this.appVersion || '').trim();
      if (version) {
        var oldVersion = this.extractVersionFromYaml(this.yamlText);
        if (oldVersion !== version) {
          this.yamlText = this.setVersionInYaml(this.yamlText, version);
        }
      }
    },
    loadYaml: async function() {
      if (!this.isEdit) {
        this.yamlText = [
          'name: example-app',
          'display_name: Example App',
          'description: Example application definition',
          'version: 1.0.0',
          'services:',
          '  web:',
          '    image: docker.io/example/app:1.0.0',
          '    ports:',
          '      - 8080',
          ''
        ].join('\n');
        this.appName = this.extractNameFromYaml(this.yamlText);
        this.appVersion = this.extractVersionFromYaml(this.yamlText);
        return;
      }
      this.loading = true;
      try {
        var data = await bffFetch('/flagship/api/catalog/apps/' + this.appId + '/yaml');
        this.yamlText = data.yaml || '';
        this.appName = this.extractNameFromYaml(this.yamlText);
        this.appVersion = this.extractVersionFromYaml(this.yamlText);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },
    saveApp: async function() {
      this.saving = true;
      this.error = '';
      this.success = '';
      try {
        var name = (this.appName || '').trim();
        if (!name) {
          throw new Error('App name is required');
        }
        this.yamlText = this.setNameInYaml(this.yamlText, name);
        var version = (this.appVersion || '').trim();
        if (version) {
          this.yamlText = this.setVersionInYaml(this.yamlText, version);
        }
        var payload = { yaml: this.yamlText };
        if (this.isEdit) payload.app_id = this.appId;
        var result = await bffFetch('/flagship/api/catalog/apps/save', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        this.success = this.isEdit && result.version ? ('Saved. Version bumped to ' + result.version) : 'Saved successfully';
        this.$router.push('/catalog/apps/' + (this.isEdit ? this.appId : (result.name || result.id)));
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    }
  },
  mounted: function() { this.loadYaml(); }
};

var InstancesView = {
  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <div class="list-header-actions">\
          <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-cube"></i> Instances</h1>\
          <router-link to="/instances/new" class="pf-c-button pf-m-primary"><i class="fas fa-plus"></i>New Instance</router-link>\
        </div>\
      </div>\
      <div class="pf-c-card pf-u-mb-lg">\
        <div class="filter-bar">\
          <label for="inst-filter-status">Status:</label>\
          <select id="inst-filter-status" class="pf-c-form-control" v-model="statusFilter">\
            <option value="">All</option>\
            <option value="running">Running</option>\
            <option value="paused">Paused</option>\
            <option value="provisioning">Provisioning</option>\
            <option value="error">Error</option>\
            <option value="stopped">Stopped</option>\
            <option value="deprovisioned">Deprovisioned</option>\
            <option value="failed">Failed</option>\
          </select>\
          <label for="inst-filter-customer">Customer:</label>\
          <input id="inst-filter-customer" class="pf-c-form-control" type="text" v-model="customerFilter" placeholder="customer ID">\
          <label for="inst-filter-app">App:</label>\
          <input id="inst-filter-app" class="pf-c-form-control" type="text" v-model="appFilter" placeholder="app name">\
          <button class="pf-c-button pf-m-secondary" @click="applyFilter"><i class="fas fa-search pf-u-mr-sm"></i>Filter</button>\
          <button class="pf-c-button pf-m-link" @click="clearFilters" v-if="hasActiveFilters"><i class="fas fa-times pf-u-mr-sm"></i>Clear</button>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading instances...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else class="pf-c-card">\
        <div class="pf-c-card__body pf-m-0">\
          <table class="pf-c-table" role="grid">\
            <thead>\
              <tr>\
                <th>ID</th>\
                <th>Customer</th>\
                <th>App</th>\
                <th>Node</th>\
                <th>Status</th>\
                <th>Health</th>\
                <th>Actions</th>\
              </tr>\
            </thead>\
            <tbody>\
              <tr v-for="inst in instances" :key="inst.id || inst.instance_id">\
                <td data-label="ID">\
                  <router-link :to="\'/instances/\' + (inst.id || inst.instance_id)" class="pf-c-button pf-m-link pf-m-inline" style="font-size:0.8125rem;" :title="inst.id || inst.instance_id">{{ (inst.id || inst.instance_id || "").substring(0, 12) }}...</router-link>\
                </td>\
                <td data-label="Customer">{{ inst.customer_id || inst.customer || "-" }}</td>\
                <td data-label="App">{{ inst.app_id || inst.app || "-" }}</td>\
                <td data-label="Node">{{ inst.node_id || inst.node || "-" }}</td>\
                <td data-label="Status"><span class="pf-c-label" :class="statusLabelClass(inst.status)">{{ inst.status || "unknown" }}</span></td>\
                <td data-label="Health"><span class="pf-c-label" :class="healthLabelClass(inst.health)">{{ inst.health || "unknown" }}</span></td>\
                <td data-label="Actions">\
                  <div class="action-buttons">\
                    <button v-if="inst.status !== \'running\'" class="pf-c-button pf-m-small pf-m-primary" @click="action(inst, \'resume\')" :disabled="actionLoading[inst.id || inst.instance_id]">\
                      <i class="fas fa-play"></i>Resume\
                    </button>\
                    <button v-if="inst.status === \'running\'" class="pf-c-button pf-m-small pf-m-secondary" @click="action(inst, \'pause\')" :disabled="actionLoading[inst.id || inst.instance_id]">\
                      <i class="fas fa-pause"></i>Pause\
                    </button>\
                    <router-link :to="\'/instances/\' + (inst.id || inst.instance_id)" class="pf-c-button pf-m-small pf-m-link"><i class="fas fa-ellipsis-h"></i>More</router-link>\
                  </div>\
                </td>\
              </tr>\
              <tr v-if="instances.length === 0">\
                <td colspan="7" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No instances found</td>\
              </tr>\
            </tbody>\
          </table>\
        </div>\
        <div class="pf-c-card__footer list-pagination">\
          <span class="list-pagination-summary">Showing {{ pageStart }}-{{ pageEnd }} of {{ total }}</span>\
          <div class="list-pagination-actions">\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page - 1)" :disabled="page <= 1">Previous</button>\
            <span class="list-pagination-page">Page {{ page }}</span>\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page + 1)" :disabled="pageEnd >= total">Next</button>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() { return { loading: true, error: null, instances: [], actionLoading: {}, page: 1, pageSize: 20, total: 0, statusFilter: '', customerFilter: '', appFilter: '' }; },
  computed: {
    pageStart: function() { return this.total === 0 ? 0 : ((this.page - 1) * this.pageSize) + 1; },
    pageEnd: function() { return Math.min(this.page * this.pageSize, this.total); },
    hasActiveFilters: function() { return !!(this.statusFilter || this.customerFilter || this.appFilter); }
  },
  methods: {
    statusLabelClass: function(status) {
      return instanceStatusClass(status);
    },
    healthLabelClass: function(health) {
      return healthStatusClass(health);
    },
    action: async function(inst, actionName) {
      var id = inst.id || inst.instance_id;
      if (!id) return;
      if (!confirm('Are you sure you want to ' + actionName + ' instance ' + id.substring(0, 12) + '...?')) return;
      var self = this;
      self.actionLoading[id] = true;
      try {
        await bffFetch('/flagship/api/instances/' + id + '/action', {
          method: 'POST',
          body: JSON.stringify({ action: actionName })
        });
        await self.fetchInstances();
      } catch (e) {
        window.showToast('danger', 'Action failed: ' + e.message);
      } finally {
        self.actionLoading[id] = false;
      }
    },
    applyFilter: function() {
      this.page = 1;
      this.fetchInstances();
    },
    clearFilters: function() {
      this.statusFilter = '';
      this.customerFilter = '';
      this.appFilter = '';
      this.page = 1;
      this.fetchInstances();
    },
    changePage: function(page) {
      if (page < 1 || page === this.page) return;
      this.page = page;
      this.fetchInstances();
    },
    fetchInstances: async function() {
      var self = this;
      try {
        var params = {};
        if (self.statusFilter) params.status = self.statusFilter;
        if (self.customerFilter) params.customer_id = self.customerFilter;
        if (self.appFilter) params.app_definition_name = self.appFilter;
        var data = await bffFetch(buildPagedUrl('/flagship/api/instances', self.page, self.pageSize, params));
        var paged = normalizePagedData(data, 'instances');
        self.instances = paged.items;
        self.page = paged.page;
        self.pageSize = paged.pageSize;
        self.total = paged.total;
      } catch (e) {
        self.error = e.message;
      }
    }
  },
  mounted: async function() {
    var self = this;
    try {
      self.statusFilter = self.$route.query.status || '';
      self.customerFilter = self.$route.query.customer_id || '';
      self.appFilter = self.$route.query.app_definition_name || '';
      await self.fetchInstances();
    } finally {
      self.loading = false;
    }
  }
};

var InstanceCreateView = {
  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <router-link to="/instances" class="back-link"><i class="fas fa-arrow-left"></i>Back to Instances</router-link>\
        <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-plus"></i> New Instance</h1>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading form...</div>\
      <div v-else class="pf-l-grid pf-m-gutter">\
        <div class="pf-l-grid__item pf-m-12-col pf-m-7-col-on-lg">\
          <div class="pf-c-card">\
            <div class="pf-c-card__body">\
              <div v-if="error" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert"><p class="pf-c-alert__title">{{ error }}</p></div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label"><span class="pf-c-form__label-text">Customer ID</span></label>\
                <input class="pf-c-form-control" type="text" v-model="form.customer_id" placeholder="customer_001">\
              </div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label"><span class="pf-c-form__label-text">App</span></label>\
                <select class="pf-c-form-control" v-model="form.app_id" @change="onAppChange">\
                  <option value="">Select an app</option>\
                  <option v-for="app in activeApps" :key="app.id || app.name" :value="app.id || app.name">{{ app.name || app.id }}</option>\
                </select>\
              </div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label"><span class="pf-c-form__label-text">Tier</span></label>\
                <select class="pf-c-form-control" v-model="form.tier_name" :disabled="tiers.length === 0">\
                  <option value="">Select a tier</option>\
                  <option v-for="tier in tiers" :key="tier.name" :value="tier.name">{{ tier.name }} | CPU {{ tier.cpu }} | RAM {{ tier.memory }} | Storage {{ tier.storage }}</option>\
                </select>\
              </div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label"><span class="pf-c-form__label-text">Node</span></label>\
                <select class="pf-c-form-control" v-model="form.node_id">\
                  <option value="">Select a node</option>\
                  <option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.hostname || node.id }} | {{ node.status }} | {{ node.region || "-" }}</option>\
                </select>\
              </div>\
              <div class="action-buttons">\
                <button class="pf-c-button pf-m-primary" @click="createInstance" :disabled="saving"><i class="fas fa-save"></i>{{ saving ? "Creating..." : "Create Instance" }}</button>\
              </div>\
            </div>\
          </div>\
        </div>\
        <div class="pf-l-grid__item pf-m-12-col pf-m-5-col-on-lg">\
          <div class="pf-c-card">\
            <div class="pf-c-card__header"><h2 class="pf-c-title pf-m-lg">Provisioning Summary</h2></div>\
            <div class="pf-c-card__body">\
              <dl class="pf-c-description-list">\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Customer</dt><dd class="pf-c-description-list__description">{{ form.customer_id || "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">App</dt><dd class="pf-c-description-list__description">{{ selectedAppName || "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Tier</dt><dd class="pf-c-description-list__description">{{ selectedTier ? selectedTier.name : "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">CPU</dt><dd class="pf-c-description-list__description">{{ selectedTier ? selectedTier.cpu : "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Memory</dt><dd class="pf-c-description-list__description">{{ selectedTier ? selectedTier.memory : "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Storage</dt><dd class="pf-c-description-list__description">{{ selectedTier ? selectedTier.storage : "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Node</dt><dd class="pf-c-description-list__description">{{ selectedNodeName || "-" }}</dd></div>\
              </dl>\
            </div>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() {
    return {
      loading: true,
      saving: false,
      error: '',
      apps: [],
      nodes: [],
      tiers: [],
      form: { customer_id: '', app_id: '', tier_name: '', node_id: '' }
    };
  },
  computed: {
    activeApps: function() {
      return this.apps.filter(function(item) { return (item.status || '').toLowerCase() === 'active'; });
    },
    selectedAppName: function() {
      var app = this.apps.find(function(item) { return (item.id || item.name) === this.form.app_id; }, this);
      return app ? (app.name || app.id) : '';
    },
    selectedTier: function() {
      return this.tiers.find(function(item) { return item.name === this.form.tier_name; }, this) || null;
    },
    selectedNodeName: function() {
      var node = this.nodes.find(function(item) { return item.id === this.form.node_id; }, this);
      return node ? (node.hostname || node.id) : '';
    }
  },
  methods: {
    loadForm: async function() {
      try {
        var appsData = await bffFetch(buildPagedUrl('/flagship/api/catalog/apps', 1, 100));
        var nodesData = await bffFetch(buildPagedUrl('/flagship/api/nodes', 1, 100));
        this.apps = normalizePagedData(appsData, 'apps').items;
        this.nodes = normalizePagedData(nodesData, 'nodes').items;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },
    onAppChange: async function() {
      this.form.tier_name = '';
      this.tiers = [];
      if (!this.form.app_id) return;
      try {
        var data = await bffFetch('/flagship/api/catalog/apps/' + this.form.app_id + '/provisioning');
        this.tiers = data.tiers || [];
      } catch (e) {
        this.error = e.message;
      }
    },
    createInstance: async function() {
      this.saving = true;
      this.error = '';
      try {
        var result = await bffFetch('/flagship/api/instances/provision', {
          method: 'POST',
          body: JSON.stringify({
            customer_id: this.form.customer_id,
            app_definition_name: this.form.app_id,
            tier_name: this.form.tier_name,
            node_id: this.form.node_id
          })
        });
        window.showToast('success', 'Provision queued' + (result.operation_id ? ': ' + result.operation_id : ''));
        this.$router.push('/instances');
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    }
  },
  mounted: function() { this.loadForm(); }
};

var InstanceDetailView = {
  template: `\
    <section class="pf-c-page__main-section detail-page">\
      <div class="detail-hero">\
        <div class="detail-hero__breadcrumb">\
          <router-link to="/instances" class="back-link"><i class="fas fa-arrow-left"></i>Instances</router-link>\
          <span class="detail-muted">/</span>\
          <span>{{ instance ? (instance.id || instance.instance_id || 'Instance Detail') : 'Instance Detail' }}</span>\
        </div>\
        <div v-if="instance" class="detail-hero__header">\
          <div class="detail-hero__copy">\
            <h1 class="pf-c-title pf-m-2xl detail-hero__title">{{ instance.id || instance.instance_id || 'Instance Detail' }}</h1>\
            <div class="detail-inline-meta">\
              <span class="detail-inline-meta__item"><i class="fas fa-hashtag"></i>{{ instance.id || instance.instance_id || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-user"></i>{{ instance.customer_id || instance.customer || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-cube"></i>{{ instance.app_definition_name || instance.app_id || instance.app || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-layer-group"></i>{{ instance.tier_name || instance.tier_id || instance.tier || '-' }}</span>\
            </div>\
            <div class="detail-badge-row">\
              <span class="pf-c-label" :class="statusLabelClass(instance.status)">{{ instance.status || 'unknown' }}</span>\
              <span class="pf-c-label" :class="healthLabelClass(instance.health)">{{ instance.health || 'unknown' }}</span>\
              <span class="pf-c-label pf-m-blue">{{ instance.node_id || instance.node || 'No node assigned' }}</span>\
            </div>\
          </div>\
          <div class="detail-hero__actions">\
            <button v-if="instance.status !== 'running'" class="pf-c-button pf-m-primary" @click="doAction('resume')" :disabled="actionBusy"><i class="fas fa-play"></i>Resume</button>\
            <button v-if="instance.status === 'running'" class="pf-c-button pf-m-secondary" @click="doActionWithConfirm('pause')" :disabled="actionBusy"><i class="fas fa-pause"></i>Pause</button>\
            <button class="pf-c-button pf-m-secondary" @click="showDangerZone = !showDangerZone" :aria-expanded="showDangerZone ? 'true' : 'false'"><i class="fas fa-shield-alt"></i>{{ showDangerZone ? 'Hide' : 'Review' }} destructive actions</button>\
          </div>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading instance...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else-if="!instance" class="pf-u-text-align-center pf-u-color-400 pf-u-py-xl">Instance not found</div>\
      <template v-else>\
        <div v-if="actionError" class="detail-callout detail-callout--danger">\
          <div class="detail-callout__icon"><i class="fas fa-exclamation-circle" aria-hidden="true"></i></div>\
          <div class="detail-callout__body">\
            <p class="detail-callout__title">Action failed</p>\
            <p class="detail-callout__text">{{ actionError }}</p>\
          </div>\
        </div>\
        <div class="detail-summary-grid">\
          <div class="pf-c-card detail-summary-card">\
            <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-info-circle"></i>Instance information</h2><p class="detail-section-meta">Operational identity and placement.</p></div>\
            <div class="pf-c-card__body">\
              <dl class="pf-c-description-list compact-description-list">\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">ID</dt><dd class="pf-c-description-list__description">{{ instance.id || instance.instance_id || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Customer</dt><dd class="pf-c-description-list__description">{{ instance.customer_id || instance.customer || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">App</dt><dd class="pf-c-description-list__description">{{ instance.app_definition_name || instance.app_id || instance.app || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Tier</dt><dd class="pf-c-description-list__description">{{ instance.tier_name || instance.tier_id || instance.tier || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Node</dt><dd class="pf-c-description-list__description">{{ instance.node_id || instance.node || '-' }}</dd></div>\
                <div class="pf-c-description-list__group" v-if="instance.port"><dt class="pf-c-description-list__term">Port</dt><dd class="pf-c-description-list__description">{{ instance.port.host_port || instance.port.container_port || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Created</dt><dd class="pf-c-description-list__description">{{ instance.created_at || instance.created || '-' }}</dd></div>\
              </dl>\
            </div>\
          </div>\
          <div class="detail-stack">\
            <div class="pf-c-card detail-summary-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-bolt"></i>Runtime actions</h2><p class="detail-section-meta">Primary controls stay focused on reversible runtime changes.</p></div>\
              <div class="pf-c-card__body">\
                <div class="detail-panel-note">Primary controls stay focused on reversible runtime changes. Destructive operations require an additional review step.</div>\
                <div class="action-buttons pf-u-mt-md">\
                  <button v-if="instance.status !== 'running'" class="pf-c-button pf-m-primary" @click="doAction('resume')" :disabled="actionBusy"><i class="fas fa-play"></i>Resume</button>\
                  <button v-if="instance.status === 'running'" class="pf-c-button pf-m-secondary" @click="doActionWithConfirm('pause')" :disabled="actionBusy"><i class="fas fa-pause"></i>Pause</button>\
                  <button class="pf-c-button pf-m-secondary" @click="openMigrateModal" :disabled="actionBusy"><i class="fas fa-truck"></i>Migrate</button>\
                  <button class="pf-c-button pf-m-secondary" @click="showDangerZone = !showDangerZone" :aria-expanded="showDangerZone ? 'true' : 'false'"><i class="fas fa-shield-alt"></i>{{ showDangerZone ? 'Hide' : 'Review' }} destructive actions</button>\
                </div>\
              </div>\
            </div>\
            <div v-if="showDangerZone" class="pf-c-card detail-section-card danger-zone-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-exclamation-triangle"></i>Danger zone</h2><p class="detail-section-meta">Deprovision is intentionally secondary and audited.</p></div>\
              <div class="pf-c-card__body">\
                <p class="danger-zone-copy">Deprovision is treated as an exceptional operation. This flow is intentionally secondary, audited, and designed to slow down accidental data loss.</p>\
                <ul class="danger-zone-list">\
                  <li>Backups found for this instance: <strong>{{ backupCountLabel }}</strong></li>\
                  <li v-if="latestBackupTimestamp">Latest backup: <strong>{{ formatTimestamp(latestBackupTimestamp) }}</strong></li>\
                  <li>Server-side permission checks and audit logging are required before the request is accepted.</li>\
                  <li>Prefer this only when pause, restore, or other recovery paths are not appropriate.</li>\
                </ul>\
                <div class="action-buttons">\
                  <button class="pf-c-button pf-m-danger danger-mobile-hide" @click="openDeprovisionModal" :disabled="actionBusy"><i class="fas fa-trash"></i>Review deprovision</button>\
                </div>\
                <div class="pf-c-alert pf-m-warning pf-m-inline pf-u-mt-md mobile-readonly-note" role="alert">\
                  <div class="pf-c-alert__icon"><i class="fas fa-fw fa-mobile-alt" aria-hidden="true"></i></div>\
                  <p class="pf-c-alert__title">Mobile keeps this area informational. Destructive actions stay hidden on small screens.</p>\
                </div>\
              </div>\
            </div>\
            <div class="pf-c-card detail-section-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-exchange-alt"></i>Change tier</h2><p class="detail-section-meta">Adjust the instance size without deprovisioning.</p></div>\
              <div class="pf-c-card__body">\
                <div v-if="tiersLoading" class="loading-sm"><i class="fas fa-spinner fa-spin"></i> Loading tiers...</div>\
                <template v-else>\
                  <div class="pf-c-form__group pf-u-mb-md">\
                    <select class="pf-c-form-control" v-model="selectedTier">\
                      <option value="">Select new tier</option>\
                      <option v-for="t in tiers" :key="t.name" :value="t.name">{{ t.name }} | CPU {{ t.cpu }} | RAM {{ tryFormatBytes(t.memory) }} | Storage {{ tryFormatBytes(t.storage) }} | \${{ t.price_monthly || '?' }}/mo</option>\
                    </select>\
                  </div>\
                  <button class="pf-c-button pf-m-secondary" @click="doResize" :disabled="!selectedTier || resizeBusy"><i class="fas fa-save pf-u-mr-sm"></i>{{ resizeBusy ? 'Applying...' : 'Apply tier change' }}</button>\
                  <div v-if="resizeResult" class="pf-c-alert pf-m-success pf-m-inline pf-u-mt-sm" role="alert"><p class="pf-c-alert__title">{{ resizeResult }}</p></div>\
                </template>\
              </div>\
            </div>\
            <div class="pf-c-card detail-section-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-database"></i>Backups</h2><p class="detail-section-meta">Operational backup actions for this instance.</p></div>\
              <div class="pf-c-card__body">\
                <div class="action-buttons">\
                  <button class="pf-c-button pf-m-secondary" @click="triggerBackup('database')" :disabled="backupBusy"><i class="fas fa-database"></i>Trigger database backup</button>\
                  <button class="pf-c-button pf-m-secondary" @click="triggerBackup('volumes')" :disabled="backupBusy"><i class="fas fa-hdd"></i>Trigger volume backup</button>\
                  <router-link :to="'/instances/' + instanceId + '/restore'" class="pf-c-button pf-m-secondary"><i class="fas fa-history"></i>Request restore</router-link>\
                </div>\
                <div v-if="backupError" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mt-sm" role="alert"><div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div><p class="pf-c-alert__title">{{ backupError }}</p></div>\
                <div v-if="backupSuccess" class="pf-c-alert pf-m-success pf-m-inline pf-u-mt-sm" role="alert"><div class="pf-c-alert__icon"><i class="fas fa-fw fa-check-circle" aria-hidden="true"></i></div><p class="pf-c-alert__title">{{ backupSuccess }}</p></div>\
              </div>\
            </div>\
          </div>\
        </div>\
        <div class="pf-c-card detail-section-card">\
          <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-clipboard-list"></i>Recent operations</h2><p class="detail-section-meta">Recent task history for the instance.</p></div>\
          <div class="pf-c-card__body pf-m-0">\
            <div v-if="opsLoading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading operations...</div>\
            <table v-else class="pf-c-table" role="grid">\
              <thead>\
                <tr><th>ID</th><th>Action</th><th>Status</th><th>Error</th><th>Updated</th></tr>\
              </thead>\
              <tbody>\
                <tr v-for="op in operations" :key="op.id || op.operation_id">\
                  <td data-label="ID" :title="op.id || op.operation_id">{{ (op.id || op.operation_id || '').substring(0, 12) }}...</td>\
                  <td data-label="Action">{{ op.action || op.type || '-' }}</td>\
                  <td data-label="Status"><span class="pf-c-label" :class="jobStatusLabelClass(op.status)">{{ op.status || 'unknown' }}</span></td>\
                  <td data-label="Error">{{ op.error_message || op.error || '-' }}</td>\
                  <td data-label="Updated">{{ op.updated_at || op.created_at || '-' }}</td>\
                </tr>\
                <tr v-if="operations.length === 0">\
                  <td colspan="5" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No operations found for this instance</td>\
                </tr>\
              </tbody>\
            </table>\
          </div>\
        </div>\
      </template>\
      <div v-if="showDeprovisionModal" class="admiral-modal-backdrop" @click.self="closeDeprovisionModal">\
        <div class="admiral-modal" role="dialog" aria-modal="true" aria-labelledby="deprovision-modal-title">\
          <div class="admiral-modal__header">\
            <h2 id="deprovision-modal-title" class="pf-c-title pf-m-xl"><i class="fas fa-trash-alt"></i> Confirm Instance Deprovision</h2>\
            <button class="pf-c-button pf-m-plain" type="button" aria-label="Close deprovision dialog" @click="closeDeprovisionModal">\
              <i class="fas fa-times" aria-hidden="true"></i>\
            </button>\
          </div>\
          <div class="admiral-modal__body">\
            <div class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">This removes the instance from the platform and may make customer data unavailable.</p>\
            </div>\
            <dl class="pf-c-description-list compact-description-list">\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Instance</dt><dd class="pf-c-description-list__description">{{ instanceId }}</dd></div>\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Current status</dt><dd class="pf-c-description-list__description">{{ instance.status || 'unknown' }}</dd></div>\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Backups available</dt><dd class="pf-c-description-list__description">{{ backupCountLabel }}</dd></div>\
              <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Audit</dt><dd class="pf-c-description-list__description">The backend must validate permission and record the operation before execution.</dd></div>\
            </dl>\
            <div class="danger-zone-list-wrapper">\
              <p class="detail-section-note">Before continuing, verify that the customer impact is understood and that a recoverable backup exists when needed.</p>\
              <label class="pf-c-form__label" for="deprovision-confirm-input"><span class="pf-c-form__label-text">Type the instance ID to confirm</span></label>\
              <input id="deprovision-confirm-input" class="pf-c-form-control" type="text" v-model="deprovisionConfirmInput" :placeholder="instanceId">\
            </div>\
            <div v-if="deprovisionError" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mt-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">{{ deprovisionError }}</p>\
            </div>\
          </div>\
          <div class="admiral-modal__footer">\
            <button class="pf-c-button pf-m-link" type="button" @click="closeDeprovisionModal">Cancel</button>\
            <button class="pf-c-button pf-m-danger" type="button" @click="confirmDeprovision" :disabled="actionBusy || !deprovisionReady">\
              <i class="fas fa-trash"></i>{{ actionBusy ? 'Submitting...' : 'Confirm deprovision' }}\
            </button>\
          </div>\
        </div>\
      </div>\
      <div v-if="showMigrateModal" class="admiral-modal-backdrop" @click.self="closeMigrateModal">\
        <div class="admiral-modal" role="dialog" aria-modal="true" aria-labelledby="migrate-modal-title">\
          <div class="admiral-modal__header">\
            <h2 id="migrate-modal-title" class="pf-c-title pf-m-xl"><i class="fas fa-truck"></i> Migrate Instance</h2>\
            <button class="pf-c-button pf-m-plain" type="button" aria-label="Close migrate dialog" @click="closeMigrateModal">\
              <i class="fas fa-times" aria-hidden="true"></i>\
            </button>\
          </div>\
          <div class="admiral-modal__body">\
            <div class="pf-c-alert pf-m-info pf-m-inline pf-u-mb-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-info-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">Migrate this instance to a different worker node. The instance will be moved to the selected node.</p>\
            </div>\
            <div class="pf-c-form__group pf-u-mb-md">\
              <label class="pf-c-form__label" for="migrate-node-select"><span class="pf-c-form__label-text">Target node</span></label>\
              <select v-if="availableNodes.length > 0" id="migrate-node-select" class="pf-c-form-control" v-model="migrateNodeId">\
                <option value="">Select a target node</option>\
                <option v-for="node in availableNodes" :key="node.id" :value="node.id" :disabled="node.id === (instance.node_id || '').trim()">{{ (node.hostname || node.id) }} | {{ node.status || 'unknown' }} {{ node.id === (instance.node_id || '').trim() ? '(current)' : '' }}</option>\
              </select>\
              <div v-else class="loading-sm"><i class="fas fa-spinner fa-spin"></i> Loading available nodes...</div>\
            </div>\
            <div v-if="migrateError" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mt-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">{{ migrateError }}</p>\
            </div>\
            <div v-if="migrateSuccess" class="pf-c-alert pf-m-success pf-m-inline pf-u-mt-md" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-check-circle" aria-hidden="true"></i></div>\
              <p class="pf-c-alert__title">{{ migrateSuccess }}</p>\
            </div>\
          </div>\
          <div class="admiral-modal__footer">\
            <button class="pf-c-button pf-m-link" type="button" @click="closeMigrateModal">Cancel</button>\
            <button class="pf-c-button pf-m-primary" type="button" @click="doMigrate" :disabled="migrateBusy || !migrateNodeId">\
              <i class="fas fa-truck"></i>{{ migrateBusy ? 'Migrating...' : 'Start migration' }}\
            </button>\
          </div>\
        </div>\
      </div>\
    </section>`,
  data: function() {
    return {
      loading: true, error: null, instance: null,
      actionBusy: false, actionError: '',
      backupBusy: false, backupError: '', backupSuccess: '',
      tiers: [], tiersLoading: false, selectedTier: '', resizeBusy: false, resizeResult: '',
      operations: [], opsLoading: false,
      showDangerZone: false, showDeprovisionModal: false, deprovisionConfirmInput: '', deprovisionError: '',
      showMigrateModal: false, migrateNodeId: '', migrateBusy: false, migrateError: '', migrateSuccess: '', availableNodes: [],
      instanceBackups: [], backupsLoading: false
    };
  },
  watch: {
    showDeprovisionModal: function(open) {
      if (!open) {
        this.deprovisionConfirmInput = '';
        this.deprovisionError = '';
      }
    },
    showMigrateModal: function(open) {
      if (open) {
        this.migrateNodeId = '';
        this.migrateError = '';
        this.migrateSuccess = '';
        this.loadAvailableNodes();
      }
    }
  },
  methods: {
    formatTimestamp: formatTimestamp,
    tryFormatBytes: function(v) {
      if (!v && v !== 0) return "-";
      if (typeof v === 'string') return v;
      var n = Number(v);
      if (isNaN(n) || n <= 0) return "-";
      return formatBytes(n);
    },
    statusLabelClass: function(status) {
      return instanceStatusClass(status);
    },
    jobStatusLabelClass: function(status) {
      return jobStatusClass(status);
    },
    healthLabelClass: function(health) {
      return healthStatusClass(health);
    },
    doActionWithConfirm: function(actionName) {
      if (!confirm('Confirm ' + actionName + ' for instance ' + this.instanceId + '?')) return;
      this.doAction(actionName);
    },
    openDeprovisionModal: function() {
      this.showDeprovisionModal = true;
    },
    closeDeprovisionModal: function() {
      this.showDeprovisionModal = false;
    },
    openMigrateModal: function() {
      this.showMigrateModal = true;
    },
    closeMigrateModal: function() {
      this.showMigrateModal = false;
    },
    doMigrate: async function() {
      var id = this.instanceId;
      if (!id || !this.migrateNodeId) return;
      this.migrateBusy = true;
      this.migrateError = '';
      this.migrateSuccess = '';
      try {
        var result = await bffFetch('/flagship/api/instances/' + id + '/migrate', {
          method: 'POST',
          body: JSON.stringify({ node_id: this.migrateNodeId })
        });
        this.migrateSuccess = 'Migration queued successfully' + (result.operation_id ? ' (operation: ' + result.operation_id + ')' : '');
        window.showToast('success', 'Migration queued for instance ' + id);
        setTimeout(this.closeMigrateModal, 2000);
      } catch (e) {
        this.migrateError = e.message;
        window.showToast('danger', 'Migration failed: ' + e.message);
      } finally {
        this.migrateBusy = false;
      }
    },
    loadAvailableNodes: async function() {
      try {
        var data = await bffFetch('/flagship/api/nodes?page=1&page_size=1000');
        this.availableNodes = normalizePagedData(data, 'nodes').items || data.nodes || [];
      } catch (e) {
        this.availableNodes = [];
      }
    },
    confirmDeprovision: function() {
      if (!this.deprovisionReady) {
        this.deprovisionError = 'Type the exact instance ID before continuing.';
        return;
      }
      this.deprovisionError = '';
      this.doAction('deprovision');
    },
    doAction: async function(actionName) {
      var id = this.instanceId;
      if (!id) return;
      this.actionBusy = true;
      this.actionError = '';
      try {
        await bffFetch('/flagship/api/instances/' + id + '/action', {
          method: 'POST',
          body: JSON.stringify({ action: actionName })
        });
        if (actionName === 'deprovision') {
          this.showDangerZone = false;
          this.closeDeprovisionModal();
          window.showToast('success', 'Deprovision request submitted for audit and execution');
        }
        await this.loadInstance();
        await this.loadOperations();
      } catch (e) {
        if (actionName === 'deprovision') this.deprovisionError = e.message;
        this.actionError = e.message;
      } finally {
        this.actionBusy = false;
      }
    },
    doResize: async function() {
      var id = this.instanceId;
      if (!id || !this.selectedTier) return;
      this.resizeBusy = true;
      this.resizeResult = '';
      try {
        await bffFetch('/flagship/api/instances/' + id + '/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'resize', tier: this.selectedTier })
        });
        this.resizeResult = 'Tier change to "' + this.selectedTier + '" queued successfully';
        this.selectedTier = '';
        await this.loadInstance();
        await this.loadOperations();
      } catch (e) {
        this.resizeResult = '';
        this.actionError = e.message;
      } finally {
        this.resizeBusy = false;
      }
    },
    loadTiers: async function() {
      var id = this.instanceId;
      if (!id) return;
      this.tiersLoading = true;
      try {
        var data = await bffFetch('/flagship/api/instances/' + id + '/tiers');
        this.tiers = data.tiers || [];
      } catch (e) {
        this.tiers = [];
      } finally {
        this.tiersLoading = false;
      }
    },
    loadOperations: async function() {
      var id = this.instanceId;
      if (!id) return;
      this.opsLoading = true;
      try {
        var data = await bffFetch('/flagship/api/instances/' + id + '/operations');
        this.operations = data.operations || [];
      } catch (e) {
        this.operations = [];
      } finally {
        this.opsLoading = false;
      }
    },
    loadBackups: async function() {
      var id = this.instanceId;
      if (!id) return;
      this.backupsLoading = true;
      try {
        var data = await bffFetch(buildPagedUrl('/flagship/api/backups', 1, 50, { instance_id: id }));
        this.instanceBackups = normalizePagedData(data, 'backups').items || [];
      } catch (e) {
        this.instanceBackups = [];
      } finally {
        this.backupsLoading = false;
      }
    },
    triggerBackup: async function(kind) {
      var id = this.instanceId;
      if (!id) return;
      kind = kind || 'database';
      this.backupBusy = true;
      this.backupError = '';
      this.backupSuccess = '';
      try {
        var result = await bffFetch('/flagship/api/backups/trigger', {
          method: 'POST',
          body: JSON.stringify({ instance_id: id, kind: kind })
        });
        window.showToast('success', kind.charAt(0).toUpperCase() + kind.slice(1) + ' backup triggered' + (result.operation_id ? ' (operation: ' + result.operation_id + ')' : ''));
        this.backupSuccess = kind.charAt(0).toUpperCase() + kind.slice(1) + ' backup triggered successfully' + (result.operation_id ? ' (operation: ' + result.operation_id + ')' : '');
      } catch (e) {
        this.backupError = e.message;
        window.showToast('danger', 'Backup failed: ' + e.message);
      } finally {
        this.backupBusy = false;
      }
    },
    loadInstance: async function() {
      var id = this.instanceId;
      if (!id) return;
      try {
        var data = await bffFetch('/flagship/api/instances/' + id);
        this.instance = data.instance || data.data || data || null;
      } catch (e) {
        this.error = e.message;
      }
    }
  },
  computed: {
    instanceId: function() { return this.$route.params.id; },
    backupCountLabel: function() {
      if (this.backupsLoading) return 'checking...';
      return String((this.instanceBackups || []).length);
    },
    latestBackupTimestamp: function() {
      var items = (this.instanceBackups || []).slice().sort(function(a, b) {
        return String(b.created_at || b.created || b.timestamp || '').localeCompare(String(a.created_at || a.created || a.timestamp || ''));
      });
      var latest = items[0];
      return latest ? (latest.created_at || latest.created || latest.timestamp || '') : '';
    },
    deprovisionReady: function() {
      return (this.deprovisionConfirmInput || '').trim() === this.instanceId;
    }
  },
  mounted: async function() {
    var self = this;
    try {
      await self.loadInstance();
      await self.loadTiers();
      await self.loadOperations();
      await self.loadBackups();
    } finally {
      self.loading = false;
    }
  }
};

var InstanceRestoreView = {

  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <router-link :to="\'/instances/\' + instanceId" class="back-link"><i class="fas fa-arrow-left"></i>Back to Instance</router-link>\
        <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-history"></i> Request Restore</h1>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading restore form...</div>\
      <div v-else class="pf-l-grid pf-m-gutter">\
        <div class="pf-l-grid__item pf-m-12-col pf-m-7-col-on-lg">\
          <div class="pf-c-card">\
            <div class="pf-c-card__body">\
              <div v-if="error" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert"><p class="pf-c-alert__title">{{ error }}</p></div>\
              <div v-if="success" class="pf-c-alert pf-m-success pf-m-inline pf-u-mb-md" role="alert"><p class="pf-c-alert__title">{{ success }}</p></div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label"><span class="pf-c-form__label-text">Target Instance</span></label>\
                <input class="pf-c-form-control" type="text" :value="instance ? (instance.id || instance.instance_id) : instanceId" disabled>\
              </div>\
              <div class="pf-c-form__group">\
                <label class="pf-c-form__label"><span class="pf-c-form__label-text">Backup</span></label>\
                <select class="pf-c-form-control" v-model="form.backup_id">\
                  <option value="">Select a backup</option>\
                  <option v-for="backup in backups" :key="backup.id || backup.backup_id" :value="backup.id || backup.backup_id">\
                    {{ backupLabel(backup) }}\
                  </option>\
                </select>\
              </div>\
              <div class="action-buttons">\
                <button class="pf-c-button pf-m-primary" @click="requestRestore" :disabled="submitting || !form.backup_id">\
                  <i class="fas fa-history"></i>{{ submitting ? "Submitting..." : "Request Restore" }}\
                </button>\
              </div>\
            </div>\
          </div>\
        </div>\
        <div class="pf-l-grid__item pf-m-12-col pf-m-5-col-on-lg">\
          <div class="pf-c-card">\
            <div class="pf-c-card__header"><h2 class="pf-c-title pf-m-lg">Restore Summary</h2></div>\
            <div class="pf-c-card__body">\
              <dl class="pf-c-description-list">\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Instance</dt><dd class="pf-c-description-list__description">{{ instance ? (instance.id || instance.instance_id) : instanceId }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">App</dt><dd class="pf-c-description-list__description">{{ instance ? (instance.app_id || instance.app || "-") : "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Selected Backup</dt><dd class="pf-c-description-list__description">{{ selectedBackup ? backupLabel(selectedBackup) : "-" }}</dd></div>\
              </dl>\
            </div>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() {
    return { loading: true, submitting: false, error: '', success: '', instance: null, backups: [], form: { backup_id: '' } };
  },
  computed: {
    instanceId: function() { return this.$route.params.id; },
    selectedBackup: function() {
      return this.backups.find(function(item) { return (item.id || item.backup_id) === this.form.backup_id; }, this) || null;
    }
  },
  methods: {
    backupLabel: function(backup) {
      return (backup.id || backup.backup_id || '-') + ' | ' +
        (backup.type || backup.backup_type || 'database') + ' | ' +
        (backup.status || 'unknown') + ' | ' +
        (backup.created_at || backup.created || backup.timestamp || '-');
    },
    loadPage: async function() {
      try {
        var instanceData = await bffFetch('/flagship/api/instances/' + this.instanceId);
        var backupsData = await bffFetch(buildPagedUrl('/flagship/api/backups', 1, 100, { instance_id: this.instanceId }));
        this.instance = instanceData.instance || instanceData || null;
        this.backups = normalizePagedData(backupsData, 'backups').items;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },
    requestRestore: async function() {
      this.submitting = true;
      this.error = '';
      this.success = '';
      try {
        var result = await bffFetch('/flagship/api/backups/restore', {
          method: 'POST',
          body: JSON.stringify({
            backup_id: this.form.backup_id,
            target_app_id: this.instanceId
          })
        });
        this.success = 'Restore requested' + (result.operation_id ? ' (' + result.operation_id + ')' : '');
      } catch (e) {
        this.error = e.message;
      } finally {
        this.submitting = false;
      }
    }
  },
  mounted: function() { this.loadPage(); }
};

var BackupsView = {
  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <div class="list-header-actions">\
          <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-database"></i> Backups</h1>\
          <div class="action-buttons">\
            <router-link to="/backups/settings" class="pf-c-button pf-m-secondary pf-m-small"><i class="fas fa-cog"></i>Settings</router-link>\
            <button class="pf-c-button pf-m-secondary pf-m-small danger-mobile-hide" @click="pruneBackups" :disabled="pruneBusy"><i class="fas fa-compress-alt"></i>{{ pruneBusy ? "Pruning..." : "Prune Old" }}</button>\
          </div>\
        </div>\
      </div>\
      <div class="pf-c-card pf-u-mb-lg">\
        <div class="filter-bar">\
          <label for="backup-filter-instance">Instance ID:</label>\
          <input id="backup-filter-instance" class="pf-c-form-control" type="text" v-model="instanceFilter" placeholder="Filter by instance ID">\
          <button class="pf-c-button pf-m-secondary" @click="applyFilter"><i class="fas fa-search"></i>Filter</button>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading backups...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else class="pf-c-card">\
        <div class="pf-c-card__body pf-m-0">\
          <table class="pf-c-table" role="grid">\
            <thead>\
              <tr>\
                <th>ID</th>\
                <th>Instance</th>\
                <th>Node</th>\
                <th>Location</th>\
                <th>Type</th>\
                <th>Status</th>\
                <th>Created</th>\
                <th>Size</th>\
                <th>Actions</th>\
              </tr>\
            </thead>\
            <tbody>\
              <tr v-for="b in backups" :key="b.id || b.backup_id">\
                <td data-label="ID"><router-link :to="\'/backups/\' + (b.id || b.backup_id)" class="pf-c-button pf-m-link pf-m-inline" :title="b.id || b.backup_id" style="font-size:0.8125rem;">{{ (b.id || b.backup_id || "").substring(0, 12) }}...</router-link></td>\
                <td data-label="Instance">{{ b.instance_id || b.instance || "-" }}</td>\
                <td data-label="Node">{{ b.node_id || b.node || "-" }}</td>\
                <td data-label="Location">{{ b.storage_key || b.location || b.uri || b.storage_location || b.storage_backend || "local" }}</td>\
                <td data-label="Type">{{ b.type || b.backup_type || "database" }}</td>\
                <td data-label="Status"><span class="pf-c-label" :class="statusLabelClass(b.status)">{{ b.status || "unknown" }}</span></td>\
                <td data-label="Created">{{ b.created_at || b.created || b.timestamp || "-" }}</td>\
                <td data-label="Size">{{ formatBytes(b.size_bytes || b.size) }}</td>\
                <td data-label="Actions">\
                  <button class="pf-c-button pf-m-small pf-m-danger danger-mobile-hide" @click="deleteBackup(b)" :disabled="deleteLoading[b.id || b.backup_id]"><i class="fas fa-trash"></i></button>\
                </td>\
              </tr>\
              <tr v-if="backups.length === 0">\
                <td colspan="9" class="pf-u-text-align-center pf-u-color-400" style="padding: 2rem;">No backups found</td>\
              </tr>\
            </tbody>\
          </table>\
        </div>\
        <div class="pf-c-card__footer list-pagination">\
          <span class="list-pagination-summary">Showing {{ pageStart }}-{{ pageEnd }} of {{ total }}</span>\
          <div class="list-pagination-actions">\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page - 1)" :disabled="page <= 1">Previous</button>\
            <span class="list-pagination-page">Page {{ page }}</span>\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page + 1)" :disabled="pageEnd >= total">Next</button>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() { return { loading: true, error: null, backups: [], instanceFilter: '', page: 1, pageSize: 20, total: 0, pruneBusy: false, deleteLoading: {} }; },
  computed: {
    pageStart: function() { return this.total === 0 ? 0 : ((this.page - 1) * this.pageSize) + 1; },
    pageEnd: function() { return Math.min(this.page * this.pageSize, this.total); }
  },
  methods: {
    formatBytes: formatBytes,
    statusLabelClass: function(status) {
      var s = (status || '').toLowerCase();
      if (s === 'completed' || s === 'success') return 'pf-m-green';
      if (s === 'running' || s === 'in_progress' || s === 'pending') return 'pf-m-orange';
      if (s === 'failed' || s === 'error') return 'pf-m-red';
      return 'pf-m-blue';
    },
    pruneBackups: async function() {
      if (!confirm('Prune old backups? This will remove expired backups based on retention policy.')) return;
      this.pruneBusy = true;
      try {
        var result = await bffFetch('/flagship/api/backups/prune', { method: 'POST' });
        window.showToast('success', 'Pruned ' + (result.pruned_backups_count || 'old') + ' backups');
        await this.fetchBackups();
      } catch (e) {
        window.showToast('danger', 'Prune failed: ' + e.message);
      } finally {
        this.pruneBusy = false;
      }
    },
    deleteBackup: async function(backup) {
      var id = backup.id || backup.backup_id;
      if (!id) return;
      if (!confirm('Delete backup ' + id.substring(0, 12) + '...? This action cannot be undone.')) return;
      var self = this;
      self.deleteLoading[id] = true;
      try {
        await bffFetch('/flagship/api/backups/' + id, { method: 'DELETE' });
        window.showToast('success', 'Backup deleted');
        await self.fetchBackups();
      } catch (e) {
        window.showToast('danger', 'Delete failed: ' + e.message);
      } finally {
        self.deleteLoading[id] = false;
      }
    },
    changePage: function(page) {
      if (page < 1 || page === this.page) return;
      this.page = page;
      this.fetchBackups();
    },
    applyFilter: function() {
      this.page = 1;
      this.fetchBackups();
    },
    fetchBackups: async function() {
      var self = this;
      self.loading = true;
      self.error = null;
      try {
        var url = buildPagedUrl('/flagship/api/backups', self.page, self.pageSize, {
          instance_id: self.instanceFilter && self.instanceFilter.trim() ? self.instanceFilter.trim() : ''
        });
        var data = await bffFetch(url);
        var paged = normalizePagedData(data, 'backups');
        self.backups = paged.items;
        self.page = paged.page;
        self.pageSize = paged.pageSize;
        self.total = paged.total;
      } catch (e) {
        self.error = e.message;
      } finally {
        self.loading = false;
      }
    }
  },
  mounted: function() { this.fetchBackups(); }
};

var BackupDetailView = {
  template: `\
    <section class="pf-c-page__main-section detail-page">\
      <div class="detail-hero">\
        <div class="detail-hero__breadcrumb">\
          <router-link to="/backups" class="back-link"><i class="fas fa-arrow-left"></i>Backups</router-link>\
          <span class="detail-muted">/</span>\
          <span>{{ backup ? (backup.id || 'Backup Detail') : 'Backup Detail' }}</span>\
        </div>\
        <div class="detail-hero__header">\
          <div class="detail-hero__copy">\
            <h1 class="pf-c-title pf-m-2xl detail-hero__title">{{ backup ? (backup.id || 'Backup Detail') : 'Backup Detail' }}</h1>\
            <div class="detail-inline-meta">\
              <span class="detail-inline-meta__item"><i class="fas fa-hashtag"></i>{{ backup.id || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-cube"></i>{{ backup.instance_id || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-database"></i>{{ backup.backup_type || backup.type || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-server"></i>{{ backup.node_id || '-' }}</span>\
            </div>\
            <div class="detail-badge-row">\
              <span class="pf-c-label" :class="statusLabelClass(backup.status)">{{ backup.status || 'unknown' }}</span>\
              <span class="pf-c-label pf-m-blue">{{ backup.created_at || 'No creation timestamp' }}</span>\
            </div>\
          </div>\
          <div class="detail-hero__actions">\
            <button class="pf-c-button pf-m-danger" @click="deleteBackup" :disabled="deleteBusy"><i class="fas fa-trash"></i>{{ deleteBusy ? 'Deleting...' : 'Delete backup' }}</button>\
          </div>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading backup...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else-if="!backup" class="pf-u-text-align-center pf-u-color-400 pf-u-py-xl">Backup not found</div>\
      <template v-else>\
        <div class="detail-summary-grid">\
          <div class="detail-stack">\
            <div class="pf-c-card detail-summary-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-info-circle"></i>Backup information</h2><p class="detail-section-meta">Identity and storage metadata.</p></div>\
              <div class="pf-c-card__body">\
                <dl class="pf-c-description-list compact-description-list">\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">ID</dt><dd class="pf-c-description-list__description">{{ backup.id || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Instance</dt><dd class="pf-c-description-list__description">{{ backup.instance_id || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Node</dt><dd class="pf-c-description-list__description">{{ backup.node_id || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Type</dt><dd class="pf-c-description-list__description">{{ backup.backup_type || backup.type || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Database type</dt><dd class="pf-c-description-list__description">{{ backup.database_type || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Triggered by</dt><dd class="pf-c-description-list__description">{{ backup.triggered_by || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Storage backend</dt><dd class="pf-c-description-list__description">{{ backup.storage_backend || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Storage key</dt><dd class="pf-c-description-list__description"><code>{{ backup.storage_key || '-' }}</code></dd></div>\
                </dl>\
              </div>\
            </div>\
            <div v-if="backup.error_message" class="pf-c-alert pf-m-danger pf-m-inline" role="alert">\
              <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle"></i></div>\
              <p class="pf-c-alert__title">Error: {{ backup.error_message }}</p>\
            </div>\
          </div>\
          <div class="detail-stack">\
            <div class="pf-c-card detail-summary-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-chart-bar"></i>Size and checksum</h2><p class="detail-section-meta">Integrity details for the stored artifact.</p></div>\
              <div class="pf-c-card__body">\
                <dl class="pf-c-description-list compact-description-list">\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Size</dt><dd class="pf-c-description-list__description">{{ formatBytes(backup.size_bytes || backup.size) }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Checksum (SHA256)</dt><dd class="pf-c-description-list__description"><code style="word-break:break-all;">{{ backup.checksum_sha256 || '-' }}</code></dd></div>\
                </dl>\
              </div>\
            </div>\
            <div class="pf-c-card detail-section-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-clock"></i>Timeline</h2><p class="detail-section-meta">Creation, completion, and expiration.</p></div>\
              <div class="pf-c-card__body">\
                <dl class="pf-c-description-list compact-description-list">\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Created</dt><dd class="pf-c-description-list__description">{{ backup.created_at || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Completed</dt><dd class="pf-c-description-list__description">{{ backup.completed_at || '-' }}</dd></div>\
                  <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Expires</dt><dd class="pf-c-description-list__description">{{ backup.expires_at || 'No expiration' }}</dd></div>\
                </dl>\
              </div>\
            </div>\
            <div v-if="backup.storage_uri_admin" class="pf-c-card detail-section-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-download"></i>Download</h2><p class="detail-section-meta">Open the object storage location directly.</p></div>\
              <div class="pf-c-card__body">\
                <a :href="backup.storage_uri_admin" class="pf-c-button pf-m-secondary" target="_blank" rel="noopener noreferrer"><i class="fas fa-download pf-u-mr-sm"></i>Download backup</a>\
              </div>\
            </div>\
          </div>\
        </div>\
      </template>\
    </section>`,
  data: function() { return { loading: true, error: null, backup: null, deleteBusy: false }; },
  computed: {
    backupId: function() { return this.$route.params.id; }
  },
  methods: {
    formatBytes: formatBytes,
    statusLabelClass: function(status) {
      var s = (status || '').toLowerCase();
      if (s === 'succeeded' || s === 'completed' || s === 'success') return 'pf-m-green';
      if (s === 'running' || s === 'in_progress' || s === 'pending') return 'pf-m-orange';
      if (s === 'failed' || s === 'error' || s === 'deleted') return 'pf-m-red';
      return 'pf-m-blue';
    },
    deleteBackup: async function() {
      var id = this.backupId;
      if (!id) return;
      if (!confirm('Delete this backup permanently? This cannot be undone.')) return;
      this.deleteBusy = true;
      try {
        await bffFetch('/flagship/api/backups/' + id, { method: 'DELETE' });
        window.showToast('success', 'Backup deleted');
        this.$router.push('/backups');
      } catch (e) {
        this.error = e.message;
      } finally {
        this.deleteBusy = false;
      }
    },
    loadBackup: async function() {
      try {
        var data = await bffFetch('/flagship/api/backups/' + this.backupId);
        this.backup = data.backup || null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: function() { this.loadBackup(); }
};

var BackupSettingsView = {

  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <router-link to="/backups" class="back-link"><i class="fas fa-arrow-left"></i>Back to Backups</router-link>\
        <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-cog"></i> Backup Settings</h1>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading settings...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else class="pf-l-grid pf-m-gutter">\
        <div class="pf-l-grid__item pf-m-12-col pf-m-6-col-on-lg">\
          <div class="pf-c-card">\
            <div class="pf-c-card__header"><h2 class="pf-c-title pf-m-lg"><i class="fas fa-database"></i> Storage Backend</h2></div>\
            <div class="pf-c-card__body">\
              <dl class="pf-c-description-list">\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Backend</dt><dd class="pf-c-description-list__description">{{ settings.storage_backend || settings.backend || "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Bucket / Path</dt><dd class="pf-c-description-list__description"><code>{{ settings.bucket || settings.path || settings.storage_path || "-" }}</code></dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Region</dt><dd class="pf-c-description-list__description">{{ settings.region || "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Endpoint</dt><dd class="pf-c-description-list__description"><code>{{ settings.endpoint || settings.storage_endpoint || "-" }}</code></dd></div>\
              </dl>\
            </div>\
          </div>\
        </div>\
        <div class="pf-l-grid__item pf-m-12-col pf-m-6-col-on-lg">\
          <div class="pf-c-card">\
            <div class="pf-c-card__header"><h2 class="pf-c-title pf-m-lg"><i class="fas fa-clock"></i> Retention</h2></div>\
            <div class="pf-c-card__body">\
              <dl class="pf-c-description-list">\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Retention Days</dt><dd class="pf-c-description-list__description">{{ settings.retention_days || settings.retention || "-" }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Max Backups</dt><dd class="pf-c-description-list__description">{{ settings.max_backups || settings.maximum_backups || "-" }}</dd></div>\
              </dl>\
            </div>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() { return { loading: true, error: null, settings: {} }; },
  methods: {
    loadSettings: async function() {
      try {
        var data = await bffFetch('/flagship/api/backups/settings');
        this.settings = data.settings || data || {};
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: function() { this.loadSettings(); }
};

var JobsView = {
  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-tasks pf-u-mr-sm"></i>Jobs / Operations</h1>\
      </div>\
      <div class="pf-c-card pf-u-mb-lg">\
        <div class="filter-bar">\
          <label for="job-filter-status">Status:</label>\
          <select id="job-filter-status" class="pf-c-form-control" v-model="statusFilter">\
            <option value="">All</option>\
            <option value="running">Running</option>\
            <option value="queued">Queued</option>\
            <option value="pending">Pending</option>\
            <option value="failed">Failed</option>\
            <option value="completed">Completed</option>\
          </select>\
          <button class="pf-c-button pf-m-secondary" @click="applyFilter"><i class="fas fa-search"></i>Filter</button>\
          <button class="pf-c-button pf-m-link" @click="clearFilters" v-if="statusFilter"><i class="fas fa-times"></i>Clear</button>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading jobs...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else class="pf-c-card">\
        <div class="pf-c-card__body pf-m-0">\
          <table class="pf-c-table pf-m-grid-md" role="grid">\
            <thead>\
              <tr>\
                <th>ID</th>\
                <th>Type / Action</th>\
                <th>Instance ID</th>\
                <th>Status</th>\
                <th>Created</th>\
                <th>Updated</th>\
                <th>Actions</th>\
              </tr>\
            </thead>\
            <tbody>\
              <tr v-for="job in jobs" :key="job.id || job.operation_id">\
                <td><router-link :to="\'/jobs/\' + (job.id || job.operation_id)" class="pf-c-button pf-m-link pf-m-inline" :title="job.id || job.operation_id" style="font-size:0.8125rem;">{{ (job.id || job.operation_id || "").substring(0, 12) }}...</router-link></td>\
                <td>{{ job.type || job.action || job.operation_type || "-" }}</td>\
                <td>{{ job.instance_id || job.instance || "-" }}</td>\
                <td>\
                  <span class="pf-c-label" :class="statusLabelClass(job.status)">\
                    <span v-if="job.status === \'running\'"><i class="fas fa-spinner fa-spin pf-u-mr-xs"></i></span>\
                    {{ job.status || "unknown" }}\
                  </span>\
                </td>\
                <td>{{ job.created_at || job.created || job.timestamp || "-" }}</td>\
                <td>{{ job.updated_at || job.updated || "-" }}</td>\
                <td>-</td>\
              </tr>\
              <tr v-if="jobs.length === 0">\
                <td colspan="7" class="pf-u-text-align-center pf-u-color-400">No jobs found</td>\
              </tr>\
            </tbody>\
          </table>\
        </div>\
        <div class="pf-c-card__footer list-pagination">\
          <span class="list-pagination-summary">Showing {{ pageStart }}-{{ pageEnd }} of {{ total }}</span>\
          <div class="list-pagination-actions">\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page - 1)" :disabled="page <= 1">Previous</button>\
            <span class="list-pagination-page">Page {{ page }}</span>\
            <button class="pf-c-button pf-m-secondary pf-m-small" @click="changePage(page + 1)" :disabled="pageEnd >= total">Next</button>\
          </div>\
        </div>\
      </div>\
    </section>',
  data: function() { return { loading: true, error: null, jobs: [], page: 1, pageSize: 20, total: 0, statusFilter: '' }; },
  computed: {
    pageStart: function() { return this.total === 0 ? 0 : ((this.page - 1) * this.pageSize) + 1; },
    pageEnd: function() { return Math.min(this.page * this.pageSize, this.total); }
  },
  methods: {
    statusLabelClass: function(status) {
      return jobStatusClass(status);
    },
    changePage: function(page) {
      if (page < 1 || page === this.page) return;
      this.page = page;
      this.fetchJobs();
    },
    applyFilter: function() {
      this.page = 1;
      this.fetchJobs();
    },
    clearFilters: function() {
      this.statusFilter = '';
      this.page = 1;
      this.fetchJobs();
    },
    fetchJobs: async function() {
      try {
        var data = await bffFetch(buildPagedUrl('/flagship/api/jobs', this.page, this.pageSize, {
          status: this.statusFilter
        }));
        var paged = normalizePagedData(data, 'jobs');
        this.jobs = paged.items;
        this.page = paged.page;
        this.pageSize = paged.pageSize;
        this.total = paged.total;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: async function() {
    this.statusFilter = this.$route.query.status || '';
    await this.fetchJobs();
  }
};

var JobDetailView = {
  template: `\
    <section class="pf-c-page__main-section detail-page">\
      <div class="detail-hero">\
        <div class="detail-hero__breadcrumb">\
          <router-link to="/jobs" class="back-link"><i class="fas fa-arrow-left"></i>Jobs</router-link>\
          <span class="detail-muted">/</span>\
          <span>{{ job ? (job.id || job.operation_id || 'Job Detail') : 'Job Detail' }}</span>\
        </div>\
        <div class="detail-hero__header">\
          <div class="detail-hero__copy">\
            <h1 class="pf-c-title pf-m-2xl detail-hero__title">{{ job ? (job.id || job.operation_id || 'Job Detail') : 'Job Detail' }}</h1>\
            <div class="detail-inline-meta">\
              <span class="detail-inline-meta__item"><i class="fas fa-hashtag"></i>{{ job.id || job.operation_id || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-bolt"></i>{{ job.type || job.action || job.operation_type || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-cube"></i>{{ job.instance_id || job.instance || '-' }}</span>\
              <span class="detail-inline-meta__item"><i class="fas fa-server"></i>{{ job.node_id || '-' }}</span>\
            </div>\
            <div class="detail-badge-row">\
              <span class="pf-c-label" :class="statusLabelClass(job.status)">{{ job.status || '-' }}</span>\
              <span class="pf-c-label pf-m-blue">{{ formatTimestamp(job.created_at) || 'No creation timestamp' }}</span>\
            </div>\
          </div>\
        </div>\
      </div>\
      <div v-if="loading" class="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Loading job...</div>\
      <div v-else-if="error" class="error-message">{{ error }}</div>\
      <div v-else-if="!job" class="pf-u-text-align-center pf-u-color-400 pf-u-py-xl">Job not found</div>\
      <template v-else>\
        <div class="detail-summary-grid">\
          <div class="pf-c-card detail-summary-card">\
            <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-info-circle"></i>Job information</h2><p class="detail-section-meta">Core task metadata and timing.</p></div>\
            <div class="pf-c-card__body">\
              <dl class="pf-c-description-list compact-description-list">\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">ID</dt><dd class="pf-c-description-list__description">{{ job.id || job.operation_id || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Action</dt><dd class="pf-c-description-list__description">{{ job.type || job.action || job.operation_type || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Status</dt><dd class="pf-c-description-list__description"><span class="pf-c-label" :class="statusLabelClass(job.status)">{{ job.status || '-' }}</span></dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Instance</dt><dd class="pf-c-description-list__description">{{ job.instance_id || job.instance || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Node</dt><dd class="pf-c-description-list__description">{{ job.node_id || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Created</dt><dd class="pf-c-description-list__description">{{ formatTimestamp(job.created_at) || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Updated</dt><dd class="pf-c-description-list__description">{{ formatTimestamp(job.updated_at) || '-' }}</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Duration</dt><dd class="pf-c-description-list__description">{{ formatDuration(durationSeconds) }}</dd></div>\
                <div v-if="progressPercent !== null" class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Progress</dt><dd class="pf-c-description-list__description">{{ progressPercent }}%</dd></div>\
                <div class="pf-c-description-list__group"><dt class="pf-c-description-list__term">Admin user</dt><dd class="pf-c-description-list__description">{{ job.admin_user || '-' }}</dd></div>\
              </dl>\
            </div>\
          </div>\
          <div class="detail-stack">\
            <div v-if="job.error_message" class="pf-c-card detail-summary-card">\
              <div class="pf-c-card__header"><h2 class="detail-section-title"><i class="fas fa-exclamation-triangle"></i>Error</h2><p class="detail-section-meta">Failure context returned by the backend.</p></div>\
              <div class="pf-c-card__body">\
                <pre class="detail-code-block">{{ job.error_message }}</pre>\
              </div>\
            </div>\
            <div v-if="recentLogText" class="pf-c-card detail-section-card">\
              <div class="pf-c-card__header">\
                <h2 class="detail-section-title"><i class="fas fa-file-alt"></i>Recent logs</h2>\
                <p class="detail-section-meta">Read-only inspection of the task output.</p>\
              </div>\
              <div class="pf-c-card__body">\
                <pre class="readonly-log-panel">{{ recentLogText }}</pre>\
              </div>\
            </div>\
          </div>\
        </div>\
      </template>\
    </section>`,
  data: function() { return { loading: true, error: null, job: null }; },
  computed: {
    jobId: function() { return this.$route.params.id; },
    durationSeconds: function() {
      if (!this.job) return null;
      return this.job.duration_seconds != null ? this.job.duration_seconds : _durationSecondsFromJob(this.job);
    },
    progressPercent: function() {
      if (!this.job) return null;
      return _progressPercentFromJob(this.job);
    },
    recentLogText: function() {
      if (!this.job) return '';
      return this.job.log_excerpt || this.job.logs || this.job.log || this.job.error_message || '';
    }
  },
  methods: {
    formatTimestamp: formatTimestamp,
    formatDuration: formatDuration,
    statusLabelClass: function(status) {
      return jobStatusClass(status);
    },
    loadJob: async function() {
      try {
        var data = await bffFetch('/flagship/api/jobs/' + this.jobId);
        this.job = data || null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  },
  mounted: function() { this.loadJob(); }
};

var ChangePasswordView = {

  template: '\
    <section class="pf-c-page__main-section">\
      <div class="pf-c-content pf-u-mb-lg">\
        <h1 class="pf-c-title pf-m-2xl"><i class="fas fa-key pf-u-mr-sm"></i>Change Password</h1>\
      </div>\
      <div class="pf-c-card">\
        <div class="pf-c-card__body">\
          <div v-if="error" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert">\
            <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
            <p class="pf-c-alert__title">{{ error }}</p>\
          </div>\
          <div v-if="success" class="pf-c-alert pf-m-success pf-m-inline pf-u-mb-md" role="alert">\
            <div class="pf-c-alert__icon"><i class="fas fa-fw fa-check-circle" aria-hidden="true"></i></div>\
            <p class="pf-c-alert__title">Password changed successfully</p>\
          </div>\
          <form v-if="!success" class="pf-c-form" @submit.prevent="changePassword">\
            <div class="pf-c-form__group">\
              <label class="pf-c-form__label" for="cp-current-password">\
                <span class="pf-c-form__label-text">Current Password</span>\
              </label>\
              <input id="cp-current-password" class="pf-c-form-control" type="password" v-model="currentPassword" required autocomplete="current-password">\
            </div>\
            <div class="pf-c-form__group">\
              <label class="pf-c-form__label" for="cp-new-password">\
                <span class="pf-c-form__label-text">New Password</span>\
              </label>\
              <input id="cp-new-password" class="pf-c-form-control" type="password" v-model="newPassword" required autocomplete="new-password" minlength="12">\
              <p class="pf-c-form__helper-text">must be at least 12 characters</p>\
            </div>\
            <div class="pf-c-form__group">\
              <label class="pf-c-form__label" for="cp-confirm-password">\
                <span class="pf-c-form__label-text">Confirm New Password</span>\
              </label>\
              <input id="cp-confirm-password" class="pf-c-form-control" type="password" v-model="confirmPassword" required autocomplete="new-password">\
            </div>\
            <div class="pf-c-form__group pf-m-action">\
              <button class="pf-c-button pf-m-primary" type="submit" :disabled="loading">\
                <span v-if="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Updating...</span>\
                <span v-else><i class="fas fa-key pf-u-mr-sm"></i>Change Password</span>\
              </button>\
            </div>\
          </form>\
        </div>\
      </div>\
    </section>',
  data: function() {
    return { currentPassword: '', newPassword: '', confirmPassword: '', error: '', success: false, loading: false };
  },
  methods: {
    changePassword: async function() {
      this.error = '';
      if (this.newPassword !== this.confirmPassword) {
        this.error = 'New passwords do not match';
        return;
      }
      if (this.newPassword.length < 12) {
        this.error = 'New password must be at least 12 characters';
        return;
      }
      this.loading = true;
      try {
        var params = { current_password: this.currentPassword, new_password: this.newPassword };
        var firstLogin = this.$route.query.first_login === '1';
        var username = this.$route.query.username || '';
        if (firstLogin && username) {
          params.username = username;
        }
        await bffFetch('/flagship/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify(params)
        });
        this.success = true;
        if (firstLogin && username) {
          try {
            await bffFetch('/flagship/api/auth/login', {
              method: 'POST',
              body: JSON.stringify({ username: username, password: this.newPassword })
            });
            window.location.href = '/';
            return;
          } catch (e) {
            this.error = 'Password changed. Please login with your new password.';
            this.loading = false;
            return;
          }
        }
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  }
};

var routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: DashboardView },
  { path: '/nodes', component: NodesView },
  { path: '/nodes/:id', component: NodeDetailView },
  { path: '/catalog/apps', component: CatalogAppsView },
  { path: '/catalog/apps/new', component: CatalogAppFormView },
  { path: '/catalog/apps/:id', component: CatalogAppDetailView },
  { path: '/catalog/apps/:id/edit', component: CatalogAppFormView },
  { path: '/instances', component: InstancesView },
  { path: '/instances/new', component: InstanceCreateView },
  { path: '/instances/:id', component: InstanceDetailView },
  { path: '/instances/:id/restore', component: InstanceRestoreView },
  { path: '/backups', component: BackupsView },
  { path: '/backups/settings', component: BackupSettingsView },
  { path: '/backups/:id', component: BackupDetailView },
  { path: '/jobs', component: JobsView },
  { path: '/jobs/:id', component: JobDetailView },
  { path: '/change-password', component: ChangePasswordView }
];

var ChangePasswordStandaloneView = {
  template: '\
    <div class="login-bg">\
        <div class="login-container">\
          <div class="pf-c-card login-card">\
            <div class="pf-c-card__head">\
              <div class="login-logo">\
                <div class="sidebar-brand-icon" style="font-size:2rem;width:64px;height:64px;line-height:64px;margin:0 auto 8px;">A</div>\
                <h1 class="pf-c-title pf-m-2xl" style="text-align:center;">Change Required</h1>\
                <p class="pf-c-content" style="text-align:center;color:var(--pf-global--Color--200);">You must change your password before continuing.</p>\
              </div>\
            </div>\
            <div class="pf-c-card__body">\
              <div v-if="error" class="pf-c-alert pf-m-danger pf-m-inline pf-u-mb-md" role="alert">\
                <div class="pf-c-alert__icon"><i class="fas fa-fw fa-exclamation-circle" aria-hidden="true"></i></div>\
                <p class="pf-c-alert__title">{{ error }}</p>\
              </div>\
              <div v-if="success" class="pf-c-alert pf-m-success pf-m-inline pf-u-mb-md" role="alert">\
                <div class="pf-c-alert__icon"><i class="fas fa-fw fa-check-circle" aria-hidden="true"></i></div>\
                <p class="pf-c-alert__title">Password changed successfully</p>\
              </div>\
              <div v-if="success" class="pf-u-text-align-center" style="margin-top:0.5rem;">\
                <a href="/" class="pf-c-button pf-m-primary pf-m-block">Go to Dashboard</a>\
              </div>\
              <form v-if="!success" class="pf-c-form" @submit.prevent="changePassword">\
                <div class="pf-c-form__group">\
                  <label class="pf-c-form__label" for="cp-current-password">\
                    <span class="pf-c-form__label-text">Current Password</span>\
                  </label>\
                  <input id="cp-current-password" class="pf-c-form-control" type="password" v-model="currentPassword" required autocomplete="current-password">\
                </div>\
                <div class="pf-c-form__group">\
                  <label class="pf-c-form__label" for="cp-new-password">\
                    <span class="pf-c-form__label-text">New Password</span>\
                  </label>\
                  <input id="cp-new-password" class="pf-c-form-control" type="password" v-model="newPassword" required autocomplete="new-password" minlength="12">\
                  <p class="pf-c-form__helper-text">must be at least 12 characters</p>\
                </div>\
                <div class="pf-c-form__group">\
                  <label class="pf-c-form__label" for="cp-confirm-password">\
                    <span class="pf-c-form__label-text">Confirm New Password</span>\
                  </label>\
                  <input id="cp-confirm-password" class="pf-c-form-control" type="password" v-model="confirmPassword" required autocomplete="new-password">\
                </div>\
                <div class="pf-c-form__group pf-m-action">\
                  <button class="pf-c-button pf-m-primary pf-m-block" type="submit" :disabled="loading">\
                    <span v-if="loading"><i class="fas fa-spinner fa-spin pf-u-mr-sm"></i>Updating...</span>\
                    <span v-else><i class="fas fa-key pf-u-mr-sm"></i>Change Password</span>\
                  </button>\
                </div>\
              </form>\
            </div>\
          </div>\
        </div>\
      </div>',
  data: function() {
    return { currentPassword: '', newPassword: '', confirmPassword: '', error: '', success: false, loading: false };
  },
  methods: {
    changePassword: async function() {
      this.error = '';
      if (this.newPassword !== this.confirmPassword) {
        this.error = 'New passwords do not match';
        return;
      }
      if (this.newPassword.length < 12) {
        this.error = 'New password must be at least 12 characters';
        return;
      }
      this.loading = true;
      try {
        var username = this.$route.query.username || (window.appState && window.appState.username) || '';
        var params = { current_password: this.currentPassword, new_password: this.newPassword };
        if (username) params.username = username;
        await bffFetch('/flagship/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify(params)
        });
        this.success = true;
        if (username) {
          try {
            await bffFetch('/flagship/api/auth/login', {
              method: 'POST',
              body: JSON.stringify({ username: username, password: this.newPassword })
            });
            window.appState = null;
            window.location.href = '/';
            return;
          } catch (e) {
            this.error = 'Password changed. Please login with your new password.';
            this.loading = false;
            return;
          }
        }
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    }
  }
};

var router = VueRouter.createRouter({
  history: VueRouter.createWebHashHistory(),
  routes: routes
});

router.beforeEach(function(to, from) {
  if (window.appState && window.appState.passwordChangeRequired && to.path !== '/change-password') {
    return { path: '/change-password', query: { first_login: '1', username: window.appState.username } };
  }
});

var app = Vue.createApp({
  data: function() {
    return {
      authenticated: false,
      checkingAuth: true,
      username: '',
      passwordChangeRequired: false,
      sidebarOpen: false,
      sidebarCollapsed: false,
    };
  },
  methods: {
    toggleSidebar: function() {
      if (window.innerWidth <= 768) {
        this.sidebarOpen = !this.sidebarOpen;
        return;
      }
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('flagship_sidebar_collapsed', this.sidebarCollapsed ? '1' : '0');
    },
    logout: async function() {
      try { await bffFetch('/flagship/api/auth/logout', { method: 'POST' }); } catch(e) {}
      window.location.reload();
    }
  },
  mounted: async function() {
    var self = this;
    try {
      var data = await bffFetch('/flagship/api/auth/me');
      self.authenticated = data.authenticated === true;
      self.username = data.username || '';
      self.passwordChangeRequired = data.password_change_required === true;
      self.sidebarCollapsed = localStorage.getItem('flagship_sidebar_collapsed') === '1';
      window.appState = { passwordChangeRequired: self.passwordChangeRequired, username: self.username };
    } catch(e) {
      self.authenticated = false;
    } finally {
      self.checkingAuth = false;
    }
  },
  watch: {
    '$route.path': function() {
      this.sidebarOpen = false;
    }
  }
});

app.component('login-view', LoginView);
app.component('change-password-standalone', ChangePasswordStandaloneView);

app.use(router);
app.mount('#app');
