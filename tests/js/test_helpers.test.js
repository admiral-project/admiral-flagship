const { expect } = require('chai');

// setup.js loads app.js into global scope via jsdom
require('./setup');

describe('csrfToken', function() {
  it('reads token from meta tag', function() {
    expect(csrfToken()).to.equal('test-csrf-token');
  });
});

function setFetch(fn) {
  global.fetch = fn;
  global.window.fetch = fn;
}

describe('bffFetch', function() {
  var originalFetch;

  beforeEach(function() {
    originalFetch = global.fetch;
  });

  afterEach(function() {
    setFetch(originalFetch);
  });

  it('sends CSRF token on state-changing methods', async function() {
    var called = false;
    setFetch(async function(url, opts) {
      called = true;
      expect(url).to.equal('/flagship/api/test');
      expect(opts.method).to.equal('POST');
      expect(opts.headers['Content-Type']).to.equal('application/json');
      expect(opts.headers['X-Requested-With']).to.equal('XMLHttpRequest');
      expect(opts.headers['X-CSRF-Token']).to.equal('test-csrf-token');
      return { ok: true, headers: { get: function() { return null; } }, json: async function() { return {}; } };
    });
    await bffFetch('/flagship/api/test', { method: 'POST' });
    expect(called).to.be.true;
  });

  it('does not send CSRF token on GET requests', async function() {
    setFetch(async function(url, opts) {
      expect(opts.headers['X-CSRF-Token']).to.be.undefined;
      return { ok: true, headers: { get: function() { return null; } }, json: async function() { return {}; } };
    });
    await bffFetch('/flagship/api/test');
  });

  it('throws on non-ok response', async function() {
    setFetch(async function() {
      return { ok: false, status: 400, headers: { get: function() { return null; } }, json: async function() { return { error: 'bad request' }; } };
    });
    try {
      await bffFetch('/flagship/api/test');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e.message).to.include('bad request');
    }
  });

  it('rotates CSRF token from response header', async function() {
    setFetch(async function() {
      return { ok: true, headers: { get: function(h) { return h === 'X-CSRF-Token' ? 'new-token' : null; } }, json: async function() { return {}; } };
    });
    await bffFetch('/flagship/api/test', { method: 'POST' });
    var meta = document.querySelector('meta[name="csrf-token"]');
    expect(meta.getAttribute('content')).to.equal('new-token');
  });
});

describe('apiUrl', function() {
  it('prepends /flagship/api prefix', function() {
    expect(apiUrl('/auth/login')).to.equal('/flagship/api/auth/login');
  });

  it('handles empty path', function() {
    expect(apiUrl('')).to.equal('/flagship/api');
  });
});

describe('buildPagedUrl', function() {
  it('returns default page and page_size', function() {
    var url = buildPagedUrl('/test');
    expect(url).to.equal('/test?page=1&page_size=20');
  });

  it('accepts custom page and page_size', function() {
    var url = buildPagedUrl('/test', 3, 50);
    expect(url).to.equal('/test?page=3&page_size=50');
  });

  it('includes extra params, skipping undefined/null/empty', function() {
    var url = buildPagedUrl('/test', 1, 20, { status: 'active', tag: undefined, extra: '' });
    expect(url).to.equal('/test?page=1&page_size=20&status=active');
  });
});

describe('normalizePagedData', function() {
  it('returns paginated structure when data has items array', function() {
    var result = normalizePagedData({ items: [{ id: 1 }], page: 2, page_size: 10, total: 1 });
    expect(result).to.deep.equal({ items: [{ id: 1 }], page: 2, pageSize: 10, total: 1 });
  });

  it('falls back to legacy key', function() {
    var result = normalizePagedData({ nodes: [{ id: 1 }] }, 'nodes');
    expect(result.items).to.deep.equal([{ id: 1 }]);
    expect(result.page).to.equal(1);
  });

  it('handles plain array', function() {
    var result = normalizePagedData([{ id: 1 }, { id: 2 }]);
    expect(result.items).to.deep.equal([{ id: 1 }, { id: 2 }]);
    expect(result.total).to.equal(2);
  });

  it('handles null/undefined', function() {
    var result = normalizePagedData(null);
    expect(result.items).to.deep.equal([]);
  });
});

describe('formatBytes', function() {
  it('returns 0 B for zero', function() {
    expect(formatBytes(0)).to.equal('0 B');
  });

  it('returns 0 B for null/undefined', function() {
    expect(formatBytes(null)).to.equal('0 B');
    expect(formatBytes(undefined)).to.equal('0 B');
  });

  it('formats bytes', function() {
    expect(formatBytes(1024)).to.equal('1.0 KiB');
    expect(formatBytes(1048576)).to.equal('1.0 MiB');
    expect(formatBytes(1073741824)).to.equal('1.0 GiB');
  });

  it('handles fractional values', function() {
    expect(formatBytes(1536)).to.equal('1.5 KiB');
  });
});

describe('formatTimestamp', function() {
  it('returns dash for null/undefined', function() {
    expect(formatTimestamp(null)).to.equal('-');
    expect(formatTimestamp(undefined)).to.equal('-');
  });

  it('returns original value if not parseable', function() {
    expect(formatTimestamp('not-a-date')).to.equal('not-a-date');
  });
});

describe('formatDuration', function() {
  it('handles null/undefined/empty', function() {
    expect(formatDuration(null)).to.equal('-');
    expect(formatDuration(undefined)).to.equal('-');
    expect(formatDuration('')).to.equal('-');
  });

  it('returns seconds for < 60', function() {
    expect(formatDuration(45)).to.equal('45s');
  });

  it('returns minutes and seconds for < 3600', function() {
    expect(formatDuration(125)).to.equal('2m 5s');
  });

  it('returns hours and minutes for >= 3600', function() {
    expect(formatDuration(3661)).to.equal('1h 1m');
  });

  it('handles non-finite values', function() {
    expect(formatDuration('abc')).to.equal('-');
    expect(formatDuration(-1)).to.equal('-');
  });
});

describe('formatRelativeTime', function() {
  it('returns empty string for null/undefined', function() {
    expect(formatRelativeTime(null)).to.equal('');
    expect(formatRelativeTime(undefined)).to.equal('');
  });

  it('returns seconds ago for < 60s', function() {
    var d = new Date(Date.now() - 30 * 1000);
    expect(formatRelativeTime(d.toISOString())).to.match(/\d+s ago/);
  });

  it('returns minutes ago for < 3600s', function() {
    var d = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(d.toISOString())).to.match(/\d+m ago/);
  });

  it('returns hours ago for < 86400s', function() {
    var d = new Date(Date.now() - 3 * 3600 * 1000);
    expect(formatRelativeTime(d.toISOString())).to.match(/\d+h ago/);
  });

  it('returns days ago for >= 86400s', function() {
    var d = new Date(Date.now() - 2 * 86400 * 1000);
    expect(formatRelativeTime(d.toISOString())).to.match(/\d+d ago/);
  });
});

describe('normalizeStatus', function() {
  it('lowercases (no trim)', function() {
    expect(normalizeStatus('Running')).to.equal('running');
    expect(normalizeStatus('  Running ')).to.equal('  running ');
  });

  it('handles null/undefined', function() {
    expect(normalizeStatus(null)).to.equal('');
  });
});

describe('instanceStatusClass', function() {
  it('returns pf-m-green for running', function() {
    expect(instanceStatusClass('running')).to.equal('pf-m-green');
  });

  it('returns pf-m-orange for paused', function() {
    expect(instanceStatusClass('paused')).to.equal('pf-m-orange');
  });

  it('returns pf-m-red for error/failed', function() {
    expect(instanceStatusClass('error')).to.equal('pf-m-red');
    expect(instanceStatusClass('failed')).to.equal('pf-m-red');
  });

  it('returns pf-m-grey for unknown status', function() {
    expect(instanceStatusClass('unknown')).to.equal('pf-m-grey');
  });
});

describe('nodeStatusClass', function() {
  it('returns pf-m-green for active/online/healthy', function() {
    expect(nodeStatusClass('active')).to.equal('pf-m-green');
    expect(nodeStatusClass('online')).to.equal('pf-m-green');
    expect(nodeStatusClass('healthy')).to.equal('pf-m-green');
  });

  it('returns pf-m-red for offline/unreachable/down', function() {
    expect(nodeStatusClass('offline')).to.equal('pf-m-red');
    expect(nodeStatusClass('down')).to.equal('pf-m-red');
  });
});

describe('jobStatusClass', function() {
  it('returns pf-m-green for completed/succeeded', function() {
    expect(jobStatusClass('completed')).to.equal('pf-m-green');
    expect(jobStatusClass('succeeded')).to.equal('pf-m-green');
  });

  it('returns pf-m-red for failed/error', function() {
    expect(jobStatusClass('failed')).to.equal('pf-m-red');
    expect(jobStatusClass('error')).to.equal('pf-m-red');
  });
});

describe('backupStatusClass', function() {
  it('returns pf-m-green for completed', function() {
    expect(backupStatusClass('completed')).to.equal('pf-m-green');
  });

  it('returns pf-m-red for failed/deleted', function() {
    expect(backupStatusClass('failed')).to.equal('pf-m-red');
    expect(backupStatusClass('deleted')).to.equal('pf-m-red');
  });
});

describe('healthStatusClass', function() {
  it('returns pf-m-green for healthy/ok', function() {
    expect(healthStatusClass('healthy')).to.equal('pf-m-green');
    expect(healthStatusClass('ok')).to.equal('pf-m-green');
  });

  it('returns pf-m-orange for degraded/warning', function() {
    expect(healthStatusClass('degraded')).to.equal('pf-m-orange');
    expect(healthStatusClass('warning')).to.equal('pf-m-orange');
  });

  it('returns pf-m-red for unhealthy/critical/down', function() {
    expect(healthStatusClass('unhealthy')).to.equal('pf-m-red');
    expect(healthStatusClass('critical')).to.equal('pf-m-red');
  });
});

describe('_durationSecondsFromJob', function() {
  it('returns null for null/undefined', function() {
    expect(_durationSecondsFromJob(null)).to.equal(null);
  });

  it('uses duration_seconds if present', function() {
    expect(_durationSecondsFromJob({ duration_seconds: 42 })).to.equal(42);
  });

  it('calculates from started_at/completed_at', function() {
    var start = new Date('2025-01-01T00:00:00Z');
    var end = new Date('2025-01-01T00:01:30Z');
    var job = { started_at: start.toISOString(), completed_at: end.toISOString() };
    expect(_durationSecondsFromJob(job)).to.equal(90);
  });
});

describe('_progressPercentFromJob', function() {
  it('returns null for null/undefined', function() {
    expect(_progressPercentFromJob(null)).to.equal(null);
  });

  it('returns progress_percent', function() {
    expect(_progressPercentFromJob({ progress_percent: 75 })).to.equal(75);
  });

  it('clamps between 0 and 100', function() {
    expect(_progressPercentFromJob({ progress_percent: -10 })).to.equal(0);
    expect(_progressPercentFromJob({ progress_percent: 150 })).to.equal(100);
  });

  it('falls back to progress field', function() {
    expect(_progressPercentFromJob({ progress: 50 })).to.equal(50);
  });
});
