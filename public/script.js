/**
 * Custo Certo — Frontend v3
 * Persistência via API. Suporte a lotes com FIFO, alertas de vencimento e retirada manual.
 */

const API_BASE = '';

// ======= LOGO =======
document.getElementById('sidebar-logo').src =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="%2300a86b"/><text x="32" y="40" font-size="24" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold">CC</text></svg>';

// ======= ESTADO =======
let estoque = [];
let historico = [];
let pesoAtual = 0;
let sseBalanca = null;
let chartComp, chartStatus, chartCMV, chartEvolucao;
let evolucaoFiltro = 'todos';
let compraIdAtual = null;
let retiradaIdAtual = null;

// ======= API =======
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { const d = await res.json(); msg = d.erro || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ======= CARREGAMENTO =======
async function carregarDados() {
  try {
    const [ings, hist] = await Promise.all([
      api('/ingredientes'),
      api('/ingredientes/historico'),
    ]);
    estoque = ings;
    historico = hist;
  } catch (err) {
    console.error('Falha ao carregar dados:', err);
    showToast('Erro ao conectar ao servidor: ' + err.message, true);
  }
}

// ======= RELÓGIO =======
function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit',
  });
}
setInterval(updateClock, 1000);
updateClock();

// ======= NAVEGAÇÃO =======
const pageTitles = {
  dashboard: 'Dashboard',
  balanca: 'Balança Inteligente',
  estoque: 'Estoque',
  cardapio: 'Ficha Técnica',
  vendas: 'Vendas',
  margem: 'Margem e Desperdício',
  evolucao: 'Evolução de Preços',
};

async function showPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  btn.classList.add('active');
  document.getElementById('topbar-title').textContent = pageTitles[page];
  await carregarDados();
  if (page === 'balanca')   popularSelect();
  if (page === 'estoque')   renderEstoque();
  if (page === 'dashboard') renderDashboard();
  if (page === 'cardapio')  renderCardapio();
  if (page === 'vendas')    renderVendas();
  if (page === 'margem')    renderMargem();
  if (page === 'evolucao')  renderEvolucao();
}
window.showPage = showPage;

// ======= UTILITÁRIOS =======
function safeDestroy(chart) { try { if (chart) chart.destroy(); } catch (e) {} }

const COLORS = ['#00a86b','#3a86ff','#f4a435','#e63946','#7b5ea7','#2ec4b6','#ff6b6b'];

function fmtQtd(v, u) {
  return u === 'g' || u === 'ml' ? Math.round(v).toString() : parseFloat(v.toFixed(3)).toString();
}

function formatDate(d) {
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

/**
 * Retorna info de vencimento de uma data ISO.
 * diasAviso: quantos dias antes de vencer para considerar "aviso"
 */
function getExpiryInfo(d, diasAviso = 5) {
  if (!d) return { cls: 'expiry-ok', label: 'sem validade', diff: Infinity, nivel: 'ok' };
  const diff = Math.ceil((new Date(d) - new Date()) / 86400000);
  if (diff < 0)           return { cls: 'expiry-bad',  label: 'VENCIDO',            diff, nivel: 'critico' };
  if (diff <= diasAviso)  return { cls: 'expiry-warn', label: `vence em ${diff}d`,  diff, nivel: 'aviso'   };
                          return { cls: 'expiry-ok',   label: `${diff}d p/ vencer`, diff, nivel: 'ok'      };
}

// Ordena lotes do mais antigo para o mais novo (FIFO visual)
function ordenarLotes(lotes) {
  if (!lotes || !lotes.length) return [];
  return [...lotes].sort((a, b) => {
    const da = a.dataEntrada || a.validade || '';
    const db = b.dataEntrada || b.validade || '';
    return da.localeCompare(db);
  });
}

// ======= ALERTA GLOBAL DE VENCIMENTO =======
function renderAlertaBanner() {
  const banner = document.getElementById('alert-vencimento');
  const lista  = document.getElementById('alert-lista');
  if (!banner || !lista) return;

  // Coleta lotes críticos de todos os ingredientes
  const criticos = [];
  estoque.forEach(ing => {
    const lotes = ordenarLotes(ing.lotes);
    lotes.forEach(lote => {
      const exp = getExpiryInfo(lote.validade);
      if (exp.nivel === 'critico' || exp.nivel === 'aviso') {
        criticos.push({
          nome: ing.nome,
          unidade: ing.unidade,
          qtd: lote.quantidade,
          validade: lote.validade,
          exp,
        });
      }
    });
    // Fallback: sem lotes, usa validade do próprio ingrediente
    if (!lotes.length && ing.validade) {
      const exp = getExpiryInfo(ing.validade);
      if (exp.nivel === 'critico' || exp.nivel === 'aviso') {
        criticos.push({ nome: ing.nome, unidade: ing.unidade, qtd: ing.qtd, validade: ing.validade, exp });
      }
    }
  });

  if (!criticos.length) {
    banner.classList.remove('visible');
    return;
  }

  // Ordena: vencidos primeiro, depois por proximidade
  criticos.sort((a, b) => a.exp.diff - b.exp.diff);

  lista.innerHTML = criticos.map(c =>
    `<div>• <strong>${c.nome}</strong> — ${fmtQtd(c.qtd, c.unidade)} ${c.unidade} — ${c.exp.label} (${formatDate(c.validade)})</div>`
  ).join('');

  banner.classList.add('visible');
}

// ======= ESTOQUE =======
function renderEstoque() {
  const countEl = document.getElementById('estoque-count');
  if (countEl) countEl.textContent = estoque.length + ' ingrediente(s) cadastrado(s)';

  renderAlertaBanner();

  const grid = document.getElementById('stock-grid');
  if (!estoque.length) {
    grid.innerHTML = `<div style="color:var(--muted);padding:40px;text-align:center;grid-column:1/-1">Nenhum ingrediente cadastrado.</div>`;
    return;
  }

  // Ordena cards: críticos primeiro, depois por validade mais próxima
  const sorted = [...estoque].sort((a, b) => {
    const lotesA = ordenarLotes(a.lotes);
    const lotesB = ordenarLotes(b.lotes);
    const valA = lotesA.length ? lotesA[0].validade : a.validade;
    const valB = lotesB.length ? lotesB[0].validade : b.validade;
    if (!valA && !valB) return 0;
    if (!valA) return 1;
    if (!valB) return -1;
    return valA.localeCompare(valB);
  });

  grid.innerHTML = sorted.map(item => renderStockCard(item)).join('');
}

function renderStockCard(item) {
  const lotes = ordenarLotes(item.lotes);

  // Determina nível de alerta geral do card
  let cardClass = '';
  if (lotes.length) {
    const piorLote = lotes[0]; // mais antigo = mais urgente
    const exp = getExpiryInfo(piorLote.validade);
    if (exp.nivel === 'critico') cardClass = 'expiry-critical';
    else if (exp.nivel === 'aviso') cardClass = 'expiry-warning';
  } else if (item.validade) {
    const exp = getExpiryInfo(item.validade);
    if (exp.nivel === 'critico') cardClass = 'expiry-critical';
    else if (exp.nivel === 'aviso') cardClass = 'expiry-warning';
  }

  const pct = item.qtdMax > 0 ? Math.max(0, Math.min(100, (item.qtd / item.qtdMax) * 100)) : 0;
  const barCls = pct > 50 ? 'bar-ok' : pct > 25 ? 'bar-mid' : 'bar-low';

  // Seção de lotes
  let lotesHtml = '';
  if (lotes.length) {
    const linhas = lotes.map((lote, idx) => {
      const exp = getExpiryInfo(lote.validade);
      const isFirst = idx === 0;
      let rowCls = '';
      let valCls = 'val-ok';
      let badge = '';
      if (exp.nivel === 'critico') { rowCls = 'lote-critico'; valCls = 'val-crit'; badge = `<span class="badge-vence">${exp.label}</span>`; }
      else if (exp.nivel === 'aviso') { rowCls = 'lote-aviso'; valCls = 'val-warn'; badge = `<span class="badge-aviso">${exp.label}</span>`; }

      return `
        <div class="lote-row ${rowCls}">
          <div class="lote-info">
            <div class="lote-qty">${fmtQtd(lote.quantidade, item.unidade)} ${item.unidade}</div>
            <div class="lote-data">Entrada: ${formatDate(lote.dataEntrada || lote.data)} · Val: ${formatDate(lote.validade)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${isFirst ? '<span class="badge-usar">Usar primeiro</span>' : ''}
            ${badge}
            <span class="lote-val ${valCls}">${exp.nivel === 'ok' ? exp.label : ''}</span>
          </div>
        </div>`;
    }).join('');

    lotesHtml = `
      <div class="lotes-section">
        <div class="lotes-title"><i class="fas fa-layer-group" style="margin-right:4px"></i>Lotes em estoque</div>
        ${linhas}
      </div>`;
  } else {
    // Sem lotes: exibe validade simples
    const exp = getExpiryInfo(item.validade);
    lotesHtml = `
      <div class="stock-expiry ${exp.cls}" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <i class="fas fa-calendar-alt"></i> Validade: ${formatDate(item.validade)} · ${exp.label}
      </div>`;
  }

  return `
    <div class="stock-card ${cardClass}">
      <div class="sc-header">
        <div class="sc-header-left">
          <div class="stock-name">${item.nome}</div>
          <div class="stock-unit-badge">${item.unidade}</div>
        </div>
        <div class="sc-header-right">
          <button class="btn-del-stock" onclick="deletarItem(${item.id})" title="Remover ingrediente">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </div>

      <div class="stock-qty">${fmtQtd(item.qtd, item.unidade)} <span>${item.unidade}</span></div>
      <div class="stock-meta">
        <span>R$ ${item.preco.toFixed(2)}/${item.unidade}</span>
        <span>${pct.toFixed(0)}% do estoque</span>
      </div>
      <div class="stock-bar-bg"><div class="stock-bar-fill ${barCls}" style="width:${pct}%"></div></div>
      <div class="stock-bar-label"><span>0</span><span>${fmtQtd(item.qtdMax, item.unidade)} ${item.unidade} máx.</span></div>

      ${lotesHtml}

      <div class="btns-card">
        <button class="btn-retirada" onclick="abrirModalRetirada(${item.id})">
          <i class="fas fa-minus-circle"></i> Retirar
        </button>
        <button class="btn-compra" onclick="abrirModalCompra(${item.id})">
          <i class="fas fa-cart-plus"></i> Nova Compra
        </button>
      </div>
    </div>`;
}

// ======= DELETAR INGREDIENTE =======
async function deletarItem(id) {
  if (!confirm('Tem certeza que deseja remover este ingrediente?')) return;
  try {
    await api(`/ingredientes/${id}`, { method: 'DELETE' });
    showToast('Ingrediente removido.');
    await carregarDados();
    renderEstoque();
    popularSelect();
  } catch (err) {
    showToast('Erro: ' + err.message, true);
  }
}
window.deletarItem = deletarItem;

// ======= MODAL CADASTRO =======
function abrirModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('f-nome').focus();
}
window.abrirModal = abrirModal;

function fecharModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  ['f-nome','f-preco','f-qtd','f-validade'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-unidade').value = 'kg';
}
window.fecharModal = fecharModal;

async function salvarIngrediente() {
  const nome    = document.getElementById('f-nome').value.trim();
  const unidade = document.getElementById('f-unidade').value;
  const preco   = parseFloat(document.getElementById('f-preco').value);
  const qtd     = parseFloat(document.getElementById('f-qtd').value);
  const validade = document.getElementById('f-validade').value || null;
  if (!nome || isNaN(preco) || isNaN(qtd)) { showToast('Preencha todos os campos!', true); return; }
  try {
    await api('/ingredientes', {
      method: 'POST',
      body: JSON.stringify({ nome, unidade, preco, qtd, qtdMax: qtd, validade }),
    });
    showToast(`"${nome}" adicionado ao estoque!`);
    fecharModal();
    await carregarDados();
    renderEstoque();
    popularSelect();
  } catch (err) {
    showToast('Erro: ' + err.message, true);
  }
}
window.salvarIngrediente = salvarIngrediente;

// ======= MODAL NOVA COMPRA =======
function abrirModalCompra(id) {
  const ing = estoque.find(i => i.id === id);
  if (!ing) return;
  compraIdAtual = id;
  document.getElementById('mc-nome-titulo').textContent = ing.nome;
  document.getElementById('mc-unidade-label').textContent = ing.unidade;
  document.getElementById('mc-estoque-atual').textContent =
    `Estoque atual: ${fmtQtd(ing.qtd, ing.unidade)} ${ing.unidade}  ·  Último preço: R$ ${ing.preco.toFixed(2)}/${ing.unidade}`;
  document.getElementById('mc-preco').value = ing.preco.toFixed(2);
  document.getElementById('mc-qtd').value = '';
  document.getElementById('mc-validade').value = '';   // validade em branco: nova compra = novo lote
  document.getElementById('modal-compra-overlay').classList.add('open');
  document.getElementById('mc-qtd').focus();
}
window.abrirModalCompra = abrirModalCompra;

function fecharModalCompra() {
  document.getElementById('modal-compra-overlay').classList.remove('open');
  compraIdAtual = null;
}
window.fecharModalCompra = fecharModalCompra;

async function confirmarNovaCompra() {
  if (!compraIdAtual) return;
  const ing = estoque.find(i => i.id === compraIdAtual);
  if (!ing) return;
  const qtdNova  = parseFloat(document.getElementById('mc-qtd').value);
  const precoNovo = parseFloat(document.getElementById('mc-preco').value);
  const validadeNova = document.getElementById('mc-validade').value || null;
  if (isNaN(qtdNova) || qtdNova <= 0 || isNaN(precoNovo) || precoNovo <= 0) {
    showToast('Preencha quantidade e custo corretamente!', true); return;
  }
  try {
    await api(`/ingredientes/${compraIdAtual}/compras`, {
      method: 'POST',
      body: JSON.stringify({ quantidade: qtdNova, precoUnitario: precoNovo, validade: validadeNova }),
    });
    showToast(`✓ +${fmtQtd(qtdNova, ing.unidade)} ${ing.unidade} adicionados como novo lote em "${ing.nome}"`);
    fecharModalCompra();
    await carregarDados();
    renderEstoque();
    popularSelect();
  } catch (err) {
    showToast('Erro: ' + err.message, true);
  }
}
window.confirmarNovaCompra = confirmarNovaCompra;

// ======= MODAL RETIRADA MANUAL =======
function abrirModalRetirada(id) {
  const ing = estoque.find(i => i.id === id);
  if (!ing) return;
  retiradaIdAtual = id;
  document.getElementById('mr-nome-titulo').textContent = ing.nome;
  document.getElementById('mr-unidade-label').textContent = ing.unidade;

  const lotes = ordenarLotes(ing.lotes);
  let infoTxt = `Estoque total: ${fmtQtd(ing.qtd, ing.unidade)} ${ing.unidade}`;
  if (lotes.length) {
    const l = lotes[0];
    infoTxt += ` · Lote mais antigo: ${fmtQtd(l.quantidade, ing.unidade)} ${ing.unidade} (val. ${formatDate(l.validade)})`;
  }
  document.getElementById('mr-info').textContent = infoTxt;
  document.getElementById('mr-qtd').value = '';
  document.getElementById('modal-retirada-overlay').classList.add('open');
  document.getElementById('mr-qtd').focus();
}
window.abrirModalRetirada = abrirModalRetirada;

function fecharModalRetirada() {
  document.getElementById('modal-retirada-overlay').classList.remove('open');
  retiradaIdAtual = null;
}
window.fecharModalRetirada = fecharModalRetirada;

async function confirmarRetirada() {
  if (!retiradaIdAtual) return;
  const ing = estoque.find(i => i.id === retiradaIdAtual);
  if (!ing) return;
  const qtd = parseFloat(document.getElementById('mr-qtd').value);
  if (isNaN(qtd) || qtd <= 0) { showToast('Informe uma quantidade válida!', true); return; }
  if (qtd > ing.qtd) { showToast('Quantidade maior que o estoque disponível!', true); return; }
  try {
    await api(`/ingredientes/${retiradaIdAtual}/retirada`, {
      method: 'POST',
      body: JSON.stringify({ quantidade: qtd }),
    });
    showToast(`✓ ${fmtQtd(qtd, ing.unidade)} ${ing.unidade} retirados de "${ing.nome}" (lote mais antigo)`);
    fecharModalRetirada();
    await carregarDados();
    renderEstoque();
    popularSelect();
  } catch (err) {
    showToast('Erro: ' + err.message, true);
  }
}
window.confirmarRetirada = confirmarRetirada;

// ======= BALANÇA (SSE) =======
function iniciarLeituraPeso() {
  if (sseBalanca) return;
  sseBalanca = new EventSource('/balanca/stream');
  sseBalanca.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (typeof data.peso === 'number') { pesoAtual = data.peso; atualizarDisplay(); }
    } catch (err) { console.error('Erro SSE:', err); }
  };
  sseBalanca.onerror = () => console.warn('SSE reconectando…');
}

function getIngredienteSelecionado() {
  const id = Number(document.getElementById('select-ingrediente').value);
  return estoque.find(i => i.id === id) || null;
}

function atualizarDisplay() {
  const ing = getIngredienteSelecionado();
  let peso = Math.max(0, pesoAtual);
  let valor = peso.toFixed(3);
  let unidade = 'kg';
  if (ing) {
    if (ing.unidade === 'g')  { valor = (peso * 1000).toFixed(1); unidade = 'g'; }
    else if (ing.unidade === 'ml') { valor = (peso * 1000).toFixed(0); unidade = 'ml'; }
    else if (ing.unidade === 'un') { valor = Math.round(peso * 10); unidade = 'un'; }
    else unidade = ing.unidade;
  }
  document.getElementById('peso-display').textContent = valor;
  document.getElementById('unidade-display').textContent = unidade;
  document.getElementById('btn-confirmar').disabled = !(ing && peso > 0.001);
  if (ing) atualizarTabelaCusto(ing, peso);
}

function atualizarTabelaCusto(ing, peso) {
  const tbody = document.getElementById('custo-tbody');
  if (!tbody) return;
  let consumo = peso;
  if (ing.unidade === 'g' || ing.unidade === 'ml') consumo = peso * 1000;
  const custo = consumo * ing.preco;
  const pesoG = peso * 1000;

  let rows = '';
  if (ing.unidade === 'kg' || ing.unidade === 'g') {
    rows = `
      <tr><td>Por grama</td><td>${pesoG.toFixed(1)} g</td><td class="val-col">R$ ${(ing.preco/1000*pesoG).toFixed(4)}</td></tr>
      <tr><td>Por 100g</td><td>${(pesoG/100).toFixed(2)}×</td><td class="val-col">R$ ${(ing.preco/10).toFixed(3)}</td></tr>
      <tr class="highlight-row"><td><b>Porção pesada</b></td><td><b>${ing.unidade==='g'?pesoG.toFixed(1)+' g':peso.toFixed(3)+' kg'}</b></td><td class="val-col"><b>R$ ${custo.toFixed(2)}</b></td></tr>`;
  } else if (ing.unidade === 'L' || ing.unidade === 'ml') {
    const ml = peso * 1000;
    rows = `
      <tr><td>Por ml</td><td>${ml.toFixed(0)} ml</td><td class="val-col">R$ ${(ing.preco/1000*ml).toFixed(4)}</td></tr>
      <tr class="highlight-row"><td><b>Porção pesada</b></td><td><b>${ing.unidade==='ml'?ml.toFixed(0)+' ml':peso.toFixed(3)+' L'}</b></td><td class="val-col"><b>R$ ${custo.toFixed(2)}</b></td></tr>`;
  } else {
    const un = Math.round(peso * 10);
    rows = `<tr class="highlight-row"><td><b>Porção pesada</b></td><td><b>${un} unidades</b></td><td class="val-col"><b>R$ ${custo.toFixed(2)}</b></td></tr>`;
  }
  rows += `<tr><td colspan="3" style="font-size:11px;color:var(--muted);padding-top:4px">Base: R$ ${ing.preco.toFixed(2)}/${ing.unidade}</td></tr>`;
  tbody.innerHTML = rows;
}

function popularSelect() {
  iniciarLeituraPeso();
  const sel = document.getElementById('select-ingrediente');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">— Selecione —</option>';
  // Exclui ingredientes com unidade 'un'
  estoque
    .filter(item => item.unidade !== 'un')
    .forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = `${item.nome} (${item.unidade})`;
      sel.appendChild(opt);
    });
  if (atual) sel.value = atual;
  atualizarDisplay();
}

function abrirInsercaoManual() {
  const sel = document.getElementById('sel-manual');
  sel.innerHTML = '<option value="">— Selecione —</option>';
  // Apenas ingredientes 'un'
  estoque
    .filter(item => item.unidade === 'un')
    .forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.nome;
      sel.appendChild(opt);
    });
  document.getElementById('manual-qtd').value = '';
  document.getElementById('modal-manual-overlay').classList.add('open');
  sel.focus();
}
window.abrirInsercaoManual = abrirInsercaoManual;

function fecharInsercaoManual() {
  document.getElementById('modal-manual-overlay').classList.remove('open');
}
window.fecharInsercaoManual = fecharInsercaoManual;

async function confirmarInsercaoManual() {
  const id = parseInt(document.getElementById('sel-manual').value);
  const qtd = parseFloat(document.getElementById('manual-qtd').value);
  const ing = estoque.find(i => i.id === id);
  if (!ing) { showToast('Selecione um ingrediente!', true); return; }
  if (isNaN(qtd) || qtd <= 0) { showToast('Informe uma quantidade válida!', true); return; }
  if (qtd > ing.qtd) { showToast('Estoque insuficiente!', true); return; }
  try {
    await api(`/ingredientes/${id}/retirada`, {
      method: 'POST',
      body: JSON.stringify({ quantidade: qtd }),
    });
    showToast(`✓ ${qtd} un de "${ing.nome}" registradas`);
    fecharInsercaoManual();
    await carregarDados();
    popularSelect();
  } catch (err) {
    showToast('Erro: ' + err.message, true);
  }
}
window.confirmarInsercaoManual = confirmarInsercaoManual;

function onIngredientChange() { atualizarDisplay(); }
window.onIngredientChange = onIngredientChange;

async function tararBalanca() {
  try {
    await api('/balanca/tara', { method: 'POST' });
    showToast('Balança tarada');
  } catch (err) {
    showToast('Erro ao tarar: ' + err.message, true);
  }
}
window.tararBalanca = tararBalanca;

async function confirmarPeso() {
  const ing = getIngredienteSelecionado();
  if (!ing || pesoAtual <= 0.001) return;
  let consumo = pesoAtual;
  if (ing.unidade === 'g' || ing.unidade === 'ml') consumo = pesoAtual * 1000;
  if (consumo > ing.qtd) { showToast('⚠ Estoque insuficiente!', true); return; }
  try {
    const data = await api('/balanca/confirmar', {
      method: 'POST',
      body: JSON.stringify({ ingredienteId: ing.id, quantidadeConsumida: consumo }),
    });
    if (data && !data.ok) { showToast(data.erro || 'Erro na confirmação', true); return; }
    showToast(`✓ ${consumo.toFixed(3)} ${ing.unidade} abatidos (FIFO)`);
    await carregarDados();
    popularSelect();
  } catch (err) {
    showToast(err.message, true);
  }
}
window.confirmarPeso = confirmarPeso;

// ======= DASHBOARD =======
function renderDashboard() {
  const totalVal = estoque.reduce((s, i) => s + i.preco * i.qtd, 0);
  const alertas  = estoque.filter(i => i.qtdMax > 0 && i.qtd / i.qtdMax < 0.25).length;
  const vencendo = estoque.filter(i => {
    if (!i.validade) return false;
    const diff = Math.ceil((new Date(i.validade) - new Date()) / 86400000);
    return diff >= 0 && diff <= 5;
  }).length;

  document.getElementById('kpi-estoque').textContent =
    'R$ ' + totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('kpi-itens').textContent = estoque.length + ' itens cadastrados';
  document.getElementById('kpi-alerta').textContent = alertas;
  document.getElementById('kpi-alerta-sub').textContent =
    alertas > 0 ? alertas + ' abaixo de 25% do estoque' : 'Todos dentro do limite';
  document.getElementById('kpi-vencendo').textContent = vencendo;

  // O CMV vem do servidor, calculado sobre vendas e fichas técnicas.
  //
  // Antes ele era montado aqui: a receita era estimada como totalVal * 3.5 e o
  // CMV era totalVal dividido por essa receita. Os dois lados da divisão eram a
  // mesma grandeza, então ela se cancelava e o resultado era sempre 1/3,5 —
  // 28,6%, qualquer que fosse a situação da cafeteria. Como o limite de "ideal"
  // era 31%, o medidor também apontava para o verde para sempre.
  carregarIndicadoresDoPainel();

  const rl = document.getElementById('rotate-list');
  if (rl) {
    rl.innerHTML = estoque.map(i => {
      const pct = i.qtdMax > 0 ? Math.min(100, Math.round((i.qtd / i.qtdMax) * 100)) : 0;
      const cls = pct > 50 ? 'bar-ok' : pct > 25 ? 'bar-mid' : 'bar-low';
      return `<div class="rotate-item">
        <div class="rotate-header"><span>${i.nome}</span><span style="font-weight:700">${pct}%</span></div>
        <div class="rotate-bar-bg"><div class="rotate-bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  requestAnimationFrame(() => renderDashboardCharts(estoque));
}

function renderDashboardCharts(est) {
  const ctxComp = document.getElementById('chart-composicao');
  if (ctxComp) {
    safeDestroy(chartComp);
    chartComp = new Chart(ctxComp, {
      type: 'doughnut',
      data: {
        labels: est.map(i => i.nome),
        datasets: [{ data: est.map(i => i.preco * i.qtd), backgroundColor: est.map((_, idx) => COLORS[idx % COLORS.length]), borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 11 } } } } },
    });
  }
  const ctxStatus = document.getElementById('chart-status');
  if (ctxStatus) {
    safeDestroy(chartStatus);
    chartStatus = new Chart(ctxStatus, {
      type: 'bar',
      data: {
        labels: est.map(i => i.nome),
        datasets: [{
          label: '% do estoque',
          data: est.map(i => i.qtdMax > 0 ? Math.min(100, Math.round((i.qtd / i.qtdMax) * 100)) : 0),
          backgroundColor: est.map(i => { const p = i.qtdMax > 0 ? i.qtd / i.qtdMax : 0; return p > 0.5 ? 'rgba(0,168,107,0.75)' : p > 0.25 ? 'rgba(244,164,53,0.75)' : 'rgba(230,57,70,0.75)'; }),
          borderRadius: 6,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } },
    });
  }
}

// ======= EVOLUÇÃO DE PREÇOS =======
function renderEvolucao() {
  const ctx = document.getElementById('chart-evolucao');
  if (!ctx) return;

  const porProduto = {};
  historico.forEach(h => {
    if (!porProduto[h.produtoId]) porProduto[h.produtoId] = { nome: h.nome, unidade: h.unidade, pontos: [] };
    porProduto[h.produtoId].pontos.push({ data: h.data, preco: h.preco });
  });

  const datasetsTodos = Object.entries(porProduto).map(([pid, info], idx) => {
    info.pontos.sort((a, b) => a.data.localeCompare(b.data));
    return {
      label: info.nome,
      data: info.pontos.map(p => ({ x: p.data, y: p.preco })),
      borderColor: COLORS[idx % COLORS.length],
      backgroundColor: COLORS[idx % COLORS.length] + '33',
      tension: 0.3, fill: false,
    };
  });

  const datasets = evolucaoFiltro === 'todos'
    ? datasetsTodos
    : datasetsTodos.filter(d => d.label === evolucaoFiltro);

  safeDestroy(chartEvolucao);
  requestAnimationFrame(() => {
    chartEvolucao = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 11 } } },
          tooltip: {
            callbacks: { title: items => 'Data: ' + items[0].label, label: item => `${item.dataset.label}: R$ ${item.parsed.y.toFixed(2)}/un` },
            backgroundColor: '#fff', titleColor: '#1a1d2e', bodyColor: '#1a1d2e', borderColor: '#e8eaf0', borderWidth: 1, padding: 10,
          },
        },
        scales: {
          x: { type: 'category', ticks: { font: { family: 'DM Sans', size: 11 } }, grid: { color: '#f0f2f8' } },
          y: { ticks: { callback: v => 'R$ ' + v.toFixed(2), font: { family: 'DM Sans', size: 11 } }, grid: { color: '#f0f2f8' } },
        },
      },
    });
  });

  // Filtros
  const filterEl = document.getElementById('price-filter');
  if (filterEl) {
    const nomes = [...new Set(historico.map(h => h.nome))];
    filterEl.innerHTML =
      `<button class="pill evolucao-filtro-btn ${evolucaoFiltro === 'todos' ? 'active' : ''}" onclick="setFiltroEvolucao('todos', this)">Todos</button>` +
      nomes.map(n => `<button class="pill evolucao-filtro-btn ${evolucaoFiltro === n ? 'active' : ''}" onclick="setFiltroEvolucao('${n}', this)">${n}</button>`).join('');
  }

  const tbody = document.getElementById('historico-tbody');
  if (tbody) {
    const sortedH = [...historico].sort((a, b) => b.data.localeCompare(a.data));
    tbody.innerHTML = sortedH.map(h => `
      <tr>
        <td>${formatDate(h.data)}</td>
        <td style="font-weight:600">${h.nome}</td>
        <td>${h.unidade}</td>
        <td>${h.qtd} ${h.unidade}</td>
        <td class="val-col">R$ ${h.preco.toFixed(2)}</td>
        <td class="val-col">R$ ${(h.preco * h.qtd).toFixed(2)}</td>
      </tr>`).join('');
  }
}

function setFiltroEvolucao(val, btn) {
  evolucaoFiltro = val;
  document.querySelectorAll('.evolucao-filtro-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderEvolucao();
}
window.setFiltroEvolucao = setFiltroEvolucao;

// ======= TOAST =======
let toastTimer;
// =====================================================================
// INDICADORES DE NEGÓCIO
// =====================================================================
// Estas telas existem porque o sistema passou a saber o que a cafeteria VENDE,
// e não só o que entra e sai do estoque. Sem o lado da receita, nenhum
// indicador de margem é calculável — era essa a origem do CMV constante.

const fmtBRL = (v) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtNum = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const fmtPct = (v) => Number(v || 0).toFixed(1) + '%';

/** Cache do cardápio, para os selects não irem ao servidor a cada abertura. */
let cardapioCache = [];

/** Busca o pacote completo de indicadores para um período em dias. */
async function buscarIndicadores(dias) {
  return api(`/indicadores?dias=${dias}`);
}

// ---------------------------------------------------------------- dashboard

async function carregarIndicadoresDoPainel() {
  try {
    const dados = await buscarIndicadores(90);
    const r = dados.resumo;

    const classe = r.classificacaoCmv === 'ok' ? 'ok'
                 : r.classificacaoCmv === 'atencao' ? 'warn'
                 : r.classificacaoCmv === 'ruim' ? 'bad' : '';

    const semVenda = !r.temVendas;

    document.getElementById('kpi-cmv').textContent = semVenda ? '—' : fmtPct(r.cmvTeorico);
    document.getElementById('kpi-cmv-sub').textContent = semVenda
      ? 'sem vendas no período não há CMV a calcular'
      : r.rotuloCmv;

    document.getElementById('g-receita').textContent = fmtBRL(r.receita);
    document.getElementById('g-custo').textContent = fmtBRL(r.custoTeorico);
    document.getElementById('g-margem').textContent = fmtBRL(r.margemBruta);
    document.getElementById('g-ticket').textContent = fmtBRL(r.ticketMedio);

    const gCmv = document.getElementById('g-cmv');
    gCmv.textContent = semVenda ? '—' : fmtPct(r.cmvTeorico);
    gCmv.className = 'val ' + classe;

    const gClass = document.getElementById('g-class');
    gClass.textContent = r.rotuloCmv;
    gClass.className = 'val ' + classe;

    // Compra x consumo denuncia caixa parado na prateleira. Comprar quatro vezes
    // o que se gasta no mês não é reposição, é estoque inflando.
    const cc = document.getElementById('g-compra-consumo');
    if (r.razaoCompraConsumo > 0) {
      cc.textContent = `Comprou ${fmtBRL(r.compras)} e consumiu ${fmtBRL(r.custoReal)} `
        + `— ${r.razaoCompraConsumo.toFixed(1)}× o que gastou.`
        + (r.razaoCompraConsumo > 2 ? ' Isso é caixa parando na prateleira.' : '');
    } else {
      cc.textContent = 'Sem baixas de estoque no período, não dá para comparar compra com consumo.';
    }

    desenharMedidorCmv(semVenda ? 0 : r.cmvTeorico, classe);
  } catch (e) {
    showToast('Não foi possível carregar os indicadores: ' + e.message, true);
  }
}

/** Desenha o medidor de CMV no canvas, com a faixa ideal marcada. */
function desenharMedidorCmv(pct, classe) {
  const canvas = document.getElementById('chart-cmv-gauge');
  if (!canvas) return;

  const g = canvas.getContext('2d');
  const cor = classe === 'ok' ? '#00a86b' : classe === 'warn' ? '#f4a435' : classe === 'bad' ? '#e63946' : '#8892a4';

  g.clearRect(0, 0, canvas.width, canvas.height);
  g.lineWidth = 14;
  g.lineCap = 'round';

  g.strokeStyle = 'rgba(136,146,164,0.20)';
  g.beginPath();
  g.arc(70, 78, 55, Math.PI, 2 * Math.PI);
  g.stroke();

  // A escala vai até 50%: acima disso o negócio já está fora de qualquer
  // referência do setor, e esticar o eixo só achataria a faixa que importa.
  const fracao = Math.max(0, Math.min(1, pct / 50));
  if (fracao > 0) {
    g.strokeStyle = cor;
    g.beginPath();
    g.arc(70, 78, 55, Math.PI, Math.PI + Math.PI * fracao);
    g.stroke();
  }

  g.fillStyle = cor;
  g.font = '700 22px DM Sans, sans-serif';
  g.textAlign = 'center';
  g.fillText(pct > 0 ? fmtPct(pct) : '—', 70, 74);
}

// ---------------------------------------------------------------- cardápio

async function renderCardapio() {
  const grade = document.getElementById('cardapio-grid');
  grade.innerHTML = '<div style="color:var(--muted);font-size:13px">Carregando...</div>';

  try {
    cardapioCache = await api('/receitas');
    const semFicha = cardapioCache.filter((r) => !r.temFicha).length;

    document.getElementById('cardapio-sub').textContent =
      `${cardapioCache.length} produtos no cardápio`
      + (semFicha > 0 ? ` · ${semFicha} ainda sem ficha` : '');

    if (cardapioCache.length === 0) {
      grade.innerHTML = '<div style="color:var(--muted);font-size:13px">'
        + 'Nenhum produto cadastrado. Sem ficha técnica, o sistema não consegue '
        + 'calcular margem nem CMV.</div>';
      return;
    }

    grade.innerHTML = cardapioCache.map(cartaoReceita).join('');
  } catch (e) {
    grade.innerHTML = `<div style="color:var(--red);font-size:13px">${e.message}</div>`;
  }
}

function cartaoReceita(r) {
  const linhas = r.itens.map((i) => `
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:2px 0">
      <span>${i.nome} &nbsp;${fmtNum(i.quantidade)} ${i.unidade}</span>
      <span>${fmtBRL(i.custo)}</span>
    </div>`).join('');

  const corpo = r.temFicha
    ? `${linhas}
       <div style="margin-top:10px;font-size:13px"><strong>Custo:</strong> ${fmtBRL(r.custo)}</div>
       <div style="font-size:13px"><strong>Margem:</strong> ${fmtBRL(r.margem)}
         <span style="color:var(--muted)">· custo é ${fmtPct(r.percentualCusto)} do preço</span></div>`
    : `<div style="font-size:12px;color:var(--orange);margin-top:8px">
         Sem ficha técnica. Enquanto ela não existir, este produto fica fora do
         cálculo de margem e de CMV.
       </div>`;

  return `
  <div class="stock-card${r.temFicha ? '' : ' expiry-warning'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="font-weight:700;font-size:15px">${r.nome}</div>
      <span style="font-size:11px;padding:2px 8px;border-radius:20px;white-space:nowrap;
        background:${r.ativo ? 'rgba(0,168,107,0.15)' : 'rgba(230,57,70,0.15)'};
        color:${r.ativo ? 'var(--green)' : 'var(--red)'}">
        ${r.ativo ? 'No cardápio' : 'Fora'}
      </span>
    </div>
    ${r.descricao ? `<div style="font-size:12px;color:var(--muted);margin:4px 0">${r.descricao}</div>` : ''}
    <div style="font-size:18px;font-weight:700;color:var(--green);margin:8px 0">${fmtBRL(r.precoVenda)}</div>
    ${corpo}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-cancel" style="flex:1" onclick="abrirModalReceita(${r.id})"><i class="fas fa-pen"></i> Editar</button>
      <button class="btn-cancel" style="flex:1" onclick="excluirReceita(${r.id})"><i class="fas fa-trash"></i> Excluir</button>
    </div>
  </div>`;
}

// ------------------------------------------------- modal da ficha técnica

let receitaEmEdicao = null;

async function abrirModalReceita(id) {
  if (!estoque.length) {
    showToast('Cadastre ao menos um insumo antes de montar uma ficha técnica.', true);
    return;
  }

  receitaEmEdicao = id ? cardapioCache.find((r) => r.id === id) : null;

  document.getElementById('mr-titulo').textContent =
    receitaEmEdicao ? 'Editar ' + receitaEmEdicao.nome : 'Novo Produto';
  document.getElementById('mr-nome').value = receitaEmEdicao ? receitaEmEdicao.nome : '';
  document.getElementById('mr-descricao').value = receitaEmEdicao?.descricao ?? '';
  document.getElementById('mr-preco').value = receitaEmEdicao ? receitaEmEdicao.precoVenda : 0;
  document.getElementById('mr-ativo').value = receitaEmEdicao ? (receitaEmEdicao.ativo ? '1' : '0') : '1';

  const linhas = document.getElementById('mr-linhas');
  linhas.innerHTML = '';
  if (receitaEmEdicao) {
    receitaEmEdicao.itens.forEach((i) => adicionarLinhaFicha(i.ingredienteId, i.quantidade));
  }
  recalcularFicha();

  document.getElementById('modal-receita-overlay').classList.add('show');
}

function fecharModalReceita() {
  document.getElementById('modal-receita-overlay').classList.remove('show');
  receitaEmEdicao = null;
}

function adicionarLinhaFicha(ingredienteId, quantidade) {
  const linhas = document.getElementById('mr-linhas');
  const div = document.createElement('div');
  div.className = 'linha-ficha';
  div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';

  const opcoes = estoque.map((i) =>
    `<option value="${i.id}" ${i.id === ingredienteId ? 'selected' : ''}>${i.nome} (${i.unidade})</option>`
  ).join('');

  div.innerHTML = `
    <select class="lf-insumo" style="flex:2;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit" oninput="recalcularFicha()">${opcoes}</select>
    <input class="lf-qtd" type="number" step="0.001" min="0" value="${quantidade ?? ''}" placeholder="0,018"
      style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit" oninput="recalcularFicha()">
    <button class="btn-cancel" onclick="this.parentElement.remove();recalcularFicha()"><i class="fas fa-trash"></i></button>`;

  linhas.appendChild(div);
}

/** Soma o custo das linhas preenchidas, para a prévia enquanto se digita. */
function recalcularFicha() {
  let custo = 0;
  document.querySelectorAll('#mr-linhas .linha-ficha').forEach((linha) => {
    const id = Number(linha.querySelector('.lf-insumo').value);
    const qtd = parseFloat(linha.querySelector('.lf-qtd').value);
    const insumo = estoque.find((i) => i.id === id);
    if (insumo && Number.isFinite(qtd)) custo += insumo.preco * qtd;
  });

  const preco = parseFloat(document.getElementById('mr-preco').value) || 0;
  document.getElementById('mr-resumo').innerHTML =
    `Custo dos insumos: ${fmtBRL(custo)} &nbsp;·&nbsp; Preço: ${fmtBRL(preco)} &nbsp;·&nbsp; `
    + `<span style="color:${preco - custo >= 0 ? 'var(--green)' : 'var(--red)'}">Margem: ${fmtBRL(preco - custo)}</span>`;
}

async function salvarReceita() {
  const itens = [];
  let invalida = false;

  document.querySelectorAll('#mr-linhas .linha-ficha').forEach((linha) => {
    const ingredienteId = Number(linha.querySelector('.lf-insumo').value);
    const quantidade = parseFloat(linha.querySelector('.lf-qtd').value);
    if (!Number.isFinite(quantidade) || quantidade <= 0) { invalida = true; return; }
    itens.push({ ingredienteId, quantidade });
  });

  if (invalida) {
    showToast('Preencha a quantidade de todas as linhas da ficha.', true);
    return;
  }

  const corpo = {
    nome: document.getElementById('mr-nome').value.trim(),
    descricao: document.getElementById('mr-descricao').value.trim() || null,
    precoVenda: parseFloat(document.getElementById('mr-preco').value) || 0,
    ativo: document.getElementById('mr-ativo').value === '1',
    itens,
  };

  try {
    if (receitaEmEdicao) {
      await api(`/receitas/${receitaEmEdicao.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
      showToast('Produto atualizado.');
    } else {
      await api('/receitas', { method: 'POST', body: JSON.stringify(corpo) });
      showToast('Produto cadastrado.');
    }
    fecharModalReceita();
    renderCardapio();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function excluirReceita(id) {
  const produto = cardapioCache.find((r) => r.id === id);
  if (!confirm(`Excluir "${produto?.nome}"? A ficha técnica dele será apagada junto.`)) return;

  try {
    await api(`/receitas/${id}`, { method: 'DELETE' });
    showToast('Produto excluído.');
    renderCardapio();
  } catch (e) {
    showToast(e.message, true);
  }
}

// ---------------------------------------------------------------- vendas

async function renderVendas() {
  const dias = document.getElementById('vendas-periodo').value;
  const tbody = document.getElementById('vendas-tbody');
  const totais = document.getElementById('vendas-totais');

  tbody.innerHTML = '<tr><td colspan="8" style="color:var(--muted)">Carregando...</td></tr>';

  try {
    const { vendas } = await api(`/vendas?dias=${dias}`);

    let faturamento = 0, custo = 0, unidades = 0;
    vendas.forEach((v) => { faturamento += v.total; custo += v.custoTotal; unidades += v.quantidade; });
    const ticket = unidades > 0 ? faturamento / unidades : 0;

    totais.innerHTML = [
      cartaoTotal('Faturamento', fmtBRL(faturamento), unidades + ' unidades vendidas', 'var(--green)'),
      cartaoTotal('Custo dos insumos', fmtBRL(custo), 'pela ficha técnica', 'var(--orange)'),
      cartaoTotal('Margem bruta', fmtBRL(faturamento - custo), 'antes de aluguel e folha', 'var(--blue)'),
      cartaoTotal('Ticket médio', fmtBRL(ticket), 'por unidade vendida', 'var(--green)'),
    ].join('');

    tbody.innerHTML = vendas.length === 0
      ? '<tr><td colspan="8" style="color:var(--muted)">Nenhuma venda registrada neste período.</td></tr>'
      : vendas.map((v) => `
        <tr>
          <td>${formatDate(v.data)}</td>
          <td>${v.nomeReceita}</td>
          <td>${v.quantidade}</td>
          <td>${fmtBRL(v.precoUnitario)}</td>
          <td>${fmtBRL(v.total)}</td>
          <td>${fmtBRL(v.custoTotal)}</td>
          <td style="color:var(--green)">${fmtBRL(v.margemTotal)}</td>
          <td><button class="btn-cancel" onclick="excluirVenda(${v.id})"><i class="fas fa-trash"></i></button></td>
        </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red)">${e.message}</td></tr>`;
  }
}

function cartaoTotal(rotulo, valor, legenda, cor) {
  return `
  <div class="kpi-card" style="--accent-color:${cor}">
    <div class="kpi-label">${rotulo}</div>
    <div class="kpi-value">${valor}</div>
    <div class="kpi-sub">${legenda}</div>
  </div>`;
}

async function abrirModalVenda() {
  try {
    if (!cardapioCache.length) cardapioCache = await api('/receitas');
  } catch (e) {
    showToast(e.message, true);
    return;
  }

  const ativos = cardapioCache.filter((r) => r.ativo);
  if (!ativos.length) {
    showToast('Nenhum produto ativo no cardápio. Cadastre um na Ficha Técnica.', true);
    return;
  }

  document.getElementById('mv-produto').innerHTML =
    ativos.map((r) => `<option value="${r.id}">${r.nome}</option>`).join('');
  document.getElementById('mv-qtd').value = 1;
  document.getElementById('mv-data').value = new Date().toISOString().slice(0, 10);
  document.getElementById('mv-obs').value = '';
  aoTrocarProdutoVenda();

  document.getElementById('modal-venda-overlay').classList.add('show');
}

function fecharModalVenda() {
  document.getElementById('modal-venda-overlay').classList.remove('show');
}

function aoTrocarProdutoVenda() {
  const id = Number(document.getElementById('mv-produto').value);
  const produto = cardapioCache.find((r) => r.id === id);
  if (!produto) return;

  document.getElementById('mv-preco').value = produto.precoVenda;
  document.getElementById('mv-previa').textContent = produto.temFicha
    ? `Custo pela ficha: ${fmtBRL(produto.custo)} · margem por unidade: ${fmtBRL(produto.margem)}`
    : 'Este produto não tem ficha técnica, então a venda entra sem custo e a margem sai inflada.';
}

async function salvarVenda() {
  const corpo = {
    receitaId: Number(document.getElementById('mv-produto').value),
    quantidade: parseInt(document.getElementById('mv-qtd').value, 10),
    precoUnitario: parseFloat(document.getElementById('mv-preco').value),
    data: document.getElementById('mv-data').value || undefined,
    observacao: document.getElementById('mv-obs').value.trim() || null,
  };

  try {
    await api('/vendas', { method: 'POST', body: JSON.stringify(corpo) });
    showToast('Venda registrada.');
    fecharModalVenda();
    renderVendas();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function excluirVenda(id) {
  if (!confirm('Remover este lançamento? O estoque não é afetado.')) return;
  try {
    await api(`/vendas/${id}`, { method: 'DELETE' });
    showToast('Lançamento removido.');
    renderVendas();
  } catch (e) {
    showToast(e.message, true);
  }
}

// ------------------------------------------------------ margem e desperdício

const QUADRANTES = {
  estrela: { titulo: 'Estrelas', eixos: 'margem alta · vende muito', acao: 'Proteger. Destaque no cardápio e cuidado ao mexer no preço.' },
  cavalo:  { titulo: 'Cavalos de carga', eixos: 'margem baixa · vende muito', acao: 'Consertar. Renegociar insumo ou revisar a porção — pelo volume, ganho pequeno aqui rende muito.' },
  enigma:  { titulo: 'Enigmas', eixos: 'margem alta · vende pouco', acao: 'Promover. Reposicionar no cardápio e sugerir no balcão.' },
  abacaxi: { titulo: 'Abacaxis', eixos: 'margem baixa · vende pouco', acao: 'Remover ou repensar. Ocupa espaço no cardápio e no estoque.' },
};

async function renderMargem() {
  const dias = document.getElementById('margem-periodo').value;

  try {
    const dados = await buscarIndicadores(dias);
    document.getElementById('margem-sub').textContent =
      `${dados.periodo.inicio} a ${dados.periodo.fim}`;

    renderQuadrantes(dados.cardapio);
    renderTabelaProdutos(dados.cardapio);
    renderVariancia(dados.variancias);
  } catch (e) {
    showToast('Não foi possível carregar a análise: ' + e.message, true);
  }
}

function renderQuadrantes(produtos) {
  const porQuadrante = { estrela: [], cavalo: [], enigma: [], abacaxi: [] };
  const fora = [];

  produtos.forEach((p) => {
    if (p.quadrante) porQuadrante[p.quadrante].push(p);
    else fora.push(p);
  });

  document.getElementById('quadrantes').innerHTML =
    Object.keys(QUADRANTES).map((chave) => {
      const q = QUADRANTES[chave];
      const lista = porQuadrante[chave];

      const itens = lista.length
        ? lista.map((p) => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
              <span style="font-weight:600">${p.nome}</span>
              <span style="color:var(--muted)">${p.unidadesVendidas} un · ${fmtBRL(p.margemTotal)}</span>
            </div>`).join('')
        : '<div style="font-size:12px;color:var(--muted)">nenhum produto aqui</div>';

      return `
      <div class="card">
        <div class="card-title">${q.titulo}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${q.eixos}</div>
        ${itens}
        <div style="font-size:12px;color:var(--muted);margin-top:10px">${q.acao}</div>
      </div>`;
    }).join('');

  document.getElementById('fora-da-analise').textContent = fora.length === 0 ? '' :
    'Fora da classificação: '
    + fora.map((p) => p.nome + (p.temFicha ? ' (sem venda)' : ' (sem ficha)')).join(', ')
    + '. Produto sem venda não tem popularidade a medir, e produto sem ficha teria custo zero — '
    + 'entraria como margem máxima e distorceria a média de todos os outros.';
}

function renderTabelaProdutos(produtos) {
  document.getElementById('produtos-tbody').innerHTML = produtos.map((p) => `
    <tr>
      <td>${p.nome}</td>
      <td>${p.unidadesVendidas}</td>
      <td>${fmtBRL(p.precoMedio)}</td>
      <td>${p.temFicha ? fmtBRL(p.custoUnitario) : '<span style="color:var(--orange)">sem ficha</span>'}</td>
      <td>${p.temFicha ? fmtBRL(p.margemUnitaria) : '—'}</td>
      <td>${p.temFicha ? fmtBRL(p.margemTotal) : '—'}</td>
      <td>${p.temFicha ? fmtPct(p.percentualCusto) : '—'}</td>
    </tr>`).join('');
}

function renderVariancia(variancias) {
  const comparaveis = variancias.filter((v) => !v.semBaixaRegistrada && v.teorico > 0);
  const semBaixa = variancias.filter((v) => v.semBaixaRegistrada);

  const perda = comparaveis
    .filter((v) => v.custoDiferenca > 0)
    .reduce((s, v) => s + v.custoDiferenca, 0);

  document.getElementById('variancia-resumo').textContent = comparaveis.length === 0
    ? 'Ainda não há período com vendas e baixas de estoque ao mesmo tempo. A comparação precisa dos dois lados.'
    : `Saiu do estoque além do que as vendas pediam: ${fmtBRL(perda)} no período.`;

  const cor = (c) => c === 'bom' ? 'var(--green)' : c === 'tipico' ? 'var(--orange)' : 'var(--red)';
  const rotulo = (c) => c === 'bom' ? 'controlado' : c === 'tipico' ? 'aceitável' : 'investigar';

  document.getElementById('variancia-tbody').innerHTML = comparaveis.map((v) => `
    <tr>
      <td>${v.nome}</td>
      <td>${fmtNum(v.teorico)} ${v.unidade}</td>
      <td>${fmtNum(v.real)} ${v.unidade}</td>
      <td>${v.diferenca > 0 ? '+' : ''}${fmtNum(v.diferenca)} ${v.unidade}</td>
      <td>${v.percentual > 0 ? '+' : ''}${fmtPct(v.percentual)}</td>
      <td>${fmtBRL(v.custoDiferenca)}</td>
      <td><span style="color:${cor(v.classificacao)};font-weight:600">${rotulo(v.classificacao)}</span></td>
    </tr>`).join('');

  document.getElementById('variancia-sem-baixa').textContent = semBaixa.length === 0 ? '' :
    'Sem consumo real para comparar: ' + semBaixa.map((v) => v.nome).join(', ')
    + '. Estes insumos entram nas fichas técnicas mas não passam pela balança, então o '
    + 'sistema não sabe quanto realmente saiu — e não seria honesto exibir 100% de variação para eles.';
}

window.renderCardapio = renderCardapio;
window.renderVendas = renderVendas;
window.renderMargem = renderMargem;
window.abrirModalReceita = abrirModalReceita;
window.fecharModalReceita = fecharModalReceita;
window.adicionarLinhaFicha = adicionarLinhaFicha;
window.recalcularFicha = recalcularFicha;
window.salvarReceita = salvarReceita;
window.excluirReceita = excluirReceita;
window.abrirModalVenda = abrirModalVenda;
window.fecharModalVenda = fecharModalVenda;
window.aoTrocarProdutoVenda = aoTrocarProdutoVenda;
window.salvarVenda = salvarVenda;
window.excluirVenda = excluirVenda;

function showToast(msg, err = false) {
  const el = document.getElementById('toast');
  if (!el) { console.log(msg); return; }
  const ic = el.querySelector('i');
  document.getElementById('toast-msg').textContent = msg;
  el.style.borderColor = err ? 'var(--red)' : 'var(--green)';
  ic.style.color = err ? 'var(--red)' : 'var(--green)';
  ic.className = err ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ======= INIT =======
(async function init() {
  await carregarDados();
  popularSelect();
  renderEstoque();
  renderDashboard();
})();