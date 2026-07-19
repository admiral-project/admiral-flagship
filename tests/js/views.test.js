const { expect } = require('chai');
require('./setup');

const originalWin = global.window;
originalWin.confirm = () => true;

function setFetch(fn) {
  global.fetch = fn;
  originalWin.fetch = fn;
  if (global.window) {
    global.window.fetch = fn;
  }
}

function mockFetchResponse(data, ok = true, status = 200, headers = {}) {
  const getHeader = (h) => headers[h] || null;
  return {
    ok,
    status,
    headers: { get: getHeader },
    json: async () => data
  };
}

describe('Extra Utility Functions', function() {
  it('provisionResultCache returns cache object', function() {
    const cache = provisionResultCache();
    expect(cache).to.be.an('object');
  });

  it('normalizeProvisionCredential handles edge cases', function() {
    expect(normalizeProvisionCredential(null)).to.be.null;
    expect(normalizeProvisionCredential(undefined)).to.be.null;
    expect(normalizeProvisionCredential("not-an-object")).to.be.null;
    expect(normalizeProvisionCredential({})).to.deep.equal({
      service: '',
      name: '',
      value: '',
      kind: 'secret',
      generate: ''
    });
  });

  it('normalizeProvisionCredentials handles null', function() {
    expect(normalizeProvisionCredentials(null)).to.deep.equal([]);
  });

  it('parseProvisionResultSnapshot handles parse error and edge cases', function() {
    const key = provisionResultStorageKey('err_op');
    originalWin.sessionStorage.setItem(key, '{invalid-json}');
    const result = parseProvisionResultSnapshot('err_op');
    expect(result).to.be.null;

    expect(parseProvisionResultSnapshot(null)).to.be.null;
    storeProvisionResultSnapshot(null);
    storeProvisionResultSnapshot({ no_op: true });

    // sessionStorage getItem failure
    const originalGetItem = originalWin.sessionStorage.getItem;
    originalWin.sessionStorage.getItem = () => { throw new Error('getItem fail'); };
    expect(parseProvisionResultSnapshot('any')).to.be.null;
    originalWin.sessionStorage.getItem = originalGetItem;

    // cache fallback path
    const cachedKey = provisionResultStorageKey('cached_op');
    provisionResultCache()[cachedKey] = { hostname: 'cached.host' };
    expect(parseProvisionResultSnapshot('cached_op').hostname).to.equal('cached.host');

    // non-object parsing
    originalWin.sessionStorage.setItem(key, '"just-a-string"');
    expect(parseProvisionResultSnapshot('err_op')).to.be.null;
  });

  it('storeProvisionResultSnapshot handles sessionStorage setItem failure', function() {
    const originalSetItem = originalWin.sessionStorage.setItem;
    originalWin.sessionStorage.setItem = () => { throw new Error('setItem fail'); };
    storeProvisionResultSnapshot({ operation_id: 'op1' });
    originalWin.sessionStorage.setItem = originalSetItem;
  });
});

describe('LoginView', function() {
  it('initializes data correctly', function() {
    const data = LoginView.data();
    expect(data.username).to.equal('');
    expect(data.password).to.equal('');
    expect(data.error).to.equal('');
    expect(data.loading).to.be.false;

    // session_expired check inside LoginView.data()
    originalWin.sessionStorage.setItem('session_expired', '1');
    const dataExpired = LoginView.data();
    expect(dataExpired.flashMessage).to.include('expired');
  });

  it('handles successful login', async function() {
    const originalFetch = global.fetch;
    let loginPayload = null;

    setFetch(async (url, opts) => {
      expect(url).to.equal('/flagship/api/auth/login');
      loginPayload = JSON.parse(opts.body);
      return mockFetchResponse({ username: 'operator1' });
    });

    originalWin.__location_href = '';

    const ctx = {
      username: 'userA',
      password: 'passwordA',
      loading: false,
      error: '',
    };

    await LoginView.methods.login.call(ctx);

    expect(ctx.loading).to.be.false;
    expect(loginPayload).to.deep.equal({ username: 'userA', password: 'passwordA' });
    expect(originalWin.sessionStorage.getItem('first_login_username')).to.equal('operator1');
    expect(originalWin.__location_href).to.equal('/');

    setFetch(originalFetch);
  });

  it('handles login failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => {
      return mockFetchResponse({ error: 'invalid credentials' }, false, 400);
    });

    const ctx = {
      username: 'userA',
      password: 'wrong_password',
      loading: false,
      error: '',
    };

    await LoginView.methods.login.call(ctx);

    expect(ctx.loading).to.be.false;
    expect(ctx.error).to.equal('invalid credentials');

    setFetch(originalFetch);
  });
});

describe('DashboardView', function() {
  it('computed properties initialize with empty structure', function() {
    const ctx = DashboardView.data();
    expect(DashboardView.computed.hasCapacity.call(ctx)).to.be.false;
    expect(DashboardView.computed.recentJobs.call(ctx)).to.deep.equal([]);
    expect(DashboardView.computed.appOptions.call(ctx)).to.deep.equal([]);
    expect(DashboardView.computed.customerOptions.call(ctx)).to.deep.equal([]);
    expect(DashboardView.computed.nodeOptions.call(ctx)).to.deep.equal([]);
    expect(DashboardView.computed.hasInstanceFilters.call(ctx)).to.be.false;
    expect(DashboardView.computed.activeInstanceFilters.call(ctx)).to.deep.equal({});
    expect(DashboardView.computed.lastUpdatedLabel.call(ctx)).to.equal('just now');
    expect(DashboardView.computed.visibleAlerts.call(ctx)).to.deep.equal([]);
  });

  it('computed properties compute correctly with populated lists', function() {
    const ctx = {
      instances: [
        { customer_id: 'c1', app_definition_name: 'wp', status: 'running', node_id: 'n1' },
        { customer_id: 'c2', app_definition_name: 'wp', status: 'stopped', node_id: 'n2' }
      ],
      nodes: [
        { id: 'n1', hostname: 'node-one' },
        { id: 'n2', hostname: 'node-two' }
      ],
      capacity: { total_ram_bytes: 100, committed_ram_bytes: 20 },
      recentJobsData: [{ id: 'job_1', status: 'completed' }],
      alerts: [{ title: 'Warning', message: 'Heavy load' }],
      dismissedAlertKeys: [],
      instanceFilters: { status: 'stopped', app_definition_name: 'wp', node_id: 'n2', customer_id: 'c2' },
      alertKey: DashboardView.methods.alertKey
    };

    expect(DashboardView.computed.hasCapacity.call(ctx)).to.be.true;
    expect(DashboardView.computed.appOptions.call(ctx)).to.deep.equal(['wp']);
    expect(DashboardView.computed.customerOptions.call(ctx)).to.deep.equal(['c1', 'c2']);
    expect(DashboardView.computed.nodeOptions.call(ctx)).to.have.lengthOf(2);
    expect(DashboardView.computed.hasInstanceFilters.call(ctx)).to.be.true;
    expect(DashboardView.computed.activeInstanceFilters.call(ctx)).to.deep.equal({
      status: 'stopped',
      app_definition_name: 'wp',
      node_id: 'n2',
      customer_id: 'c2'
    });

    const filtered = DashboardView.computed.filteredInstances.call(ctx);
    expect(filtered).to.have.lengthOf(1);
    expect(filtered[0].customer_id).to.equal('c2');

    expect(DashboardView.computed.visibleAlerts.call(ctx)).to.have.lengthOf(1);
  });

  it('covers filteredInstances status filter combinations', function() {
    const ctx = {
      instances: [
        { customer_id: 'c1', app_definition_name: 'app1', status: 'running', node_id: 'n1' },
        { customer_id: 'c2', app_definition_name: 'app2', status: 'stopped', node_id: 'n2' },
        { customer_id: 'c3', app_definition_name: 'app3', status: 'deprovisioned', node_id: 'n3' }
      ],
      instanceFilters: { status: 'stopped', app_definition_name: '', node_id: '', customer_id: '' }
    };
    // matches stopped and deprovisioned
    expect(DashboardView.computed.filteredInstances.call(ctx)).to.have.lengthOf(2);

    ctx.instanceFilters = { status: 'running', app_definition_name: 'app2', node_id: '', customer_id: '' };
    expect(DashboardView.computed.filteredInstances.call(ctx)).to.have.lengthOf(0);

    ctx.instanceFilters = { status: '', app_definition_name: '', node_id: 'n99', customer_id: '' };
    expect(DashboardView.computed.filteredInstances.call(ctx)).to.have.lengthOf(0);

    ctx.instanceFilters = { status: '', app_definition_name: '', node_id: '', customer_id: 'c99' };
    expect(DashboardView.computed.filteredInstances.call(ctx)).to.have.lengthOf(0);
  });

  it('covers remaining computed properties of DashboardView', function() {
    // lastUpdatedLabel
    expect(DashboardView.computed.lastUpdatedLabel.call({ lastUpdatedAt: new Date().toISOString() })).to.include('ago');

    // visibleAlerts with dismissedAlertKeys
    const ctx = {
      alerts: [{ title: 'Err' }],
      dismissedAlertKeys: ['Err||'],
      alertKey: DashboardView.methods.alertKey
    };
    expect(DashboardView.computed.visibleAlerts.call(ctx)).to.have.lengthOf(0);
  });

  it('methods behave correctly', async function() {
    let pushed = null;
    const ctx = {
      $router: { push: (p) => { pushed = p; } },
      instanceFilters: { status: 'running', app_definition_name: 'test' },
      dismissedAlertKeys: [],
      nodes: [{ id: 'n1', hostname: 'node-one' }],
      alerts: [{ title: 'AlertA', message: 'MsgA' }],
      instances: [],
      refreshing: false,
      error: null,
      alertKey: DashboardView.methods.alertKey,
      persistDismissedAlerts: () => {},
      fetchAll: async function() { this.fetched = true; }
    };

    DashboardView.methods.goToInstance.call(ctx, { id: 'inst_1' });
    expect(pushed).to.equal('/instances/inst_1');
    DashboardView.methods.goToInstance.call(ctx, {}); // empty id

    DashboardView.methods.goToJob.call(ctx, { id: 'job_1' });
    expect(pushed).to.equal('/jobs/job_1');

    DashboardView.methods.goToBackup.call(ctx, { id: 'bk_1' });
    expect(pushed).to.equal('/backups/bk_1');

    expect(DashboardView.methods.nodeLabel.call(ctx, 'n1')).to.equal('node-one');
    expect(DashboardView.methods.nodeLabel.call(ctx, 'n_unknown')).to.equal('n_unknown');

    expect(DashboardView.methods.capacityPercent(50, 100)).to.equal(50);
    expect(DashboardView.methods.capacityPercent(150, 100)).to.equal(100);
    expect(DashboardView.methods.capacityPercent(50, 0)).to.equal(0);

    DashboardView.methods.clearInstanceFilters.call(ctx);
    expect(ctx.instanceFilters).to.deep.equal({ status: '', app_definition_name: '', node_id: '', customer_id: '' });

    const key = DashboardView.methods.alertKey.call(ctx, ctx.alerts[0]);
    expect(key).to.equal('AlertA|MsgA|');

    DashboardView.methods.dismissAlert.call(ctx, ctx.alerts[0]);
    expect(ctx.dismissedAlertKeys).to.include(key);

    await DashboardView.methods.refresh.call(ctx);
    expect(ctx.fetched).to.be.true;

    expect(DashboardView.methods.shortId(null)).to.equal('-');
    expect(DashboardView.methods.shortId('123')).to.equal('123');
    expect(DashboardView.methods.shortId('123456789012345')).to.equal('123456789012...');
    expect(DashboardView.methods.dashboardLink('/path')).to.deep.equal({ path: '/path', query: {} });
  });

  it('covers DashboardView dismissed alerts sessionStorage persistence', function() {
    originalWin.sessionStorage.clear();
    const ctx = { dismissedAlertKeys: [] };
    DashboardView.methods.loadDismissedAlerts.call(ctx);
    expect(ctx.dismissedAlertKeys).to.deep.equal([]);

    ctx.dismissedAlertKeys = ['key1'];
    DashboardView.methods.persistDismissedAlerts.call(ctx);

    const ctx2 = { dismissedAlertKeys: [] };
    DashboardView.methods.loadDismissedAlerts.call(ctx2);
    expect(ctx2.dismissedAlertKeys).to.deep.equal(['key1']);

    // sessionStorage setItem failure
    const originalSetItem = originalWin.sessionStorage.setItem;
    originalWin.sessionStorage.setItem = () => { throw new Error('fail'); };
    DashboardView.methods.persistDismissedAlerts.call(ctx);
    originalWin.sessionStorage.setItem = originalSetItem;

    // load dismissed alerts failure
    const originalGetItem = originalWin.sessionStorage.getItem;
    originalWin.sessionStorage.getItem = () => { throw new Error('fail'); };
    DashboardView.methods.loadDismissedAlerts.call(ctx);
    originalWin.sessionStorage.getItem = originalGetItem;
  });

  it('fetchAll pulls dashboard data successfully', async function() {
    const originalFetch = global.fetch;
    const mockDashboardData = {
      instances: [{ id: 'i1' }],
      nodes: [{ id: 'n1' }],
      jobs: [],
      backups: [],
      recent_jobs: [],
      capacity: { total_ram_bytes: 50 },
      alerts: [],
      summary: { total_instances: 5 },
      recent_failed_backups: []
    };

    setFetch(async (url) => {
      expect(url).to.equal('/flagship/api/dashboard');
      return mockFetchResponse(mockDashboardData);
    });

    const ctx = {
      instances: [],
      nodes: [],
      capacity: {},
      summary: {},
      lastUpdatedAt: null,
      error: null
    };

    await DashboardView.methods.fetchAll.call(ctx);

    expect(ctx.instances).to.have.lengthOf(1);
    expect(ctx.nodes).to.have.lengthOf(1);
    expect(ctx.summary.total_instances).to.equal(5);
    expect(ctx.lastUpdatedAt).to.not.be.null;

    setFetch(originalFetch);
  });

  it('fetchAll failure sets error', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => {
      return mockFetchResponse({ error: 'failed bff' }, false, 500);
    });
    const ctx = { error: null };
    await DashboardView.methods.fetchAll.call(ctx);
    expect(ctx.error).to.equal('failed bff');
    setFetch(originalFetch);
  });

  it('mounted hook executes successfully', async function() {
    let loadedDismissed = false;
    let fetchedAll = false;
    const ctx = {
      loadDismissedAlerts: () => { loadedDismissed = true; },
      fetchAll: async () => { fetchedAll = true; },
      loading: true
    };
    await DashboardView.mounted.call(ctx);
    expect(loadedDismissed).to.be.true;
    expect(fetchedAll).to.be.true;
    expect(ctx.loading).to.be.false;
  });
});

describe('NodesView', function() {
  it('data and computed properties', function() {
    const ctx = NodesView.data();
    ctx.total = 25;
    ctx.page = 2;
    ctx.pageSize = 10;
    expect(NodesView.computed.pageStart.call(ctx)).to.equal(11);
    expect(NodesView.computed.pageEnd.call(ctx)).to.equal(20);
  });

  it('covers label mappers and filters of NodesView', function() {
    expect(NodesView.methods.statusLabelClass('unknown')).to.equal('pf-m-grey');
    expect(NodesView.methods.fleetLabelClass({})).to.equal('pf-m-orange');
    expect(NodesView.methods.healthLabelClass('unknown')).to.equal('pf-m-grey');

    const ctx = {
      showRegisterForm: true,
      regForm: { node_id: 'n1', hostname: 'h1', ip: '1.2.3.4' },
      regError: 'err',
      regSuccess: true,
      page: 2,
      statusFilter: 'online',
      fetchNodes: () => { ctx.fetched = true; }
    };

    NodesView.methods.cancelRegister.call(ctx);
    expect(ctx.showRegisterForm).to.be.false;
    expect(ctx.regForm.node_id).to.equal('');

    NodesView.methods.applyFilter.call(ctx);
    expect(ctx.page).to.equal(1);
    expect(ctx.fetched).to.be.true;

    ctx.fetched = false;
    NodesView.methods.clearFilters.call(ctx);
    expect(ctx.statusFilter).to.equal('');
    expect(ctx.fetched).to.be.true;

    // changePage early return
    ctx.fetched = false;
    NodesView.methods.changePage.call(ctx, 1);
    expect(ctx.fetched).to.be.false;
  });

  it('methods register and fetch', async function() {
    const originalFetch = global.fetch;
    let registeredPayload = null;

    setFetch(async (url, opts) => {
      if (url === '/flagship/api/nodes/register') {
        registeredPayload = JSON.parse(opts.body);
        return mockFetchResponse({});
      }
    });

    const ctx = {
      regLoading: false,
      regError: null,
      regSuccess: false,
      regForm: { node_id: 'n_new', hostname: 'new-host', ip: '5.5.5.5' },
      page: 1,
      pageSize: 10,
      nodes: [],
      total: 0,
      statusFilter: '',
      fetchNodes: function() {
        this.nodes = [{ id: 'n_new' }];
      }
    };

    await NodesView.methods.registerNode.call(ctx);

    expect(ctx.regSuccess).to.be.true;
    expect(registeredPayload).to.deep.equal({ node_id: 'n_new', hostname: 'new-host', ip: '5.5.5.5' });
    expect(ctx.regForm.node_id).to.equal('');
    expect(ctx.nodes).to.have.lengthOf(1);

    setFetch(originalFetch);
  });

  it('register failure paths', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => {
      return mockFetchResponse({ error: 'conflict' }, false, 409);
    });
    const ctx = {
      regLoading: false, regError: null, regSuccess: false,
      regForm: { node_id: 'n' }, fetchNodes: () => {}
    };
    await NodesView.methods.registerNode.call(ctx);
    expect(ctx.regSuccess).to.be.false;
    expect(ctx.regError).to.equal('conflict');
    setFetch(originalFetch);
  });

  it('fetchNodes success and failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => {
      return mockFetchResponse({ nodes: [{ id: 'n1' }] });
    });
    const ctx = {
      nodes: [], page: 1, pageSize: 10, total: 0, loading: true, error: null
    };
    await NodesView.methods.fetchNodes.call(ctx);
    expect(ctx.nodes).to.have.lengthOf(1);
    expect(ctx.loading).to.be.false;

    // Failure path
    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 400));
    await NodesView.methods.fetchNodes.call(ctx);
    expect(ctx.error).to.equal('err');

    setFetch(originalFetch);
  });

  it('mounted hook fetches data', async function() {
    let fetched = false;
    const ctx = {
      $route: { query: { status: 'online' } },
      statusFilter: '',
      fetchNodes: async () => { fetched = true; }
    };
    await NodesView.mounted.call(ctx);
    expect(ctx.statusFilter).to.equal('online');
    expect(fetched).to.be.true;
  });
});

describe('NodeDetailView', function() {
  it('data object initialization', function() {
    const data = NodeDetailView.data();
    expect(data.loading).to.be.true;
    expect(data.node).to.be.null;
  });

  it('computed properties find node issue and metrics', function() {
    const ctx = {
      $route: { params: { id: 'node_1' } },
      node: {
        id: 'node_1',
        hostname: 'node-one',
        status: 'online',
        fleet_version: '2.0.0',
        last_heartbeat: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago (stale)
        ram_used_bytes: 95,
        ram_total_bytes: 100,
        disk_used_bytes: 50,
        disk_total_bytes: 100
      },
      metrics: { collected_at: '2025-01-01T12:00:00Z' },
      capacityPercent: NodeDetailView.methods.capacityPercent
    };

    expect(NodeDetailView.computed.nodeId.call(ctx)).to.equal('node_1');
    expect(NodeDetailView.computed.metricsLabel.call(ctx)).to.not.equal('Not reported');
    expect(NodeDetailView.computed.ramUsageBarClass.call(ctx)).to.equal('dashboard-progress-fill-red');
    expect(NodeDetailView.computed.diskUsageBarClass.call(ctx)).to.equal('dashboard-progress-fill-green');

    const issue = NodeDetailView.computed.nodeIssue.call(ctx);
    expect(issue.title).to.equal('Node heartbeat is stale');

    // degraded health node issue
    ctx.node.health_status = 'degraded';
    ctx.node.last_heartbeat = new Date().toISOString();
    expect(NodeDetailView.computed.nodeIssue.call(ctx).title).to.include('degraded');

    // no fleet agent node issue
    ctx.node.fleet_version = '';
    expect(NodeDetailView.computed.nodeIssue.call(ctx).title).to.include('not installed');

    // no heartbeat node issue
    ctx.node.fleet_version = '1.0';
    ctx.node.last_heartbeat = '';
    expect(NodeDetailView.computed.nodeIssue.call(ctx).title).to.include('first heartbeat');

    // no node case
    ctx.node = null;
    expect(NodeDetailView.computed.nodeIssue.call(ctx)).to.be.null;
  });

  it('covers NodeDetailView computed property labels', function() {
    const ctx = {
      node: { last_heartbeat: null },
      metrics: null,
      removeConfirmInput: 'node1',
      removeConfirmPlaceholder: 'node1'
    };
    expect(NodeDetailView.computed.heartbeatLabel.call(ctx)).to.equal('Never');
    expect(NodeDetailView.computed.heartbeatAgeLabel.call(ctx)).to.equal('Never');
    expect(NodeDetailView.computed.metricsLabel.call(ctx)).to.equal('Not reported');
    expect(NodeDetailView.computed.removeReady.call(ctx)).to.be.true;
    expect(NodeDetailView.computed.removeConfirmPlaceholder.call({ node: null })).to.equal('');
  });

  it('actions: toggle maintenance and delete', async function() {
    const originalFetch = global.fetch;
    let deleted = false;
    let actionMethod = null;

    setFetch(async (url, opts) => {
      if (opts.method === 'DELETE') {
        deleted = true;
        return mockFetchResponse({});
      }
      if (opts.method === 'POST') {
        actionMethod = url;
        return mockFetchResponse({ node: { id: 'node_1', manual_disabled: true } });
      }
    });

    let toastType = null;
    window.showToast = (type) => { toastType = type; };

    let redirectPath = null;
    const ctx = {
      nodeId: 'node_1',
      node: { id: 'node_1', manual_disabled: false },
      loadingAction: false,
      error: '',
      removeError: '',
      $router: { push: (p) => { redirectPath = p; } },
      loadNode: async function() {}
    };

    await NodeDetailView.methods.toggleMaintenance.call(ctx);
    expect(actionMethod).to.include('/flagship/api/nodes/node_1/disable');
    expect(toastType).to.equal('success');

    await NodeDetailView.methods.confirmRemove.call(ctx);
    expect(deleted).to.be.true;
    expect(redirectPath).to.equal('/nodes');

    // confirmation early returns
    ctx.node = null;
    await NodeDetailView.methods.toggleMaintenance.call(ctx);
    await NodeDetailView.methods.confirmRemove.call(ctx);

    setFetch(originalFetch);
  });

  it('loadNode success and failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ node: { id: 'n' }, metrics: {} }));
    const ctx = { nodeId: 'n', node: null, metrics: null, loading: true, error: null };
    await NodeDetailView.methods.loadNode.call(ctx);
    expect(ctx.node.id).to.equal('n');
    expect(ctx.loading).to.be.false;

    setFetch(async () => mockFetchResponse({ error: 'fail' }, false, 400));
    await NodeDetailView.methods.loadNode.call(ctx);
    expect(ctx.error).to.equal('fail');

    setFetch(originalFetch);
  });

  it('utility functions and modal toggles', function() {
    expect(NodeDetailView.methods.capacityDisplay(100, 200)).to.include('100.0 B');
    expect(NodeDetailView.methods.capacityDisplay(100, 0)).to.equal('Not reported');

    const ctx = { showRemoveModal: false, removeConfirmInput: 'x', removeError: 'err' };
    NodeDetailView.methods.openRemoveModal.call(ctx);
    expect(ctx.showRemoveModal).to.be.true;
    expect(ctx.removeConfirmInput).to.equal('');

    NodeDetailView.methods.closeRemoveModal.call(ctx);
    expect(ctx.showRemoveModal).to.be.false;

    // label status classes
    expect(NodeDetailView.methods.statusLabelClass('Online')).to.equal('pf-m-green');
    expect(NodeDetailView.methods.statusLabelClass('Offline')).to.equal('pf-m-red');
    expect(NodeDetailView.methods.statusLabelClass('Pending')).to.equal('pf-m-orange');
    expect(NodeDetailView.methods.statusLabelClass('x')).to.equal('pf-m-blue');

    expect(NodeDetailView.methods.healthLabelClass('Healthy')).to.equal('pf-m-green');
    expect(NodeDetailView.methods.healthLabelClass('Degraded')).to.equal('pf-m-orange');
    expect(NodeDetailView.methods.healthLabelClass('Unhealthy')).to.equal('pf-m-red');
    expect(NodeDetailView.methods.healthLabelClass('x')).to.equal('pf-m-blue');

    // reloadNode
    let reloaded = false;
    const ctxReload = { loadNode: async () => { reloaded = true; } };
    NodeDetailView.methods.reloadNode.call(ctxReload);
    expect(reloaded).to.be.true;
  });

  it('mounted hook executes', function() {
    let reloaded = false;
    const ctx = { loadNode: () => { reloaded = true; } };
    NodeDetailView.mounted.call(ctx);
    expect(reloaded).to.be.true;
  });
});

describe('CatalogAppsView', function() {
  it('computes correctly', function() {
    const ctx = CatalogAppsView.data();
    ctx.total = 15;
    ctx.page = 1;
    ctx.pageSize = 10;
    expect(CatalogAppsView.computed.pageStart.call(ctx)).to.equal(1);
    expect(CatalogAppsView.computed.pageEnd.call(ctx)).to.equal(10);
    expect(CatalogAppsView.methods.appRouteId({ id: 'app1' })).to.equal('app1');

    // changePage early return
    let fetched = false;
    const ctxPage = { page: 1, fetchApps: () => { fetched = true; } };
    CatalogAppsView.methods.changePage.call(ctxPage, 1);
    expect(fetched).to.be.false;
  });

  it('fetchApps success and failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ apps: [{ id: 'a' }] }));
    const ctx = { apps: [], page: 1, pageSize: 10, total: 0, loading: true, error: null };
    await CatalogAppsView.methods.fetchApps.call(ctx);
    expect(ctx.apps).to.have.lengthOf(1);
    expect(ctx.loading).to.be.false;

    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 500));
    await CatalogAppsView.methods.fetchApps.call(ctx);
    expect(ctx.error).to.equal('err');

    setFetch(originalFetch);
  });

  it('mounted hook executes successfully', async function() {
    let fetched = false;
    const ctx = { fetchApps: async () => { fetched = true; } };
    await CatalogAppsView.mounted.call(ctx);
    expect(fetched).to.be.true;
  });
});

describe('CatalogAppDetailView', function() {
  it('computed and methods', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      if (url.endsWith('/disable')) {
        return mockFetchResponse({});
      }
    });

    const ctx = {
      $route: { params: { id: 'app1' } },
      appId: 'app1',
      app: { id: 'app1', status: 'active' },
      yamlText: 'version: 1.2.3',
      busy: false,
      actionError: '',
      actionSuccess: '',
      loadApp: async function() {}
    };

    expect(CatalogAppDetailView.computed.appId.call(ctx)).to.equal('app1');
    expect(CatalogAppDetailView.computed.canDisable.call(ctx)).to.be.true;
    expect(CatalogAppDetailView.computed.canEnable.call(ctx)).to.be.false;
    expect(CatalogAppDetailView.computed.parsedVersion.call(ctx)).to.equal('1.2.3');

    await CatalogAppDetailView.methods.disableApp.call(ctx);
    expect(ctx.actionSuccess).to.equal('App definition disabled');

    // statusLabelClass and tryFormatBytes paths
    expect(CatalogAppDetailView.methods.statusLabelClass('active')).to.equal('pf-m-green');
    expect(CatalogAppDetailView.methods.statusLabelClass('inactive')).to.equal('pf-m-red');
    expect(CatalogAppDetailView.methods.statusLabelClass('unknown')).to.equal('pf-m-blue');

    expect(CatalogAppDetailView.methods.tryFormatBytes(null)).to.equal('-');
    expect(CatalogAppDetailView.methods.tryFormatBytes('string')).to.equal('string');
    expect(CatalogAppDetailView.methods.tryFormatBytes(1024)).to.equal('1.0 KiB');

    setFetch(originalFetch);
  });

  it('enableApp success and failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({}));
    const ctx = { appId: 'app1', app: { status: 'inactive' }, busy: false, actionError: '', actionSuccess: '', loadApp: async () => {} };
    await CatalogAppDetailView.methods.enableApp.call(ctx);
    expect(ctx.actionSuccess).to.equal('App definition enabled');

    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 400));
    await CatalogAppDetailView.methods.enableApp.call(ctx);
    expect(ctx.actionError).to.equal('err');

    setFetch(originalFetch);
  });

  it('loadApp, loadTiers, and loadVersions', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      if (url.endsWith('/yaml')) return mockFetchResponse({ yaml: 'v: 1' });
      if (url.endsWith('/tiers')) return mockFetchResponse({ tiers: [{ name: 'small' }] });
      if (url.endsWith('/versions')) return mockFetchResponse({ versions: ['1.0'] });
      return mockFetchResponse({ app: { id: 'app1' } });
    });

    const ctx = {
      appId: 'app1', app: null, yamlText: '', loading: true, error: null,
      tiers: [], tiersLoading: false, versions: []
    };

    await CatalogAppDetailView.methods.loadApp.call(ctx);
    expect(ctx.app.id).to.equal('app1');
    expect(ctx.yamlText).to.equal('v: 1');

    await CatalogAppDetailView.methods.loadTiers.call(ctx);
    expect(ctx.tiers).to.have.lengthOf(1);

    await CatalogAppDetailView.methods.loadVersions.call(ctx);
    expect(ctx.versions).to.deep.equal(['1.0']);

    setFetch(originalFetch);
  });

  it('covers CatalogAppDetailView mounted', function() {
    let appLoaded = false;
    let tiersLoaded = false;
    let versionsLoaded = false;
    const ctx = {
      loadApp: () => { appLoaded = true; },
      loadTiers: () => { tiersLoaded = true; },
      loadVersions: () => { versionsLoaded = true; }
    };
    CatalogAppDetailView.mounted.call(ctx);
    expect(appLoaded).to.be.true;
    expect(tiersLoaded).to.be.true;
    expect(versionsLoaded).to.be.true;
  });

  it('covers disableApp and enableApp when confirm is false', async function() {
    const originalConfirm = window.confirm;
    window.confirm = () => false;
    const ctx = { appId: 'app1' };
    await CatalogAppDetailView.methods.disableApp.call(ctx);
    await CatalogAppDetailView.methods.enableApp.call(ctx);
    window.confirm = originalConfirm;
  });
});

describe('CatalogAppFormView', function() {
  it('extracts and sets YAML values', function() {
    const ctx = CatalogAppFormView.data();
    const testYaml = "name: initial-name\nversion: 1.0.0";
    expect(CatalogAppFormView.methods.extractNameFromYaml(testYaml)).to.equal('initial-name');
    expect(CatalogAppFormView.methods.extractVersionFromYaml(testYaml)).to.equal('1.0.0');

    const updated = CatalogAppFormView.methods.setNameInYaml(testYaml, 'new-name');
    expect(updated).to.include('name: new-name');

    const updatedV = CatalogAppFormView.methods.setVersionInYaml(testYaml, '2.0.0');
    expect(updatedV).to.include('version: 2.0.0');
  });

  it('saveApp success and failure', async function() {
    const originalFetch = global.fetch;
    let pushed = null;
    setFetch(async () => mockFetchResponse({ id: 'app1' }));
    const ctx = {
      appName: 'app1', appVersion: '1.0', yamlText: 'name: app1', isEdit: false,
      saving: false, error: '', success: '', $router: { push: (p) => { pushed = p; } },
      setNameInYaml: CatalogAppFormView.methods.setNameInYaml,
      setVersionInYaml: CatalogAppFormView.methods.setVersionInYaml
    };

    await CatalogAppFormView.methods.saveApp.call(ctx);
    expect(pushed).to.equal('/catalog/apps/app1');

    setFetch(async () => mockFetchResponse({ error: 'failed save' }, false, 400));
    await CatalogAppFormView.methods.saveApp.call(ctx);
    expect(ctx.error).to.equal('failed save');

    setFetch(originalFetch);
  });

  it('loadYaml success, failure and edge cases', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ yaml: 'name: appX\nversion: 2.0' }));
    const ctx = {
      isEdit: true, appId: 'appX', loading: true, yamlText: '', appName: '', appVersion: '', error: '',
      extractNameFromYaml: CatalogAppFormView.methods.extractNameFromYaml,
      extractVersionFromYaml: CatalogAppFormView.methods.extractVersionFromYaml
    };
    await CatalogAppFormView.methods.loadYaml.call(ctx);
    expect(ctx.appName).to.equal('appX');
    expect(ctx.loading).to.be.false;

    // isEdit false triggers default template
    ctx.isEdit = false;
    await CatalogAppFormView.methods.loadYaml.call(ctx);
    expect(ctx.appName).to.equal('example-app');

    setFetch(originalFetch);
  });

  it('triggers onNameInput and onVersionInput', function() {
    const ctx = {
      appName: 'newApp', appVersion: '2.0', yamlText: 'name: oldApp\nversion: 1.0',
      extractNameFromYaml: CatalogAppFormView.methods.extractNameFromYaml,
      setNameInYaml: CatalogAppFormView.methods.setNameInYaml,
      extractVersionFromYaml: CatalogAppFormView.methods.extractVersionFromYaml,
      setVersionInYaml: CatalogAppFormView.methods.setVersionInYaml
    };
    CatalogAppFormView.methods.onNameInput.call(ctx);
    expect(ctx.yamlText).to.include('name: newApp');

    CatalogAppFormView.methods.onVersionInput.call(ctx);
    expect(ctx.yamlText).to.include('version: 2.0');
  });
});

describe('InstancesView', function() {
  it('changePage and status/health labels', function() {
    const ctx = InstancesView.data();
    expect(InstancesView.methods.statusLabelClass('running')).to.equal('pf-m-green');
    expect(InstancesView.methods.healthLabelClass('healthy')).to.equal('pf-m-green');

    let pageChanged = false;
    ctx.fetchInstances = () => { pageChanged = true; };
    InstancesView.methods.changePage.call(ctx, 2);
    expect(ctx.page).to.equal(2);
    expect(pageChanged).to.be.true;
  });

  it('action success and failure', async function() {
    const originalFetch = global.fetch;
    let triggeredUrl = null;
    setFetch(async (url) => {
      triggeredUrl = url;
      return mockFetchResponse({});
    });
    const ctx = {
      actionLoading: {},
      fetchInstances: async () => {}
    };
    await InstancesView.methods.action.call(ctx, { id: 'i1' }, 'resume');
    expect(triggeredUrl).to.include('/flagship/api/instances/i1/action');

    // Failure toast trigger
    let toastType = null;
    window.showToast = (type) => { toastType = type; };
    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 400));
    await InstancesView.methods.action.call(ctx, { id: 'i1' }, 'resume');
    expect(toastType).to.equal('danger');

    setFetch(originalFetch);
  });
});

describe('InstanceCreateView', function() {
  it('loadForm and computed properties', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      if (url.includes('/catalog/apps')) {
        return mockFetchResponse({ items: [{ id: 'app1', name: 'app1', status: 'active' }] });
      }
      return mockFetchResponse({ items: [{ id: 'node1', hostname: 'host1', status: 'online' }] });
    });

    const ctx = {
      apps: [], nodes: [], loading: true, error: '',
      form: { customer_id: 'cust1', app_id: 'app1', tier_name: 't1', node_id: 'node1' },
      tiers: [{ name: 't1', cpu: 1, memory: 1024, storage: 10 }]
    };

    await InstanceCreateView.methods.loadForm.call(ctx);
    expect(ctx.apps).to.have.lengthOf(1);
    expect(ctx.loading).to.be.false;

    // computed properties
    expect(InstanceCreateView.computed.activeApps.call(ctx)).to.have.lengthOf(1);
    expect(InstanceCreateView.computed.selectedAppName.call(ctx)).to.equal('app1');
    expect(InstanceCreateView.computed.selectedTier.call(ctx).name).to.equal('t1');
    expect(InstanceCreateView.computed.selectedNodeName.call(ctx)).to.equal('host1');

    setFetch(originalFetch);
  });

  it('triggers onAppChange', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ tiers: [{ name: 'large' }] }));
    const ctx = { form: { app_id: 'app1', tier_name: 't1' }, tiers: [], error: '' };
    await InstanceCreateView.methods.onAppChange.call(ctx);
    expect(ctx.tiers).to.have.lengthOf(1);
    expect(ctx.form.tier_name).to.equal('');

    setFetch(originalFetch);
  });
});

describe('InstanceProvisionedView', function() {
  it('handles snapshot and computed details', function() {
    const ctx = {
      $route: { params: { operation_id: 'op_abc' } },
      snapshot: { hostname: 'snapshot.host' },
      instance: { customer_id: 'c_abc', app_definition_name: 'wp' },
      job: { status: 'running' }
    };

    expect(InstanceProvisionedView.computed.operationId.call(ctx)).to.equal('op_abc');
    expect(InstanceProvisionedView.computed.jobStatus.call(ctx)).to.equal('running');
    expect(InstanceProvisionedView.computed.customerId.call(ctx)).to.equal('c_abc');
    expect(InstanceProvisionedView.computed.appName.call(ctx)).to.equal('wp');
    expect(InstanceProvisionedView.computed.hostname.call(ctx)).to.equal('snapshot.host');
  });

  it('loadPage runs successfully', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      if (url.includes('/jobs/')) {
        return mockFetchResponse({ instance_id: 'i1', status: 'completed' });
      }
      if (url.includes('/instances/i1/credentials')) {
        return mockFetchResponse({ credentials: [{ service: 's', name: 'n', value: 'v' }] });
      }
      return mockFetchResponse({});
    });

    const ctx = {
      operationId: 'op_1',
      loading: true, error: '', jobError: '', snapshot: null, instance: null, job: null, credentials: [],
      loadProvisionSnapshot: () => ({ credentials: [] }),
      loadJob: InstanceProvisionedView.methods.loadJob,
      loadInstance: async function(id) { this.instance = { id }; },
      loadCredentials: async function(id) { this.credentials = [{ name: 'pw' }]; }
    };

    await InstanceProvisionedView.methods.loadProvisionPage.call(ctx);
    expect(ctx.loading).to.be.false;
    expect(ctx.credentials).to.have.lengthOf(1);

    setFetch(originalFetch);
  });
});

describe('InstanceDetailView', function() {
  it('computes correctly', function() {
    const ctx = {
      $route: { params: { id: 'inst_123' } },
      instanceId: 'inst_123',
      instanceBackups: [
        { id: 'b1', created_at: '2025-01-02T00:00:00Z' },
        { id: 'b2', created_at: '2025-01-01T00:00:00Z' }
      ],
      backupsLoading: false,
      deprovisionConfirmInput: 'inst_123'
    };

    expect(InstanceDetailView.computed.instanceId.call(ctx)).to.equal('inst_123');
    expect(InstanceDetailView.computed.backupCountLabel.call(ctx)).to.equal('2');
    expect(InstanceDetailView.computed.latestBackupTimestamp.call(ctx)).to.equal('2025-01-02T00:00:00Z');
    expect(InstanceDetailView.computed.deprovisionReady.call(ctx)).to.be.true;
  });

  it('triggers backup successfully', async function() {
    const originalFetch = global.fetch;
    let triggered = null;

    setFetch(async (url, opts) => {
      expect(url).to.equal('/flagship/api/backups/trigger');
      triggered = JSON.parse(opts.body);
      return mockFetchResponse({ operation_id: 'op_bk_99' });
    });

    const ctx = {
      instanceId: 'inst_123',
      backupBusy: false,
      backupError: '',
      backupSuccess: ''
    };

    await InstanceDetailView.methods.triggerBackup.call(ctx, 'database');

    expect(triggered).to.deep.equal({ instance_id: 'inst_123', kind: 'database' });
    expect(ctx.backupSuccess).to.include('op_bk_99');

    setFetch(originalFetch);
  });

  it('doResize action success and failure', async function() {
    const originalFetch = global.fetch;
    let payload = null;
    setFetch(async (url, opts) => {
      payload = JSON.parse(opts.body);
      return mockFetchResponse({});
    });
    const ctx = {
      instanceId: 'i1', selectedTier: 'large', resizeBusy: false, resizeResult: '',
      loadInstance: async () => {}, loadOperations: async () => {}, actionError: ''
    };
    await InstanceDetailView.methods.doResize.call(ctx);
    expect(payload).to.deep.equal({ action: 'resize', tier: 'large' });
    expect(ctx.resizeResult).to.include('large');

    // Reset selectedTier for failure test
    ctx.selectedTier = 'large';
    setFetch(async () => mockFetchResponse({ error: 'fail' }, false, 400));
    await InstanceDetailView.methods.doResize.call(ctx);
    expect(ctx.actionError).to.equal('fail');

    setFetch(originalFetch);
  });

  it('modal toggles, migrate, load credentials', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
      if (urlStr.endsWith('/credentials')) return mockFetchResponse({ credentials: [{ name: 'api_key' }] });
      if (urlStr.endsWith('/nodes') || urlStr.includes('/nodes?')) return mockFetchResponse({ nodes: [{ id: 'node1', status: 'online' }] });
      return mockFetchResponse({ operation_id: 'op_mig' });
    });

    const ctx = {
      showDeprovisionModal: false, showMigrateModal: false, deprovisionConfirmInput: 'x', deprovisionError: 'err',
      migrateNodeId: 'node1', instanceId: 'i1', migrateBusy: false, migrateError: '', migrateSuccess: '',
      availableNodes: [], credentialsLoading: false, credentialsError: '', credentials: [], showCredentials: false,
      loadCredentials: InstanceDetailView.methods.loadCredentials
    };

    InstanceDetailView.methods.openDeprovisionModal.call(ctx);
    expect(ctx.showDeprovisionModal).to.be.true;
    InstanceDetailView.methods.closeDeprovisionModal.call(ctx);
    expect(ctx.showDeprovisionModal).to.be.false;

    await InstanceDetailView.methods.doMigrate.call(ctx);
    expect(ctx.migrateSuccess).to.include('op_mig');

    await InstanceDetailView.methods.loadAvailableNodes.call(ctx);
    expect(ctx.availableNodes).to.have.lengthOf(1);

    await InstanceDetailView.methods.loadCredentials.call(ctx);
    expect(ctx.credentials).to.have.lengthOf(1);

    InstanceDetailView.methods.toggleCredentials.call(ctx);
    expect(ctx.showCredentials).to.be.true;

    setFetch(originalFetch);
  });

  it('InstanceDetailView mounted runs all loaders', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
      if (urlStr.includes('/tiers')) return mockFetchResponse({ tiers: [{ name: 'large' }] });
      if (urlStr.includes('/operations')) return mockFetchResponse({ operations: [{ id: 'op1', status: 'success' }] });
      if (urlStr.includes('/backups')) return mockFetchResponse({ backups: [{ id: 'bk1' }] });
      return mockFetchResponse({ instance: { id: 'i1' } });
    });

    const ctx = {
      instanceId: 'i1',
      loading: true,
      loadInstance: InstanceDetailView.methods.loadInstance,
      loadTiers: InstanceDetailView.methods.loadTiers,
      loadOperations: InstanceDetailView.methods.loadOperations,
      loadBackups: InstanceDetailView.methods.loadBackups,
      // data fields
      tiers: [],
      operations: [],
      instanceBackups: [],
      opsLoading: false,
      backupsLoading: false,
      tiersLoading: false
    };

    await InstanceDetailView.mounted.call(ctx);

    expect(ctx.loading).to.be.false;
    expect(ctx.tiers).to.have.lengthOf(1);
    expect(ctx.operations).to.have.lengthOf(1);
    expect(ctx.instanceBackups).to.have.lengthOf(1);

    setFetch(originalFetch);
  });
});

describe('InstanceRestoreView', function() {
  it('restores backup successfully', async function() {
    const originalFetch = global.fetch;
    let restorePayload = null;

    setFetch(async (url, opts) => {
      expect(url).to.equal('/flagship/api/backups/restore');
      restorePayload = JSON.parse(opts.body);
      return mockFetchResponse({ operation_id: 'op_res_1' });
    });

    const ctx = {
      instanceId: 'inst_123',
      form: { backup_id: 'backup_99' },
      submitting: false,
      error: '',
      success: ''
    };

    await InstanceRestoreView.methods.requestRestore.call(ctx);

    expect(restorePayload).to.deep.equal({ backup_id: 'backup_99', target_app_id: 'inst_123' });
    expect(ctx.success).to.include('op_res_1');

    setFetch(originalFetch);
  });

  it('loadPage parses data', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      if (url.includes('/instances/')) return mockFetchResponse({ id: 'i1' });
      return mockFetchResponse({ backups: [{ id: 'b1' }] });
    });

    const ctx = { instanceId: 'i1', loading: true, error: '', instance: null, backups: [], form: { backup_id: '' } };
    await InstanceRestoreView.methods.loadPage.call(ctx);
    expect(ctx.loading).to.be.false;
    expect(ctx.instance.id).to.equal('i1');
    expect(ctx.backups).to.have.lengthOf(1);

    setFetch(originalFetch);
  });

  it('covers backupLabel branches', function() {
    const backup1 = { id: 'b1', type: 'database', status: 'completed', created_at: '2025' };
    const label1 = InstanceRestoreView.methods.backupLabel(backup1);
    expect(label1).to.equal('b1 | database | completed | 2025');

    const backup2 = { backup_id: 'b2', backup_type: 'volumes', status: null, created: '2026' };
    const label2 = InstanceRestoreView.methods.backupLabel(backup2);
    expect(label2).to.equal('b2 | volumes | unknown | 2026');

    const backup3 = { id: null, type: null, status: null, timestamp: '2027' };
    const label3 = InstanceRestoreView.methods.backupLabel(backup3);
    expect(label3).to.equal('- | database | unknown | 2027');
  });
});

describe('BackupsView', function() {
  it('deletes backup with confirmation', async function() {
    const originalFetch = global.fetch;
    let deletedId = null;

    setFetch(async (url, opts) => {
      expect(opts.method).to.equal('DELETE');
      deletedId = url;
      return mockFetchResponse({});
    });

    const ctx = {
      deleteLoading: {},
      fetchBackups: async function() {}
    };

    await BackupsView.methods.deleteBackup.call(ctx, { id: 'bk_99' });

    expect(deletedId).to.include('/flagship/api/backups/bk_99');

    setFetch(originalFetch);
  });

  it('prunes backups successfully', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ pruned_backups_count: 3 }));
    const ctx = { pruneBusy: false, fetchBackups: async () => {} };
    await BackupsView.methods.pruneBackups.call(ctx);
    expect(ctx.pruneBusy).to.be.false;
    setFetch(originalFetch);
  });

  it('fetchBackups success and failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ backups: [{ id: 'b1' }] }));
    const ctx = { backups: [], loading: true, error: null, page: 1, pageSize: 20, total: 0, instanceFilter: 'inst1' };
    await BackupsView.methods.fetchBackups.call(ctx);
    expect(ctx.backups).to.have.lengthOf(1);

    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 400));
    await BackupsView.methods.fetchBackups.call(ctx);
    expect(ctx.error).to.equal('err');

    setFetch(originalFetch);
  });

  it('prune and delete failure paths', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ error: 'fail' }, false, 400));
    let toastType = null;
    window.showToast = (type) => { toastType = type; };
    const ctx = { pruneBusy: false, deleteLoading: {}, fetchBackups: async () => {} };
    await BackupsView.methods.pruneBackups.call(ctx);
    expect(toastType).to.equal('danger');

    await BackupsView.methods.deleteBackup.call(ctx, { id: 'bk_1' });
    expect(toastType).to.equal('danger');

    setFetch(originalFetch);
  });

  it('covers BackupsView filters and changePage', function() {
    let reloaded = false;
    const ctx = { page: 1, fetchBackups: () => { reloaded = true; } };
    BackupsView.methods.applyFilter.call(ctx);
    expect(reloaded).to.be.true;

    reloaded = false;
    BackupsView.methods.changePage.call(ctx, 2);
    expect(ctx.page).to.equal(2);
    expect(reloaded).to.be.true;

    // early return
    reloaded = false;
    BackupsView.methods.changePage.call(ctx, 2);
    expect(reloaded).to.be.false;
  });
});

describe('BackupDetailView', function() {
  it('loads backup from bff', async function() {
    const originalFetch = global.fetch;
    setFetch(async (url) => {
      expect(url).to.include('/flagship/api/backups/bk_1');
      return mockFetchResponse({ backup: { id: 'bk_1', size_bytes: 1024 } });
    });

    const ctx = {
      backupId: 'bk_1',
      backup: null,
      loading: true,
      error: null
    };

    await BackupDetailView.methods.loadBackup.call(ctx);

    expect(ctx.backup.id).to.equal('bk_1');
    expect(ctx.loading).to.be.false;

    setFetch(originalFetch);
  });

  it('deleteBackup and load failure', async function() {
    const originalFetch = global.fetch;
    let redirect = null;
    setFetch(async () => mockFetchResponse({}));
    const ctx = {
      backupId: 'bk_1', deleteBusy: false, error: '', $router: { push: (p) => { redirect = p; } },
      loadBackup: async () => {}
    };

    await BackupDetailView.methods.deleteBackup.call(ctx);
    expect(redirect).to.equal('/backups');

    setFetch(async () => mockFetchResponse({ error: 'load fail' }, false, 400));
    await BackupDetailView.methods.loadBackup.call(ctx);
    expect(ctx.error).to.equal('load fail');

    setFetch(originalFetch);
  });
});

describe('BackupSettingsView', function() {
  it('loads settings successfully', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ settings: { backend: 's3' } }));
    const ctx = { loading: true, error: null, settings: {} };
    await BackupSettingsView.methods.loadSettings.call(ctx);
    expect(ctx.settings.backend).to.equal('s3');
    expect(ctx.loading).to.be.false;
    setFetch(originalFetch);
  });

  it('loadSettings failure sets error', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ error: 'fail' }, false, 400));
    const ctx = { loading: true, error: null, settings: {} };
    await BackupSettingsView.methods.loadSettings.call(ctx);
    expect(ctx.error).to.equal('fail');
    setFetch(originalFetch);
  });
});

describe('JobsView and JobDetailView', function() {
  it('computes duration and progress for job detail', function() {
    const ctx = {
      job: {
        id: 'job_1',
        duration_seconds: null,
        started_at: '2025-01-01T00:00:00Z',
        completed_at: '2025-01-01T00:02:30Z',
        progress_percent: 45
      }
    };

    expect(JobDetailView.computed.durationSeconds.call(ctx)).to.equal(150);
    expect(JobDetailView.computed.progressPercent.call(ctx)).to.equal(45);
  });

  it('fetchJobs success and failure', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ jobs: [{ id: 'j1' }] }));
    const ctx = { jobs: [], page: 1, pageSize: 20, total: 0, loading: true, error: null, statusFilter: '' };
    await JobsView.methods.fetchJobs.call(ctx);
    expect(ctx.jobs).to.have.lengthOf(1);

    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 400));
    await JobsView.methods.fetchJobs.call(ctx);
    expect(ctx.error).to.equal('err');

    setFetch(originalFetch);
  });

  it('covers JobsView actions and pagination', function() {
    let reloaded = false;
    const ctx = { page: 1, statusFilter: 'online', fetchJobs: () => { reloaded = true; } };

    JobsView.methods.applyFilter.call(ctx);
    expect(reloaded).to.be.true;

    reloaded = false;
    JobsView.methods.clearFilters.call(ctx);
    expect(ctx.statusFilter).to.equal('');
    expect(reloaded).to.be.true;

    reloaded = false;
    JobsView.methods.changePage.call(ctx, 2);
    expect(ctx.page).to.equal(2);
    expect(reloaded).to.be.true;

    reloaded = false;
    JobsView.methods.changePage.call(ctx, 2);
    expect(reloaded).to.be.false;
  });

  it('covers JobDetailView loadJob and computed properties', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ id: 'j1', log_excerpt: 'logs' }));
    const ctx = { jobId: 'j1', job: null, loading: true, error: null };

    await JobDetailView.methods.loadJob.call(ctx);
    expect(ctx.job.id).to.equal('j1');
    expect(ctx.loading).to.be.false;

    // computed property recentLogText
    expect(JobDetailView.computed.recentLogText.call({ job: null })).to.equal('');
    expect(JobDetailView.computed.recentLogText.call({ job: { logs: 'l' } })).to.equal('l');
    expect(JobDetailView.computed.recentLogText.call({ job: { log: 'l2' } })).to.equal('l2');
    expect(JobDetailView.computed.recentLogText.call({ job: { error_message: 'err' } })).to.equal('err');

    // loadJob failure
    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 400));
    await JobDetailView.methods.loadJob.call(ctx);
    expect(ctx.error).to.equal('err');

    setFetch(originalFetch);
  });

  it('covers statusLabelClass and mounted of JobDetailView', function() {
    expect(JobDetailView.methods.statusLabelClass('completed')).to.equal('pf-m-green');
    let loaded = false;
    const ctx = { loadJob: () => { loaded = true; } };
    JobDetailView.mounted.call(ctx);
    expect(loaded).to.be.true;
  });
});

describe('ChangePasswordView', function() {
  it('performs passwords comparison and validation', async function() {
    const ctx = {
      currentPassword: 'old_password',
      newPassword: 'short',
      confirmPassword: 'short',
      error: '',
      loading: false,
      success: false
    };

    await ChangePasswordView.methods.changePassword.call(ctx);
    expect(ctx.error).to.include('must be at least 12 characters');

    ctx.newPassword = 'longer_password_123';
    ctx.confirmPassword = 'mismatch_password';
    await ChangePasswordView.methods.changePassword.call(ctx);
    expect(ctx.error).to.include('do not match');
  });

  it('password change success path', async function() {
    const originalFetch = global.fetch;
    let payload = null;
    setFetch(async (url, opts) => {
      payload = JSON.parse(opts.body);
      return mockFetchResponse({});
    });
    const ctx = {
      currentPassword: 'old_pw_long_123', newPassword: 'new_pw_long_123', confirmPassword: 'new_pw_long_123',
      loading: false, success: false, error: '', $route: { query: {} }
    };
    await ChangePasswordView.methods.changePassword.call(ctx);
    expect(ctx.success).to.be.true;
    expect(payload.new_password).to.equal('new_pw_long_123');
    setFetch(originalFetch);
  });

  it('covers ChangePasswordView.data()', function() {
    const data = ChangePasswordView.data();
    expect(data.currentPassword).to.equal('');
  });

  it('covers catch block of ChangePasswordView changePassword', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ error: 'bff error' }, false, 400));
    const ctx = {
      currentPassword: 'old_pw_long_123', newPassword: 'new_pw_long_123', confirmPassword: 'new_pw_long_123',
      loading: false, success: false, error: '', $route: { query: {} }
    };
    await ChangePasswordView.methods.changePassword.call(ctx);
    expect(ctx.error).to.equal('bff error');
    setFetch(originalFetch);
  });

  it('covers firstLogin change password success and failure paths', async function() {
    const originalFetch = global.fetch;
    let loginPayload = null;
    setFetch(async (url, opts) => {
      if (url.includes('/auth/login')) {
        loginPayload = JSON.parse(opts.body);
      }
      return mockFetchResponse({});
    });

    originalWin.__location_href = '';

    const ctx = {
      currentPassword: 'old_pw_long_123', newPassword: 'new_pw_long_123', confirmPassword: 'new_pw_long_123',
      loading: false, success: false, error: '', $route: { query: { first_login: '1', username: 'admin' } }
    };

    await ChangePasswordView.methods.changePassword.call(ctx);
    expect(ctx.success).to.be.true;
    expect(loginPayload).to.deep.equal({ username: 'admin', password: 'new_pw_long_123' });
    expect(originalWin.__location_href).to.equal('/');

    // bff login fail inside firstLogin changePassword
    ctx.success = false;
    ctx.error = '';
    setFetch(async (url) => {
      if (url.includes('/auth/login')) {
        return mockFetchResponse({ error: 'login fail' }, false, 401);
      }
      return mockFetchResponse({});
    });

    await ChangePasswordView.methods.changePassword.call(ctx);
    expect(ctx.error).to.include('Please login with your new password');

    setFetch(originalFetch);
  });
});

describe('ChangePasswordStandaloneView', function() {
  it('password change success and failure', async function() {
    const originalFetch = global.fetch;
    let payload = null;
    setFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (url.includes('/change-password')) {
        payload = body;
      }
      return mockFetchResponse({});
    });

    const ctx = {
      currentPassword: 'old_pw_long_123', newPassword: 'new_pw_long_123', confirmPassword: 'new_pw_long_123',
      loading: false, success: false, error: '', $route: { query: { username: 'admin' } }
    };

    await ChangePasswordStandaloneView.methods.changePassword.call(ctx);
    expect(ctx.success).to.be.true;
    expect(payload.new_password).to.equal('new_pw_long_123');

    // failure path
    ctx.success = false;
    setFetch(async () => mockFetchResponse({ error: 'invalid' }, false, 400));
    await ChangePasswordStandaloneView.methods.changePassword.call(ctx);
    expect(ctx.error).to.equal('invalid');

    setFetch(originalFetch);
  });

  it('covers standalone change password logic without query username', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({}));
    const ctx = {
      currentPassword: 'old_pw_long_123', newPassword: 'new_pw_long_123', confirmPassword: 'new_pw_long_123',
      loading: false, success: false, error: '', $route: { query: {} }
    };
    originalWin.appState = { username: 'user_fallback' };

    await ChangePasswordStandaloneView.methods.changePassword.call(ctx);
    expect(ctx.success).to.be.true;

    // standalone login failure path
    ctx.success = false;
    ctx.error = '';
    originalWin.appState = { username: 'user_fallback' }; // Reset appState!
    setFetch(async (url) => {
      if (url.includes('/auth/login')) {
        return mockFetchResponse({ error: 'login fail' }, false, 401);
      }
      return mockFetchResponse({});
    });
    await ChangePasswordStandaloneView.methods.changePassword.call(ctx);
    expect(ctx.error).to.include('Please login with your new password');

    setFetch(originalFetch);
  });

  it('covers ChangePasswordStandaloneView.data()', function() {
    const data = ChangePasswordStandaloneView.data();
    expect(data.currentPassword).to.equal('');
  });

  it('covers standalone change password validations', async function() {
    const ctx = {
      currentPassword: 'old', newPassword: 'short', confirmPassword: 'short',
      error: '', loading: false
    };
    await ChangePasswordStandaloneView.methods.changePassword.call(ctx);
    expect(ctx.error).to.include('at least 12 characters');

    ctx.newPassword = 'long_new_pw_123';
    ctx.confirmPassword = 'mismatch_pw_123';
    await ChangePasswordStandaloneView.methods.changePassword.call(ctx);
    expect(ctx.error).to.include('do not match');
  });
});

describe('Root Application Component (app)', function() {
  it('toggleSidebar collapsed state', function() {
    const ctx = {
      sidebarOpen: false,
      sidebarCollapsed: false
    };

    const originalInnerWidth = window.innerWidth;

    Object.defineProperty(originalWin, 'innerWidth', {
      value: 1024,
      configurable: true
    });

    rootAppConfig.methods.toggleSidebar.call(ctx);
    expect(ctx.sidebarCollapsed).to.be.true;

    Object.defineProperty(originalWin, 'innerWidth', {
      value: 500,
      configurable: true
    });
    rootAppConfig.methods.toggleSidebar.call(ctx);
    expect(ctx.sidebarOpen).to.be.true;

    Object.defineProperty(originalWin, 'innerWidth', {
      value: originalInnerWidth,
      configurable: true
    });
  });

  it('logout runs successfully', async function() {
    const originalFetch = global.fetch;
    let loggedOut = false;
    setFetch(async () => {
      loggedOut = true;
      return mockFetchResponse({});
    });

    originalWin.__location_reloaded = false;

    const ctx = {};
    await rootAppConfig.methods.logout.call(ctx);
    expect(loggedOut).to.be.true;
    expect(originalWin.__location_reloaded).to.be.true;

    setFetch(originalFetch);
  });

  it('mounted success and failure paths', async function() {
    const originalFetch = global.fetch;
    setFetch(async () => mockFetchResponse({ authenticated: true, username: 'admin', password_change_required: false }));

    const ctx = {
      authenticated: false, checkingAuth: true, username: '', passwordChangeRequired: false, sidebarCollapsed: false
    };

    await rootAppConfig.mounted.call(ctx);
    expect(ctx.authenticated).to.be.true;
    expect(ctx.username).to.equal('admin');
    expect(ctx.checkingAuth).to.be.false;

    // failure path
    setFetch(async () => mockFetchResponse({ error: 'err' }, false, 401));
    await rootAppConfig.mounted.call(ctx);
    expect(ctx.authenticated).to.be.false;

    setFetch(originalFetch);
  });

  it('covers root application watch and computed properties', function() {
    const ctx = { sidebarOpen: true, '$route': { path: '/new-path' } };
    rootAppConfig.watch['$route.path'].call(ctx);
    expect(ctx.sidebarOpen).to.be.false;
  });
});

describe('router navigation guards', function() {
  it('redirects to /change-password if passwordChangeRequired is true', async function() {
    originalWin.appState = { passwordChangeRequired: true, username: 'admin' };

    // First push to another route to ensure transition happens
    await router.push('/nodes');

    // Test transition to /dashboard
    await router.push('/dashboard');
    expect(router.currentRoute.value.path).to.equal('/change-password');
  });
});

describe('All Remaining Branches and Utility Edge Cases', function() {
  it('covers remaining bffFetch paths', async function() {
    const originalFetch = global.fetch;

    // 401 redirect path
    setFetch(async () => mockFetchResponse({}, false, 401));
    originalWin.__location_href = '';
    try {
      await bffFetch('/flagship/api/some-endpoint');
    } catch(e) {}
    expect(originalWin.sessionStorage.getItem('session_expired')).to.equal('1');
    expect(originalWin.__location_href).to.equal('/');

    // non-ok without error field
    setFetch(async () => mockFetchResponse({}, false, 500));
    try {
      await bffFetch('/flagship/api/nodes');
      expect.fail('should have failed');
    } catch(e) {
      expect(e.message).to.include('500');
    }

    // json parsing throw catches
    setFetch(async () => {
      return {
        ok: true,
        headers: { get: () => null },
        json: () => { throw new Error('parse fail'); }
      };
    });
    const data = await bffFetch('/flagship/api/nodes');
    expect(data).to.deep.equal({});

    setFetch(originalFetch);
  });

  it('covers toast timers and close button', function() {
    showToast('info', 'temporary-toast');
    const toast = document.querySelector('.toast');
    expect(toast).to.not.be.null;
    toast.querySelector('.toast-close').click();
    expect(document.querySelector('.toast')).to.be.null;
  });

  it('covers timestamp and relative time helpers additional paths', function() {
    expect(formatTimestamp(null)).to.equal('-');
    expect(formatTimestamp('not-a-date')).to.equal('not-a-date');
    expect(formatTimestamp(new Date().toISOString())).to.not.equal('-');

    expect(formatRelativeTime(null)).to.equal('');
    expect(formatRelativeTime('not-a-date')).to.equal('');
    expect(formatRelativeTime(new Date(Date.now() - 5 * 1000).toISOString())).to.include('s ago');
    expect(formatRelativeTime(new Date(Date.now() - 75 * 1000).toISOString())).to.include('m ago');
    expect(formatRelativeTime(new Date(Date.now() - 3650 * 1000).toISOString())).to.include('h ago');
    expect(formatRelativeTime(new Date(Date.now() - 95000 * 1000).toISOString())).to.include('d ago');
  });

  it('covers all remaining status classes', function() {
    // Instance status variants
    expect(instanceStatusClass('stopped')).to.equal('pf-m-slate');
    expect(instanceStatusClass('deprovisioned')).to.equal('pf-m-slate');
    expect(instanceStatusClass('past_due')).to.equal('pf-m-blue');
    expect(instanceStatusClass('suspended')).to.equal('pf-m-blue');
    expect(instanceStatusClass('setup_failed')).to.equal('pf-m-red');
    expect(instanceStatusClass('unknown_status_x')).to.equal('pf-m-grey');

    // Node status variants
    expect(nodeStatusClass('offline')).to.equal('pf-m-red');
    expect(nodeStatusClass('unreachable')).to.equal('pf-m-red');
    expect(nodeStatusClass('down')).to.equal('pf-m-red');
    expect(nodeStatusClass('pending')).to.equal('pf-m-blue');
    expect(nodeStatusClass('joining')).to.equal('pf-m-blue');
    expect(nodeStatusClass('unknown_status_x')).to.equal('pf-m-grey');

    // Job status variants
    expect(jobStatusClass('success')).to.equal('pf-m-green');
    expect(jobStatusClass('in_progress')).to.equal('pf-m-blue');
    expect(jobStatusClass('pending')).to.equal('pf-m-orange');
    expect(jobStatusClass('cancelled')).to.equal('pf-m-red');
    expect(jobStatusClass('unknown_status_x')).to.equal('pf-m-grey');

    // Backup status variants
    expect(backupStatusClass('success')).to.equal('pf-m-green');
    expect(backupStatusClass('in_progress')).to.equal('pf-m-blue');
    expect(backupStatusClass('error')).to.equal('pf-m-red');
    expect(backupStatusClass('unknown_status_x')).to.equal('pf-m-grey');

    // Health status variants
    expect(healthStatusClass('passing')).to.equal('pf-m-green');
    expect(healthStatusClass('warning')).to.equal('pf-m-orange');
    expect(healthStatusClass('down')).to.equal('pf-m-red');
    expect(healthStatusClass('unknown_status_x')).to.equal('pf-m-grey');
  });

  it('covers job and progress helper additional paths', function() {
    // _durationSecondsFromJob
    expect(_durationSecondsFromJob(null)).to.be.null;
    expect(_durationSecondsFromJob({ started_at: 'not-a-date', completed_at: 'not-a-date' })).to.be.null;
    expect(_durationSecondsFromJob({ created_at: 'not-a-date', completed_at: 'not-a-date' })).to.be.null;
    expect(_durationSecondsFromJob({ started_at: '2025-01-01' })).to.be.null;

    // _progressPercentFromJob
    expect(_progressPercentFromJob(null)).to.be.null;
    expect(_progressPercentFromJob({ progress_percent: '' })).to.be.null;
    expect(_progressPercentFromJob({ percent_complete: 85 })).to.equal(85);
  });
});
