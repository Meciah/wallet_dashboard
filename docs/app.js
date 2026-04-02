const scopeSelect = document.getElementById('scopeSelect');
const totalValue = document.getElementById('totalValue');
const positionsList = document.getElementById('positions');
const allocationList = document.getElementById('allocation');
const runsList = document.getElementById('runs');

let data = null;

async function loadData() {
  const res = await fetch('./data/portfolio-data.json', { cache: 'no-store' });
  data = await res.json();
  render();
}

function money(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function render() {
  const scope = scopeSelect.value;
  const summary = data.summary?.[scope];
  totalValue.textContent = money(summary?.total_usd);

  const positions = (data.positions?.[scope] || []).slice(0, 8);
  positionsList.innerHTML = positions.map((p) => `<li>${p.protocol}: ${money(p.usd_value)}</li>`).join('') || '<li>No positions</li>';

  const allocation = (data.allocation_protocol?.[scope] || []).slice(0, 8);
  allocationList.innerHTML = allocation.map((a) => `<li>${a.protocol}: ${money(a.total_usd)}</li>`).join('') || '<li>No allocation data</li>';

  const runs = (data.ingestion_runs || []).slice(0, 5);
  runsList.innerHTML = runs.map((r) => `<li>#${r.id} ${r.status} (errors: ${r.error_count})</li>`).join('') || '<li>No ingestion runs</li>';
}

scopeSelect.addEventListener('change', render);
loadData().catch((err) => {
  totalValue.textContent = 'Failed to load data';
  console.error(err);
});
