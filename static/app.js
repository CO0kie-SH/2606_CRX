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

loadData();
window.setInterval(loadData, 5000);
