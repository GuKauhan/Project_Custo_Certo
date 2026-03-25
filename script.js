// --- CONFIGURAÇÃO ---
const API_URL = 'http://localhost:3000';

// --- SISTEMA DE NAVEGAÇÃO E UI ---
function mostrarTela(nomeTela) {
    // 1. Alternar telas
    const telas = document.querySelectorAll('.tela');
    telas.forEach(tela => tela.classList.remove('active'));
    document.getElementById(`tela-${nomeTela}`).classList.add('active');

    // 2. Alternar botões do menu
    const botoes = document.querySelectorAll('.nav-btn');
    botoes.forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${nomeTela}`).classList.add('active');

    // 3. Atualizar título do cabeçalho
    const titulos = { 'estoque': 'Painel de Estoque', 'cadastro': 'Cadastrar Novo Insumo', 'vendas': 'Registrar Vendas' };
    document.getElementById('titulo-pagina').innerText = titulos[nomeTela];

    // 4. Ações específicas
    if (nomeTela === 'estoque') carregarEstoque();
}

// --- FUNÇÃO DE CARREGAMENTO (READ) ---
async function carregarEstoque() {
    try {
        const res = await fetch(`${API_URL}/ingredientes`);
        const dados = await res.json();
        const corpo = document.getElementById('tabela-corpo');
        corpo.innerHTML = '';

        if (dados.length === 0) {
            corpo.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#95a5a6; padding: 40px;"> <i class="fas fa-info-circle" style="font-size:24px; margin-bottom:10px; display:block;"></i> Nenhum ingrediente cadastrado no Custo Certo.</td></tr>`;
            return;
        }

        dados.forEach(item => {
            const linha = document.createElement('tr');
            
            // Define o Badge de Status
            const statusBadge = item.precisaRepor 
                ? '<span class="badge badge-alerta"><i class="fas fa-exclamation-triangle"></i> Repor</span>' 
                : '<span class="badge badge-ok"><i class="fas fa-check-circle"></i> Ok</span>';

            linha.innerHTML = `
                <td>${item.nome}</td>
                <td>R$ ${item.precoPorQuilo.toFixed(2)}</td>
                <td>${item.estoqueAtual.toFixed(3)} kg</td>
                <td style="color: #7f8c8d;">${item.estoqueMinimo.toFixed(3)} kg</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn-action btn-delete" onclick="confirmarDelecao('${item.id}', '${item.nome}')" title="Remover ${item.nome}">
                        <i class="fas fa-trash-alt"></i>
                    </td>
                `;
            corpo.appendChild(linha);
        });
    } catch (error) {
        console.error("Erro ao conectar com a API Custo Certo:", error);
    }
}

// --- FUNÇÃO DE CADASTRO (CREATE) ---
document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Feedback visual de carregamento (Opcional, mas profissional)
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const originalText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    btnSubmit.disabled = true;

    const novo = {
        nome: document.getElementById('nome').value,
        precoPorQuilo: parseFloat(document.getElementById('preco').value),
        estoqueAtual: parseFloat(document.getElementById('estoqueInicial').value),
        estoqueMinimo: parseFloat(document.getElementById('estoqueMinimo').value)
    };

    try {
        const res = await fetch(`${API_URL}/ingredientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novo)
        });

        if (res.ok) {
            // Sucesso Simples (Para ADS, um alert resolve)
            alert(`Sucesso! '${novo.nome}' foi integrado ao Custo Certo.`);
            e.target.reset();
            mostrarTela('estoque');
        } else {
            alert("Erro do servidor ao cadastrar.");
        }
    } catch (error) {
        alert("Erro de conexão com o servidor Custo Certo.");
    } finally {
        // Restaura o botão
        btnSubmit.innerHTML = originalText;
        btnSubmit.disabled = false;
    }
});

// --- NOVA FUNÇÃO: DELETAR (DELETE) ---
async function confirmarDelecao(id, nome) {
    // Confirmação de segurança (Essencial em ADS!)
    const confirmou = confirm(`⚠️ CUSTO CERTO - AVISO DE SEGURANÇA\n\nTem certeza absoluta que deseja REMOVER o ingrediente "${nome}"?\n\nEsta ação é irreversível e afetará o cálculo histórico.`);
    
    if (confirmou) {
        try {
            const res = await fetch(`${API_URL}/ingredientes/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                // Remove a linha visualmente para feedback instantâneo (Opcional, mas bacana)
                carregarEstoque(); 
            } else {
                alert("Erro do servidor ao tentar deletar.");
            }
        } catch (error) {
            alert("Erro de conexão ao tentar deletar.");
        }
    }
}

// --- FUNÇÃO DE VENDA (UPDATE LOTE) ---
async function vender(idReceita) {
    // Feedback simples
    const confirmou = confirm("Confirmar venda e baixa automática de estoque?");
    if(!confirmou) return;

    try {
        const res = await fetch(`${API_URL}/venda-receita`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idReceita })
        });
        
        if (res.ok) { 
            alert("Venda registrada! Estoque Custo Certo atualizado."); 
            // Se estiver na tela de estoque, atualiza
            if(document.getElementById('tela-estoque').classList.contains('active')) carregarEstoque(); 
        } else {
            alert("Erro ao registrar venda. Verifique se há estoque suficiente.");
        }
    } catch (error) {
        alert("Erro de conexão ao registrar venda.");
    }
}

// --- INICIALIZAÇÃO ---
// Atualização automática mais lenta para não pesar (a cada 30 segundos)
setInterval(() => {
    if(document.getElementById('tela-estoque').classList.contains('active')) carregarEstoque();
}, 30000);

carregarEstoque();
