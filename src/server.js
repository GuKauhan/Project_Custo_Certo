const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Nosso "Banco de Dados" temporário (Um Array vazio) entao no futuro quando tiver o banco de dados, isso aqui nao ira existir e apenas para realizar teste
// zera se reiniciar o servidor
let ingredientesDB = [];
let idContador = 1;

// CADASTRAR
app.post('/ingredientes', (req, res) => {
    const { nome, unidade, preco } = req.body; 
    if (!nome || preco < 0) {
        return res.status(400).json({ erro: "Dados inválidos!" });
    }
    const novoIngrediente = { id: idContador++, nome, unidade, preco };
    ingredientesDB.push(novoIngrediente);
    return res.status(201).json({ mensagem: "Salvo!", dadoSalvo: novoIngrediente });
});

// LISTAR
app.get('/ingredientes', (req, res) => {
    return res.status(200).json(ingredientesDB);
});

// ATUALIZAR
app.put('/ingredientes/:id', (req, res) => {
    const idDoIngrediente = parseInt(req.params.id); 
    const { nome, unidade, preco } = req.body;
    const index = ingredientesDB.findIndex(item => item.id === idDoIngrediente);

    if (index === -1) return res.status(404).json({ erro: "Não encontrado!" });

    ingredientesDB[index] = {
        id: idDoIngrediente,
        nome: nome || ingredientesDB[index].nome,
        unidade: unidade || ingredientesDB[index].unidade,
        preco: preco !== undefined ? preco : ingredientesDB[index].preco
    };

    return res.status(200).json({ mensagem: "Atualizado!", dadoAtualizado: ingredientesDB[index] });
});

// DELETAR
app.delete('/ingredientes/:id', (req, res) => {
    const idDoIngrediente = parseInt(req.params.id);
    const index = ingredientesDB.findIndex(item => item.id === idDoIngrediente);

    if (index === -1) return res.status(404).json({ erro: "Não encontrado!" });

    ingredientesDB.splice(index, 1);
    return res.status(200).json({ mensagem: "Excluído!" });
});

// Ligar o Servidor
app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000 com Banco em Memória! 🚀");
});