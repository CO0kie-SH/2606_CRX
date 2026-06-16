function renderTable(items) {
  if (!items.length) {
    return '<div class="empty">当前还没有连接记录。</div>';
  }

  const rows = items.map(function (item) {
    return '<tr><td>' + (item.user || '-') + '</td><td>' + (item.address || '-') + '</td><td><span class="badge">' + (item.status || 'unknown') + '</span></td><td>' + (item.connected_at || '-') + '</td></tr>';
  }).join('');

  return '<table><thead><tr><th>用户</th><th>连接地址</th><th>状态</th><th>连接时间</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

async function loadData() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();

    document.getElementById('passed-count').textContent = data.passed_count;
    document.getElementById('updated-at').textContent = data.updated_at;
    document.getElementById('connection-count').textContent = data.connections.length;
    document.getElementById('table-box').innerHTML = renderTable(data.connections);
  } catch (error) {
    document.getElementById('table-box').innerHTML = '<div class="empty">读取数据失败，请检查服务是否正常运行。</div>';
    console.error(error);
  }
}

const visaToolState = {
  loading: false
};

async function loadVisaToolParams() {
  const response = await fetch('/api/tools/visa-card-gen/params', { cache: 'no-store' });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || '生成 Visa 题目失败');
  }

  renderVisaToolPayload(data.payload, data.generator);
}

function bindToolEvents() {
  const button = document.getElementById('visa-tool-generate');

  if (!button) {
    return;
  }

  button.addEventListener('click', async function () {
    if (visaToolState.loading) {
      return;
    }

    visaToolState.loading = true;
    button.disabled = true;
    button.textContent = '生成中...';
    document.getElementById('visa-tool-path').textContent = '正在生成题目...';

    try {
      await loadVisaToolParams();
      button.textContent = '重新生成 Visa 题目';
    } catch (error) {
      document.getElementById('visa-tool-path').textContent = '生成失败，请检查服务日志';
      document.getElementById('visa-tool-prompt').innerHTML = '<li>题目生成失败。</li>';
      document.getElementById('visa-tool-notes').innerHTML = '<li>题目生成失败。</li>';
      console.error(error);
      button.textContent = '重试生成 Visa 题目';
    } finally {
      visaToolState.loading = false;
      button.disabled = false;
    }
  });
}

function renderVisaToolPayload(payload, generator) {
  document.getElementById('visa-tool-name').textContent = payload.title || 'Visa 题目';
  document.getElementById('visa-tool-path').textContent = 'Generated from ' + (generator || 'visa_card_gen.py');
  document.getElementById('visa-tool-prompt').innerHTML = payload.prompt
    ? '<li>' + payload.prompt + '</li>'
    : '<li>无题目说明。</li>';
  document.getElementById('visa-tool-challenge-id').textContent = payload.challenge_id || '--';
  document.getElementById('visa-tool-number').textContent = payload.number || '--';
  document.getElementById('visa-tool-expiry').textContent = payload.expiry || '--';
  document.getElementById('visa-tool-cvv').textContent = payload.cvv || '--';
  document.getElementById('visa-tool-mode').textContent = payload.mode || '--';
  document.getElementById('visa-tool-source').textContent = payload.source_file || 'visa_card_gen.py';

  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  document.getElementById('visa-tool-notes').innerHTML = notes.length
    ? notes.map(function (item) {
      return '<li>' + item + '</li>';
    }).join('')
    : '<li>无附加说明。</li>';
}

loadData();
bindToolEvents();
window.setInterval(loadData, 5000);
